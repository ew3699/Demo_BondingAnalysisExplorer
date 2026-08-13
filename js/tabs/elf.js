import * as THREE from 'three';
import { StructureViewer } from '../viewer.js';
import { parseVolumetric, sampleVolume } from '../volumetric.js';
import { isosurfaceGeometry } from '../isosurface.js';
import { colormap, drawColorbar, COLORMAPS } from '../colormap.js';

const SLICE_TEX = 256;

/**
 * Mount the ELF analysis panel: structure viewer + live isosurface + plane slicer.
 * @param {HTMLElement} host
 * @param {{structure: import('../structure.js').Structure, materialId: string}} ctx
 */
export async function initElfTab(host, ctx) {
  host.innerHTML = `<p class="loading-note">Loading ELFCAR…</p>`;
  const text = await (async () => {
    const r = await fetch(`materials/${ctx.materialId}/ELFCAR`);
    if (!r.ok) throw new Error(`ELFCAR not found for ${ctx.materialId} (HTTP ${r.status})`);
    return r.text();
  })();
  const volume = parseVolumetric(text);
  const { structure } = ctx;

  host.innerHTML = `
    <div class="tab-panel">
      <h3>Electron Localization Function (ELF)</h3>
      <p class="panel-desc">ELF from VASP (<code>ELFCAR</code>, ${volume.dims.join('×')} grid).
        Drag the isovalue to explore localization in real time — the Bi 6s² lone pair appears as caps
        on Bi pointing into the interlayer gap. The slice plane samples the same grid on a Miller plane (hkl).</p>
      <div class="elf-layout">
        <div class="elf-viewer-col">
          <div class="viewer-wrap">
            <div class="elf-viewer"></div>
            <div class="viewer-tooltip" hidden></div>
          </div>
          <div class="viewer-status elf-status">Drag to rotate · click atoms to measure distances</div>
        </div>
        <div class="elf-controls">
          <section class="ctl-group">
            <h4><label><input type="checkbox" data-id="iso-on" checked> Isosurface</label></h4>
            <div class="ctl-row">
              <span class="ctl-label">Isovalue</span>
              <input type="range" data-id="iso-slider" min="0.05" max="0.95" step="0.005" value="0.60">
              <input type="number" data-id="iso-num" min="0" max="1" step="0.01" value="0.60">
            </div>
            <div class="ctl-row">
              <span class="ctl-label">Opacity</span>
              <input type="range" data-id="iso-opacity" min="0.2" max="1" step="0.05" value="0.75">
              <span class="ctl-label">Color</span>
              <input type="color" data-id="iso-color" value="#1fa39a">
            </div>
            <div class="ctl-note" data-id="iso-info"></div>
          </section>
          <section class="ctl-group">
            <h4><label><input type="checkbox" data-id="slice-on" checked> Slice plane</label></h4>
            <div class="ctl-row">
              <span class="ctl-label">Plane (hkl)</span>
              <input type="number" data-id="h" value="1" step="1" class="hkl">
              <input type="number" data-id="k" value="0" step="1" class="hkl">
              <input type="number" data-id="l" value="0" step="1" class="hkl">
            </div>
            <div class="ctl-row">
              <span class="ctl-label">Offset</span>
              <input type="range" data-id="slice-offset" min="0.01" max="0.99" step="0.005" value="0.5">
              <span class="ctl-value" data-id="offset-val">0.50</span>
            </div>
            <div class="ctl-row">
              <span class="ctl-label">Colormap</span>
              <select data-id="slice-cmap">${COLORMAPS.map((c) => `<option>${c}</option>`).join('')}</select>
            </div>
            <canvas data-id="colorbar" width="230" height="30"></canvas>
          </section>
          <section class="ctl-group">
            <h4>Data</h4>
            <div class="ctl-note">
              Grid: ${volume.dims.join(' × ')} (${volume.data.length.toLocaleString()} points)<br>
              ELF range: ${volume.min.toFixed(3)} – ${volume.max.toFixed(3)}
            </div>
          </section>
        </div>
      </div>
    </div>`;

  const el = (id) => host.querySelector(`[data-id="${id}"]`);
  const statusEl = host.querySelector('.elf-status');
  const defaultStatus = statusEl.textContent;
  const viewer = new StructureViewer(host.querySelector('.elf-viewer'), {
    tooltip: host.querySelector('.viewer-tooltip'),
    onStatus: (msg) => { statusEl.textContent = msg || defaultStatus; },
  });
  viewer.setStructure(structure);

  // ---- Isosurface ----
  const isoMaterial = new THREE.MeshStandardMaterial({
    color: el('iso-color').value,
    roughness: 0.4,
    transparent: true,
    opacity: parseFloat(el('iso-opacity').value),
    side: THREE.DoubleSide,
  });
  const isoMesh = new THREE.Mesh(new THREE.BufferGeometry(), isoMaterial);
  viewer.overlay.add(isoMesh);

  function remesh() {
    const iso = parseFloat(el('iso-slider').value);
    const t0 = performance.now();
    const geo = isosurfaceGeometry(volume, iso, structure);
    isoMesh.geometry.dispose();
    isoMesh.geometry = geo;
    const ms = performance.now() - t0;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    el('iso-info').textContent = `ELF = ${iso.toFixed(3)} · ${Math.round(tris).toLocaleString()} triangles · ${ms.toFixed(0)} ms`;
  }

  let remeshQueued = false;
  function scheduleRemesh() {
    if (remeshQueued) return;
    remeshQueued = true;
    requestAnimationFrame(() => { remeshQueued = false; remesh(); });
  }

  el('iso-slider').addEventListener('input', () => {
    el('iso-num').value = el('iso-slider').value;
    scheduleRemesh();
  });
  el('iso-num').addEventListener('change', () => {
    el('iso-slider').value = el('iso-num').value;
    scheduleRemesh();
  });
  el('iso-on').addEventListener('change', () => { isoMesh.visible = el('iso-on').checked; });
  el('iso-opacity').addEventListener('input', () => { isoMaterial.opacity = parseFloat(el('iso-opacity').value); });
  el('iso-color').addEventListener('input', () => isoMaterial.color.set(el('iso-color').value));

  // ---- Slice plane ----
  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = sliceCanvas.height = SLICE_TEX;
  const sliceTexture = new THREE.CanvasTexture(sliceCanvas);
  sliceTexture.colorSpace = THREE.SRGBColorSpace;
  const sliceMaterial = new THREE.MeshBasicMaterial({
    map: sliceTexture,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const sliceMesh = new THREE.Mesh(new THREE.BufferGeometry(), sliceMaterial);
  const sliceEdge = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x30435c })
  );
  viewer.overlay.add(sliceMesh, sliceEdge);

  function updateSlice() {
    const h = parseInt(el('h').value, 10) || 0;
    const k = parseInt(el('k').value, 10) || 0;
    const l = parseInt(el('l').value, 10) || 0;
    const t = parseFloat(el('slice-offset').value);
    el('offset-val').textContent = t.toFixed(2);
    const cmap = el('slice-cmap').value;
    drawColorbar(el('colorbar'), cmap, 0, 1, 'ELF');

    if (!h && !k && !l) { sliceMesh.visible = sliceEdge.visible = false; return; }
    const poly = planePolygon(structure, [h, k, l], t);
    if (poly.length < 3) { sliceMesh.visible = sliceEdge.visible = false; return; }
    sliceMesh.visible = sliceEdge.visible = el('slice-on').checked;

    // In-plane orthonormal basis (u, v) and 2D bounding box.
    const c = poly.reduce((s, p) => s.add(p.clone()), new THREE.Vector3()).multiplyScalar(1 / poly.length);
    const u = poly[0].clone().sub(c).normalize();
    const n = new THREE.Vector3().crossVectors(u, poly[1].clone().sub(c)).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const uv2 = poly.map((p) => {
      const d = p.clone().sub(c);
      return [d.dot(u), d.dot(v)];
    });
    // Sort vertices by angle so the polygon is convex-ordered.
    const order = uv2.map(([x, y], i) => ({ i, a: Math.atan2(y, x) })).sort((p, q) => p.a - q.a).map((o) => o.i);
    const pts = order.map((i) => poly[i]);
    const flat = order.map((i) => uv2[i]);
    const min = [Math.min(...flat.map((p) => p[0])), Math.min(...flat.map((p) => p[1]))];
    const max = [Math.max(...flat.map((p) => p[0])), Math.max(...flat.map((p) => p[1]))];

    // Fan-triangulated geometry with UVs into the bounding rect.
    const pos = [];
    const uvs = [];
    const push = (idx) => {
      pos.push(pts[idx].x, pts[idx].y, pts[idx].z);
      uvs.push(
        (flat[idx][0] - min[0]) / (max[0] - min[0] || 1),
        (flat[idx][1] - min[1]) / (max[1] - min[1] || 1)
      );
    };
    for (let i = 1; i < pts.length - 1; i++) { push(0); push(i); push(i + 1); }
    sliceMesh.geometry.dispose();
    sliceMesh.geometry = new THREE.BufferGeometry();
    sliceMesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sliceMesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    sliceEdge.geometry.dispose();
    sliceEdge.geometry = new THREE.BufferGeometry().setFromPoints(pts);

    // Rasterize the ELF onto the plane's bounding rect.
    const ctx2d = sliceCanvas.getContext('2d');
    const img = ctx2d.createImageData(SLICE_TEX, SLICE_TEX);
    for (let py = 0; py < SLICE_TEX; py++) {
      const vy = min[1] + ((py + 0.5) / SLICE_TEX) * (max[1] - min[1]);
      for (let px = 0; px < SLICE_TEX; px++) {
        const vx = min[0] + ((px + 0.5) / SLICE_TEX) * (max[0] - min[0]);
        const p = c.clone().addScaledVector(u, vx).addScaledVector(v, vy);
        const [fx, fy, fz] = structure.cartToFrac([p.x, p.y, p.z]);
        const val = sampleVolume(volume, fx, fy, fz);
        const [r, g, b] = colormap(cmap, val); // ELF is naturally in [0,1]
        const o = 4 * (py * SLICE_TEX + px);
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx2d.putImageData(img, 0, 0);
    sliceTexture.needsUpdate = true;
  }

  let sliceQueued = false;
  function scheduleSlice() {
    if (sliceQueued) return;
    sliceQueued = true;
    requestAnimationFrame(() => { sliceQueued = false; updateSlice(); });
  }

  for (const id of ['h', 'k', 'l']) el(id).addEventListener('change', scheduleSlice);
  el('slice-offset').addEventListener('input', scheduleSlice);
  el('slice-cmap').addEventListener('change', scheduleSlice);
  el('slice-on').addEventListener('change', () => {
    const on = el('slice-on').checked;
    sliceMesh.visible = sliceEdge.visible = on;
  });

  remesh();
  updateSlice();
}

/**
 * Intersection polygon of the Miller plane (hkl) at fractional offset t∈(0,1)
 * with the unit cell. Computed in fractional space (plane: h·fx + k·fy + l·fz = d),
 * where the [0,1]³ cube makes edge clipping trivial; returned in cartesian Å.
 */
function planePolygon(structure, [h, k, l], t) {
  const g = (f) => h * f[0] + k * f[1] + l * f[2];
  const dmin = Math.min(h, 0) + Math.min(k, 0) + Math.min(l, 0);
  const dmax = Math.max(h, 0) + Math.max(k, 0) + Math.max(l, 0);
  const d = dmin + t * (dmax - dmin);

  const corners = [];
  for (let i = 0; i <= 1; i++)
    for (let j = 0; j <= 1; j++)
      for (let kk = 0; kk <= 1; kk++) corners.push([i, j, kk]);
  const edges = [];
  for (let a = 0; a < 8; a++)
    for (let b = a + 1; b < 8; b++)
      if (corners[a].filter((x, i) => x !== corners[b][i]).length === 1) edges.push([a, b]);

  const pts = [];
  for (const [a, b] of edges) {
    const ga = g(corners[a]) - d;
    const gb = g(corners[b]) - d;
    if ((ga < 0 && gb >= 0) || (gb < 0 && ga >= 0)) {
      const s = ga / (ga - gb);
      const f = corners[a].map((x, i) => x + s * (corners[b][i] - x));
      pts.push(new THREE.Vector3(...structure.fracToCart(f)));
    }
  }
  // Drop near-duplicate points (plane passing very close to a corner).
  const out = [];
  for (const p of pts) {
    if (!out.some((q) => q.distanceToSquared(p) < 1e-8)) out.push(p);
  }
  return out;
}
