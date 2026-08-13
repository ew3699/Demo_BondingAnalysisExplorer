// Tight-Binding Wannier Model tab: DFT vs Wannier bands + orbital-projected DOS,
// with per-orbital on/off toggles (off = zero all off-diagonal couplings of that
// orbital in H(k), following Wannier90HamiltonianTools/wanbandsrotorbs.m).
import { eighHermitian } from '../wannier.js';

const NS = 'http://www.w3.org/2000/svg';

const COLORS = {
  dft: '#b3bac2',
  wann: '#2456a6',
  wannFaded: 'rgba(36, 86, 166, 0.28)',
  mod: '#e8590c',
  vbm: '#7a8694',
  element: { Bi: '#8b3fa8', O: '#d62f2f', Cl: '#2b8a3e' },
  total: '#8a94a0',
};

export async function initWannierTab(host, ctx) {
  const cfg = ctx.meta.wannier;
  if (!cfg) {
    host.innerHTML = '<div class="tab-panel"><p class="panel-desc">No Wannier configuration for this material.</p></div>';
    return;
  }

  host.innerHTML = `<p class="loading-note">Loading DFT bands + Wannier Hamiltonian (15 MB)…</p>`;

  // ---- Basis bookkeeping ----
  const basis = cfg.basis;
  const orbLabels = []; // flat, length nw
  const siteOfOrb = [];
  basis.forEach((b, si) => b.orbitals.forEach((o) => { orbLabels.push(`${b.site} ${o}`); siteOfOrb.push(si); }));
  const nw = orbLabels.length;
  const siteOrbs = basis.map((b, si) => siteOfOrb.flatMap((s, i) => (s === si ? [i] : [])));
  const mask = new Uint8Array(nw).fill(1);

  // ---- k-path (uniform parameter per segment, matching bands.dat) ----
  const nseg = cfg.kpath.length - 1;
  const perSeg = cfg.pointsPerSegment;
  const nk = nseg * perSeg + 1;
  const klist = new Float64Array(nk * 3);
  for (let s = 0; s < nseg; s++) {
    const a = cfg.kpath[s].k;
    const b = cfg.kpath[s + 1].k;
    for (let i = 0; i < perSeg; i++) {
      const t = i / perSeg;
      const idx = s * perSeg + i;
      for (let d = 0; d < 3; d++) klist[idx * 3 + d] = a[d] + t * (b[d] - a[d]);
    }
  }
  cfg.kpath[nseg].k.forEach((v, d) => { klist[(nk - 1) * 3 + d] = v; });
  const xOfK = (i) => i / (nk - 1);
  const vertexX = cfg.kpath.map((_, s) => s / nseg);

  // ---- DFT bands ----
  const dftText = await (await fetch(`materials/${ctx.materialId}/${cfg.dftBandsFile}`)).text();
  const dftRows = dftText.trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number));
  const dftX = dftRows.map((r) => r[0]);
  const nDftBands = dftRows[0].length - 1;
  const dftBands = [];
  for (let b = 0; b < nDftBands; b++) dftBands.push(dftRows.map((r) => r[b + 1]));

  // ---- Settings state ----
  const settings = {
    emin: -13.5, emax: 17, sigma: 0.1, grid: [8, 8, 4], groupBy: 'element', npts: 500,
    maskMode: 'off', // 'off' = couplings need both orbitals on; 'on' = one on-orbital couples to all
    fatSels: ['el:Bi'],
  };

  // ---- DOM ----
  host.innerHTML = `
    <div class="tab-panel">
      <h3>Tight-Binding Wannier Model</h3>
      <p class="panel-desc">20-band Wannier TB Hamiltonian (<code>${cfg.hrFile}</code>, ${nseg * perSeg + 1}-point path,
        H(k)=Σ<sub>R</sub>e<sup>i2πk·R</sup>H(R)). Orbitals always keep their on-site energies; off-diagonal couplings
        follow the priority rule (<i>wanbandsrotorbs.m</i>): <b>prioritize off</b> — a coupling survives only if both
        orbitals are on; <b>prioritize on</b> — a coupling survives if either orbital is on, so a single on-orbital
        mixes with everything. ${cfg.kpathNote ?? ''}</p>
      <div class="wann-toggles" data-id="toggles"></div>
      <div class="wann-settings">
        <span class="seg-toggle" data-id="mode-toggle" title="Off-priority: a coupling survives only if BOTH orbitals are on. On-priority: a coupling survives if EITHER orbital is on — a single on-orbital mixes with everything.">
          <button class="seg on" data-mode="off">Prioritize off</button><button class="seg" data-mode="on">Prioritize on</button>
        </span>
        <button class="btn-small" data-id="all-on">All on</button>
        <button class="btn-small" data-id="all-off">All off</button>
        <label class="ctl">Smearing (eV) <input type="number" data-id="sigma" value="0.1" min="0.02" max="0.5" step="0.02"></label>
        <label class="ctl">PDOS k-grid
          <select data-id="grid">
            <option value="6,6,3">6×6×3 (fast)</option>
            <option value="8,8,4" selected>8×8×4</option>
            <option value="10,10,5">10×10×5 (fine)</option>
          </select>
        </label>
        <label class="ctl">PDOS by
          <select data-id="groupby"><option value="element" selected>element</option><option value="site">site</option></select>
        </label>
        <label class="ctl">E range <input type="number" data-id="emin" value="-13.5" step="0.5" class="erange">
          to <input type="number" data-id="emax" value="17" step="0.5" class="erange"></label>
      </div>
      <div class="wann-legend" data-id="legend"></div>
      <div class="wann-plots">
        <div class="wann-plot-card"><svg data-id="bands-svg"></svg></div>
        <div class="wann-plot-card wann-pdos-card"><svg data-id="pdos-svg"></svg></div>
        <div class="wann-plot-card">
          <div class="plot-subhead">
            Fatbands — projection onto
            <details class="multi-select" data-id="fat-select">
              <summary data-id="fat-summary">Bi (element)</summary>
              <div class="ms-panel" data-id="fat-panel"></div>
            </details>
            <span class="fat-chips" data-id="fat-chips"></span>
          </div>
          <svg data-id="fat-svg"></svg>
        </div>
        <div class="wann-plot-card wann-matrix-card">
          <div class="plot-subhead">H(R = 0) on-site block (real part, eV)</div>
          <div class="wann-matrix" data-id="matrix"></div>
          <div class="ctl-note">Rows/columns fade when the coupling rule removes them. Hover a cell for its value.</div>
        </div>
      </div>
      <details class="wann-matrix-details mo-details" data-id="mo-details">
        <summary>Build an MO Diagram</summary>
        <p class="ctl-note mo-note">
          Atomic levels (outer columns) are the on-site energies — the diagonal of the R = (0,0,0) Hamiltonian,
          which is where the PDOS collapses to when every orbital is turned off. MO levels (centre) are the
          eigenvalues of that intracell Hamiltonian with the <b>current orbital toggles and priority rule</b> applied.
          Inter-cell hopping is excluded here — it is what broadens these discrete levels into the bands/PDOS shown
          on the left. Solid levels are filled (28 valence electrons → lowest 14 levels), dashed are empty; connector
          opacity shows how much each atomic level contributes to an MO. Hover a level for its composition.
        </p>
        <div class="mo-layout">
          <div class="wann-plot-card"><div class="plot-subhead">PDOS (current model)</div><svg data-id="mo-pdos"></svg></div>
          <div class="wann-plot-card"><div class="plot-subhead">MO diagram (intracell Hamiltonian)</div><svg data-id="mo-svg"></svg></div>
        </div>
      </details>
      <div class="viewer-status wann-status" data-id="status">Starting worker…</div>
    </div>`;

  const el = (id) => host.querySelector(`[data-id="${id}"]`);

  // ---- Orbital toggle UI ----
  const togglesBox = el('toggles');
  basis.forEach((b, si) => {
    const group = document.createElement('div');
    group.className = 'orb-group';
    group.innerHTML = `
      <label class="orb-atom"><input type="checkbox" checked data-site="${si}"> ${b.site}</label>
      <div class="orb-chips">
        ${b.orbitals.map((o, oi) => `<button class="orb-chip on" data-orb="${siteOrbs[si][oi]}">${o}</button>`).join('')}
      </div>`;
    togglesBox.appendChild(group);
  });

  function syncToggleUI() {
    togglesBox.querySelectorAll('.orb-chip').forEach((chip) => {
      chip.classList.toggle('on', !!mask[+chip.dataset.orb]);
    });
    togglesBox.querySelectorAll('input[data-site]').forEach((cb) => {
      const orbs = siteOrbs[+cb.dataset.site];
      const on = orbs.filter((o) => mask[o]).length;
      cb.checked = on === orbs.length;
      cb.indeterminate = on > 0 && on < orbs.length;
    });
    host.querySelectorAll('.wann-matrix .mcell').forEach((cell) => {
      const [i, j] = [+cell.dataset.i, +cell.dataset.j];
      const keep = settings.maskMode === 'on' ? (mask[i] || mask[j]) : (mask[i] && mask[j]);
      cell.classList.toggle('mdead', i !== j && !keep);
    });
  }

  togglesBox.addEventListener('click', (e) => {
    const chip = e.target.closest('.orb-chip');
    if (chip) {
      const o = +chip.dataset.orb;
      mask[o] = mask[o] ? 0 : 1;
      syncToggleUI();
      scheduleCompute();
    }
  });
  togglesBox.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-site]');
    if (cb) {
      const target = cb.checked ? 1 : 0;
      for (const o of siteOrbs[+cb.dataset.site]) mask[o] = target;
      syncToggleUI();
      scheduleCompute();
    }
  });
  el('all-on').addEventListener('click', () => { mask.fill(1); syncToggleUI(); scheduleCompute(); });
  el('all-off').addEventListener('click', () => { mask.fill(0); syncToggleUI(); scheduleCompute(); });
  el('mode-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn || settings.maskMode === btn.dataset.mode) return;
    settings.maskMode = btn.dataset.mode;
    el('mode-toggle').querySelectorAll('.seg').forEach((b) => b.classList.toggle('on', b === btn));
    syncToggleUI();
    scheduleCompute();
  });

  // Fatband projection selector: multi-select over elements, sites, and individual orbitals.
  const fatLabelOf = (key) => {
    const [kind, val] = key.split(':');
    if (kind === 'el') return `${val} (element)`;
    if (kind === 'site') return `${basis[+val].site} (site)`;
    return orbLabels[+val];
  };
  {
    const els = [...new Set(basis.map((b) => b.element))];
    const groups = [
      ['Elements', els.map((e) => `el:${e}`)],
      ['Sites', basis.map((_, si) => `site:${si}`)],
      ['Orbitals', orbLabels.map((_, o) => `orb:${o}`)],
    ];
    el('fat-panel').innerHTML = groups
      .map(([title, keys]) => `
        <div class="ms-group">
          <div class="ms-group-title">${title}</div>
          ${keys.map((k) => `<label class="ms-item"><input type="checkbox" value="${k}" ${settings.fatSels.includes(k) ? 'checked' : ''}> ${fatLabelOf(k)}</label>`).join('')}
        </div>`)
      .join('');
    el('fat-panel').addEventListener('change', () => {
      settings.fatSels = [...el('fat-panel').querySelectorAll('input:checked')].map((c) => c.value);
      syncFatHeader();
      if (lastResult) renderFatbands();
    });
    syncFatHeader();
  }

  function syncFatHeader() {
    const sels = fatSelections();
    el('fat-summary').textContent = sels.length
      ? (sels.length <= 2 ? sels.map((s) => s.label).join(', ') : `${sels[0].label} +${sels.length - 1} more`)
      : 'nothing selected';
    el('fat-chips').innerHTML = sels
      .map((s) => `<span class="fat-chip"><span class="legend-swatch" style="background:${s.color}"></span>${s.label}</span>`)
      .join('');
  }
  el('sigma').addEventListener('change', () => { settings.sigma = parseFloat(el('sigma').value) || 0.1; scheduleCompute(); });
  el('grid').addEventListener('change', () => { settings.grid = el('grid').value.split(',').map(Number); scheduleCompute(); });
  el('groupby').addEventListener('change', () => { settings.groupBy = el('groupby').value; if (lastResult) render(); });
  el('emin').addEventListener('change', () => { settings.emin = parseFloat(el('emin').value); scheduleCompute(); });
  el('emax').addEventListener('change', () => { settings.emax = parseFloat(el('emax').value); scheduleCompute(); });

  // ---- Worker ----
  const worker = new Worker('js/workers/wannier-worker.js', { type: 'module' });
  let reference = null; // all-orbitals-on result, kept for comparison
  let lastResult = null;
  let lastMaskAllOn = true;
  let computeId = 0;
  let pending = false;
  let busy = false;

  let h0re = null;
  let h0im = null;
  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === 'ready') {
      h0re = msg.h0;
      h0im = msg.h0im;
      buildMatrixView(msg.h0);
      el('status').textContent = `Hamiltonian loaded: ${msg.nw} Wannier functions, ${msg.nrpts} R-vectors. Computing…`;
      scheduleCompute();
    } else if (msg.type === 'progress') {
      if (msg.id === computeId) {
        el('status').textContent = `Computing ${msg.stage}: ${msg.done}/${msg.total} k-points…`;
      }
    } else if (msg.type === 'result') {
      busy = false;
      if (msg.id !== computeId) return;
      lastResult = msg;
      lastMaskAllOn = mask.every((v) => v === 1);
      if (lastMaskAllOn) reference = msg;
      render();
      if (pending) { pending = false; scheduleCompute(); }
    } else if (msg.type === 'error') {
      busy = false;
      el('status').textContent = `Error: ${msg.message}`;
    }
  };
  worker.postMessage({ type: 'load', url: new URL(`materials/${ctx.materialId}/${cfg.hrFile}`, document.baseURI).href });

  let debounce = null;
  function scheduleCompute() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (busy) { pending = true; return; }
      busy = true;
      computeId += 1;
      const groups = basis.map((b, si) => ({ label: b.site, orbitals: siteOrbs[si] }));
      worker.postMessage({
        type: 'compute',
        id: computeId,
        mask: Array.from(mask),
        maskMode: settings.maskMode,
        klist,
        pdos: {
          grid: settings.grid,
          emin: settings.emin - 1,
          emax: settings.emax + 1,
          npts: settings.npts,
          sigma: settings.sigma,
          groups,
        },
      });
    }, 200);
  }

  // ---- Rendering ----
  function render() {
    const modified = !lastMaskAllOn;
    renderLegend(modified);
    renderBands(modified);
    renderPdos(modified);
    renderFatbands();
    renderMo();
    const vbmLine = vbmFrom(reference);
    const offCount = nw - mask.reduce((a, b) => a + b, 0);
    el('status').textContent =
      `${offCount === 0 ? 'All orbitals on' : `${offCount} orbital${offCount > 1 ? 's' : ''} off (${settings.maskMode === 'on' ? 'on' : 'off'}-priority)`}` +
      (vbmLine ? ` · VBM ≈ ${vbmLine.vbm.toFixed(2)} eV, CBM ≈ ${vbmLine.cbm.toFixed(2)} eV (all-on model)` : '');
  }

  function vbmFrom(res) {
    if (!res || !cfg.filledBands) return null;
    let vbm = -Infinity;
    let cbm = Infinity;
    for (let ik = 0; ik < nk; ik++) {
      vbm = Math.max(vbm, res.bands[ik * nw + cfg.filledBands - 1]);
      cbm = Math.min(cbm, res.bands[ik * nw + cfg.filledBands]);
    }
    return { vbm, cbm };
  }

  function renderLegend(modified) {
    const items = [['DFT', COLORS.dft]];
    if (modified) {
      items.push(['Wannier (all on)', COLORS.wannFaded], ['Wannier (modified)', COLORS.mod]);
    } else {
      items.push(['Wannier (all on)', COLORS.wann]);
    }
    el('legend').innerHTML = items
      .map(([l, c]) => `<span class="legend-item"><span class="legend-line" style="background:${c}"></span>${l}</span>`)
      .join('');
  }

  const PLOT = { w: 640, h: 500, top: 14, right: 12, bottom: 26, left: 46 };
  const PDOS_PLOT = { w: 320, h: 500, top: 14, right: 14, bottom: 26, left: 40 };
  const MO_PDOS_PLOT = { w: 300, h: 520, top: 14, right: 14, bottom: 26, left: 40 };

  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  function axes(svg, P, yTicks, xLabel) {
    const iw = P.w - P.left - P.right;
    const ih = P.h - P.top - P.bottom;
    svg.setAttribute('viewBox', `0 0 ${P.w} ${P.h}`);
    svg.innerHTML = '';
    const bg = svgEl('rect', { x: P.left, y: P.top, width: iw, height: ih, fill: '#fdfdfe', stroke: '#dde2e8' });
    svg.appendChild(bg);
    for (const t of yTicks) {
      const y = P.top + ih * (1 - (t - settings.emin) / (settings.emax - settings.emin));
      svg.appendChild(svgEl('line', { x1: P.left, x2: P.w - P.right, y1: y, y2: y, stroke: '#eef1f5' }));
      const lbl = svgEl('text', { x: P.left - 6, y: y + 3.5, 'text-anchor': 'end', class: 'tick-label' });
      lbl.textContent = t;
      svg.appendChild(lbl);
    }
    const yl = svgEl('text', { x: 12, y: P.top + ih / 2, class: 'axis-label', transform: `rotate(-90 12 ${P.top + ih / 2})`, 'text-anchor': 'middle' });
    yl.textContent = xLabel;
    svg.appendChild(yl);
    return { iw, ih };
  }

  function yPix(P, ih, e) {
    return P.top + ih * (1 - (e - settings.emin) / (settings.emax - settings.emin));
  }

  function bandPath(P, iw, ih, xs, es) {
    let d = '';
    for (let i = 0; i < xs.length; i++) {
      d += `${i ? 'L' : 'M'}${(P.left + iw * xs[i]).toFixed(1)},${yPix(P, ih, es[i]).toFixed(1)}`;
    }
    return d;
  }

  function yTickList() {
    const span = settings.emax - settings.emin;
    const step = span > 18 ? 4 : span > 8 ? 2 : 1;
    const ticks = [];
    for (let t = Math.ceil(settings.emin / step) * step; t <= settings.emax; t += step) ticks.push(t);
    return ticks;
  }

  function renderBands(modified) {
    const svg = el('bands-svg');
    const P = PLOT;
    const { iw, ih } = axes(svg, P, yTickList(), 'Energy (eV)');
    const clip = svgEl('clipPath', { id: 'bands-clip' });
    clip.appendChild(svgEl('rect', { x: P.left, y: P.top, width: iw, height: ih }));
    svg.appendChild(clip);
    const g = svgEl('g', { 'clip-path': 'url(#bands-clip)' });
    svg.appendChild(g);

    // High-symmetry verticals + labels
    vertexX.forEach((vx, i) => {
      const x = P.left + iw * vx;
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: P.top, y2: P.top + ih, stroke: '#d5dae1' }));
      const lbl = svgEl('text', { x, y: P.h - 8, 'text-anchor': 'middle', class: 'tick-label' });
      lbl.textContent = cfg.kpath[i].label;
      svg.appendChild(lbl);
    });

    // VBM dashed line (from all-on reference)
    const v = vbmFrom(reference);
    if (v && v.vbm > settings.emin && v.vbm < settings.emax) {
      g.appendChild(svgEl('line', {
        x1: P.left, x2: P.left + iw, y1: yPix(P, ih, v.vbm), y2: yPix(P, ih, v.vbm),
        stroke: COLORS.vbm, 'stroke-dasharray': '5 4', 'stroke-width': 1,
      }));
    }

    // DFT bands
    for (const band of dftBands) {
      g.appendChild(svgEl('path', { d: bandPath(P, iw, ih, dftX, band), fill: 'none', stroke: COLORS.dft, 'stroke-width': 1.1 }));
    }
    // Wannier bands
    const xs = [...Array(nk).keys()].map(xOfK);
    const drawWann = (res, color, width) => {
      for (let b = 0; b < nw; b++) {
        const es = [];
        for (let ik = 0; ik < nk; ik++) es.push(res.bands[ik * nw + b]);
        g.appendChild(svgEl('path', { d: bandPath(P, iw, ih, xs, es), fill: 'none', stroke: color, 'stroke-width': width }));
      }
    };
    if (modified) {
      if (reference) drawWann(reference, COLORS.wannFaded, 1.4);
      drawWann(lastResult, COLORS.mod, 1.7);
    } else {
      drawWann(lastResult, COLORS.wann, 1.6);
    }

    attachBandsHover(svg, P, iw, ih, xs);
  }

  function attachBandsHover(svg, P, iw, ih, xs) {
    const cross = svgEl('line', { y1: P.top, y2: P.top + ih, stroke: '#9aa6b4', 'stroke-width': 0.8, visibility: 'hidden' });
    svg.appendChild(cross);
    const tip = svgEl('text', { class: 'hover-label', 'text-anchor': 'start', visibility: 'hidden' });
    svg.appendChild(tip);
    const catcher = svgEl('rect', { x: P.left, y: P.top, width: iw, height: ih, fill: 'transparent' });
    svg.appendChild(catcher);
    catcher.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (P.w / r.width);
      const sy = (e.clientY - r.top) * (P.h / r.height);
      const xfrac = (sx - P.left) / iw;
      const E = settings.emin + (1 - (sy - P.top) / ih) * (settings.emax - settings.emin);
      const ik = Math.max(0, Math.min(nk - 1, Math.round(xfrac * (nk - 1))));
      const res = lastResult;
      let best = null;
      for (let b = 0; b < nw; b++) {
        const eb = res.bands[ik * nw + b];
        if (!best || Math.abs(eb - E) < Math.abs(best - E)) best = eb;
      }
      cross.setAttribute('x1', sx); cross.setAttribute('x2', sx);
      cross.setAttribute('visibility', 'visible');
      tip.setAttribute('x', Math.min(sx + 8, P.w - 150));
      tip.setAttribute('y', Math.max(sy - 8, P.top + 12));
      tip.setAttribute('visibility', 'visible');
      tip.textContent = `E = ${E.toFixed(2)} eV · nearest band ${best.toFixed(3)} eV`;
    });
    catcher.addEventListener('mouseleave', () => {
      cross.setAttribute('visibility', 'hidden');
      tip.setAttribute('visibility', 'hidden');
    });
  }

  // Lighten/darken a hex color (amt in [-1, 1]) to tell same-element selections apart.
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
  }

  function fatSelections() {
    const perElement = {};
    return settings.fatSels.map((key) => {
      const [kind, val] = key.split(':');
      let orbs;
      let elName;
      if (kind === 'el') { orbs = siteOfOrb.flatMap((si, o) => (basis[si].element === val ? [o] : [])); elName = val; }
      else if (kind === 'site') { orbs = siteOrbs[+val]; elName = basis[+val].element; }
      else { orbs = [+val]; elName = basis[siteOfOrb[+val]].element; }
      const nth = perElement[elName] = (perElement[elName] ?? -1) + 1;
      const base = COLORS.element[elName] ?? COLORS.wann;
      // 0th keeps the element color; later same-element picks get progressively lighter/darker.
      const color = nth === 0 ? base : shade(base, nth % 2 ? 0.45 : -0.35);
      return { key, label: fatLabelOf(key), orbs, color };
    });
  }

  function renderFatbands() {
    const svg = el('fat-svg');
    const P = PLOT;
    const { iw, ih } = axes(svg, P, yTickList(), 'Energy (eV)');
    const clip = svgEl('clipPath', { id: 'fat-clip' });
    clip.appendChild(svgEl('rect', { x: P.left, y: P.top, width: iw, height: ih }));
    svg.appendChild(clip);
    const g = svgEl('g', { 'clip-path': 'url(#fat-clip)' });
    svg.appendChild(g);

    vertexX.forEach((vx, i) => {
      const x = P.left + iw * vx;
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: P.top, y2: P.top + ih, stroke: '#d5dae1' }));
      const lbl = svgEl('text', { x, y: P.h - 8, 'text-anchor': 'middle', class: 'tick-label' });
      lbl.textContent = cfg.kpath[i].label;
      svg.appendChild(lbl);
    });

    const res = lastResult;
    if (!res || !res.bandWeights) return;
    const xs = [...Array(nk).keys()].map(xOfK);

    // Thin base bands of the current model.
    for (let b = 0; b < nw; b++) {
      const es = [];
      for (let ik = 0; ik < nk; ik++) es.push(res.bands[ik * nw + b]);
      g.appendChild(svgEl('path', { d: bandPath(P, iw, ih, xs, es), fill: 'none', stroke: '#c6ccd4', 'stroke-width': 1 }));
    }

    // Weight circles: r ∝ √(projection weight), one series per selection.
    const v = vbmFrom(reference);
    if (v && v.vbm > settings.emin && v.vbm < settings.emax) {
      g.appendChild(svgEl('line', {
        x1: P.left, x2: P.left + iw, y1: yPix(P, ih, v.vbm), y2: yPix(P, ih, v.vbm),
        stroke: COLORS.vbm, 'stroke-dasharray': '5 4', 'stroke-width': 1,
      }));
    }
    for (const sel of fatSelections()) {
      for (let ik = 0; ik < nk; ik++) {
        for (let b = 0; b < nw; b++) {
          const e = res.bands[ik * nw + b];
          if (e < settings.emin || e > settings.emax) continue;
          let w = 0;
          for (const o of sel.orbs) w += res.bandWeights[ik * nw * nw + o * nw + b];
          const r = 5.2 * Math.sqrt(w);
          if (r < 0.55) continue;
          g.appendChild(svgEl('circle', {
            cx: (P.left + iw * xs[ik]).toFixed(1),
            cy: yPix(P, ih, e).toFixed(1),
            r: r.toFixed(2),
            fill: sel.color,
            'fill-opacity': 0.5,
          }));
        }
      }
    }
  }

  function renderPdos(modified) {
    drawPdosPanel(el('pdos-svg'), PDOS_PLOT, modified);
    if (el('mo-details').open) drawPdosPanel(el('mo-pdos'), MO_PDOS_PLOT, modified);
  }

  function drawPdosPanel(svg, P, modified) {
    const { iw, ih } = axes(svg, P, yTickList(), '');
    const res = lastResult;
    const x = res.pdosX;

    // Aggregate site curves per display grouping.
    let series;
    if (settings.groupBy === 'element') {
      const byEl = new Map();
      res.pdosCurves.forEach((c, si) => {
        const elName = basis[si].element;
        if (!byEl.has(elName)) byEl.set(elName, new Float64Array(x.length));
        const acc = byEl.get(elName);
        for (let i = 0; i < x.length; i++) acc[i] += c.y[i];
      });
      series = [...byEl.entries()].map(([label, y]) => ({ label, y, color: COLORS.element[label] ?? '#666' }));
    } else {
      series = res.pdosCurves.map((c, si) => ({
        label: c.label, y: c.y,
        color: COLORS.element[basis[si].element] ?? '#666',
        dash: si % 2 ? '5 3' : null,
      }));
    }

    // x-scale from max DOS within window
    let maxDos = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] < settings.emin || x[i] > settings.emax) continue;
      maxDos = Math.max(maxDos, res.pdosTotal[i]);
    }
    maxDos = maxDos || 1;
    const xPix = (d) => P.left + (iw * d) / (maxDos * 1.05);

    const clipId = `clip-${svg.dataset.id}`;
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('rect', { x: P.left, y: P.top, width: iw, height: ih }));
    svg.appendChild(clip);
    const g = svgEl('g', { 'clip-path': `url(#${clipId})` });
    svg.appendChild(g);

    const curvePath = (y, close) => {
      let d = '';
      for (let i = 0; i < x.length; i++) {
        d += `${i ? 'L' : 'M'}${xPix(y[i]).toFixed(1)},${yPix(P, ih, x[i]).toFixed(1)}`;
      }
      if (close) d += `L${P.left},${yPix(P, ih, x[x.length - 1]).toFixed(1)}L${P.left},${yPix(P, ih, x[0]).toFixed(1)}Z`;
      return d;
    };

    // Total: filled + line (faded all-on reference total when modified)
    g.appendChild(svgEl('path', { d: curvePath(res.pdosTotal, true), fill: 'rgba(138,148,160,0.13)', stroke: 'none' }));
    g.appendChild(svgEl('path', { d: curvePath(res.pdosTotal, false), fill: 'none', stroke: COLORS.total, 'stroke-width': 1.1 }));
    if (modified && reference) {
      g.appendChild(svgEl('path', { d: curvePath(reference.pdosTotal, false), fill: 'none', stroke: COLORS.total, 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.6 }));
    }
    for (const s of series) {
      const attrs = { d: curvePath(s.y, false), fill: 'none', stroke: s.color, 'stroke-width': 1.7 };
      if (s.dash) attrs['stroke-dasharray'] = s.dash;
      g.appendChild(svgEl('path', attrs));
    }

    // VBM marker
    const v = vbmFrom(reference);
    if (v && v.vbm > settings.emin && v.vbm < settings.emax) {
      g.appendChild(svgEl('line', {
        x1: P.left, x2: P.left + iw, y1: yPix(P, ih, v.vbm), y2: yPix(P, ih, v.vbm),
        stroke: COLORS.vbm, 'stroke-dasharray': '5 4', 'stroke-width': 1,
      }));
    }

    const xl = svgEl('text', { x: P.left + iw / 2, y: P.h - 8, 'text-anchor': 'middle', class: 'tick-label' });
    xl.textContent = 'PDOS (states/eV)';
    svg.appendChild(xl);

    // Inline series legend (direct labels, top-right)
    series.forEach((s, i) => {
      const t = svgEl('text', { x: P.w - P.right - 4, y: P.top + 16 + i * 16, 'text-anchor': 'end', class: 'series-label', fill: s.color });
      t.textContent = s.label;
      svg.appendChild(t);
    });
  }

  // ---- MO diagram (intracell Hamiltonian with current mask) ----
  function clusterLevels(items, tol = 0.02) {
    const sorted = [...items].sort((a, b) => a.e - b.e);
    const out = [];
    for (const it of sorted) {
      const last = out[out.length - 1];
      if (last && Math.abs(it.e - last.e) <= tol) {
        last.members.push(it);
        last.e = last.members.reduce((s, m) => s + m.e, 0) / last.members.length;
      } else {
        out.push({ e: it.e, members: [it] });
      }
    }
    return out;
  }

  function renderMo() {
    const details = el('mo-details');
    if (!h0re || !h0im || !details.open) return;
    const svg = el('mo-svg');
    const P = { w: 470, h: 520, top: 14, right: 10, bottom: 26, left: 46 };
    const { iw, ih } = axes(svg, P, yTickList(), 'Energy (eV)');
    const y = (e) => yPix(P, ih, e);
    const inWindow = (e) => e >= settings.emin && e <= settings.emax;

    // Masked intracell (R = 0) Hamiltonian → MO levels.
    const A = Float64Array.from(h0re);
    const B = Float64Array.from(h0im);
    for (let i = 0; i < nw; i++) {
      for (let j = 0; j < nw; j++) {
        if (i === j) continue;
        const keep = settings.maskMode === 'on' ? (mask[i] || mask[j]) : (mask[i] && mask[j]);
        if (!keep) { A[i * nw + j] = 0; B[i * nw + j] = 0; }
      }
    }
    const { values, weights } = eighHermitian(A, B, nw);

    // Columns: first element left, remaining elements right, MOs in the centre.
    const els = [...new Set(basis.map((b) => b.element))];
    const leftEls = [els[0]];
    const rightEls = els.slice(1);
    const cols = {
      left: { x0: P.left + 8, x1: P.left + 82 },
      mo: { x0: P.left + iw / 2 - 42, x1: P.left + iw / 2 + 42 },
      right: { x0: P.left + iw - 82, x1: P.left + iw - 8 },
    };

    const atomicClusters = [];
    for (const elName of els) {
      const items = [];
      for (let o = 0; o < nw; o++) {
        if (basis[siteOfOrb[o]].element === elName) items.push({ e: h0re[o * nw + o], orb: o });
      }
      for (const c of clusterLevels(items)) {
        atomicClusters.push({ ...c, element: elName, side: leftEls.includes(elName) ? 'left' : 'right' });
      }
    }
    const moClusters = clusterLevels([...values].map((e, m) => ({ e, mo: m })));

    const withTitle = (node, text) => {
      const t = document.createElementNS(NS, 'title');
      t.textContent = text;
      node.appendChild(t);
      return node;
    };

    // Connectors first (under the level lines).
    for (const mc of moClusters) {
      if (!inWindow(mc.e)) continue;
      for (const ac of atomicClusters) {
        if (!inWindow(ac.e)) continue;
        let w = 0;
        for (const am of ac.members) {
          for (const mm of mc.members) w += weights[am.orb * nw + mm.mo];
        }
        w /= mc.members.length;
        if (w < 0.04) continue;
        const col = cols[ac.side];
        const x1 = ac.side === 'left' ? col.x1 : col.x0;
        const x2 = ac.side === 'left' ? cols.mo.x0 : cols.mo.x1;
        svg.appendChild(svgEl('line', {
          x1, y1: y(ac.e), x2, y2: y(mc.e),
          stroke: COLORS.element[ac.element] ?? '#888',
          'stroke-opacity': Math.min(0.65, w).toFixed(2),
          'stroke-width': 1.1,
        }));
      }
    }

    // Atomic levels.
    for (const ac of atomicClusters) {
      if (!inWindow(ac.e)) continue;
      const col = cols[ac.side];
      const color = COLORS.element[ac.element] ?? '#888';
      const base = orbLabels[ac.members[0].orb].split(' ')[1].replace(/[₁₂₃₄]/g, '');
      const line = svgEl('line', { x1: col.x0, x2: col.x1, y1: y(ac.e), y2: y(ac.e), stroke: color, 'stroke-width': 2.4 });
      svg.appendChild(withTitle(line, `${ac.element} ${base} on-site: ${ac.e.toFixed(3)} eV (×${ac.members.length})`));
      const lbl = svgEl('text', {
        x: (col.x0 + col.x1) / 2, y: y(ac.e) - 5, 'text-anchor': 'middle',
        class: 'series-label', fill: color,
      });
      lbl.textContent = `${ac.element} ${base} ×${ac.members.length}`;
      svg.appendChild(lbl);
    }

    // MO levels: solid = filled, dashed = empty (lowest `filledBands` orbitals).
    const nFill = cfg.filledBands ?? 0;
    for (const mc of moClusters) {
      if (!inWindow(mc.e)) continue;
      const filledCount = mc.members.filter((m) => m.mo < nFill).length;
      const comp = {};
      for (const elName of els) comp[elName] = 0;
      for (const mm of mc.members) {
        for (let o = 0; o < nw; o++) comp[basis[siteOfOrb[o]].element] += weights[o * nw + mm.mo];
      }
      const compTxt = els
        .map((e) => `${e} ${Math.round((100 * comp[e]) / mc.members.length)}%`)
        .join(', ');
      const attrs = {
        x1: cols.mo.x0, x2: cols.mo.x1, y1: y(mc.e), y2: y(mc.e),
        stroke: '#30435c', 'stroke-width': 2.6,
      };
      if (filledCount === 0) { attrs['stroke-dasharray'] = '5 4'; attrs['stroke-width'] = 2; }
      const line = svgEl('line', attrs);
      svg.appendChild(withTitle(line,
        `MO: ${mc.e.toFixed(3)} eV (×${mc.members.length}, ${filledCount ? 'filled' : 'empty'}) — ${compTxt}`));
      if (mc.members.length > 1) {
        const lbl = svgEl('text', { x: cols.mo.x1 + 5, y: y(mc.e) + 3.5, class: 'tick-label' });
        lbl.textContent = `×${mc.members.length}`;
        svg.appendChild(lbl);
      }
    }

    // Column captions
    for (const [colKey, names] of [['left', leftEls.join('/')], ['mo', 'MO'], ['right', rightEls.join('/')]]) {
      const c = cols[colKey];
      const t = svgEl('text', { x: (c.x0 + c.x1) / 2, y: P.h - 8, 'text-anchor': 'middle', class: 'tick-label' });
      t.textContent = names;
      svg.appendChild(t);
    }
  }

  el('mo-details').addEventListener('toggle', () => {
    if (el('mo-details').open && lastResult) {
      drawPdosPanel(el('mo-pdos'), MO_PDOS_PLOT, !lastMaskAllOn);
      renderMo();
    }
  });

  // ---- H(R=0) matrix view ----
  function buildMatrixView(h0) {
    const box = el('matrix');
    const n = nw;
    const cellFor = (v) => {
      const t = Math.max(-1, Math.min(1, v / 3)); // clip color scale at ±3 eV
      const light = 96 - Math.abs(t) * 44;
      const hue = t >= 0 ? 8 : 214;
      const sat = Math.abs(t) * 78;
      return `hsl(${hue} ${sat}% ${light}%)`;
    };
    let html = '<div class="mrow mhead"><span class="mlabel"></span>';
    for (let j = 0; j < n; j++) html += `<span class="mlabel mcol" title="${orbLabels[j]}">${j + 1}</span>`;
    html += '</div>';
    for (let i = 0; i < n; i++) {
      html += `<div class="mrow"><span class="mlabel" title="${orbLabels[i]}">${orbLabels[i]}</span>`;
      for (let j = 0; j < n; j++) {
        const v = h0[i * n + j];
        html += `<span class="mcell" data-i="${i}" data-j="${j}" style="background:${cellFor(v)}" title="${orbLabels[i]} | ${orbLabels[j]}: ${v.toFixed(3)} eV"></span>`;
      }
      html += '</div>';
    }
    box.innerHTML = html;
  }
}
