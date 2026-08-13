import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementData, displayRadius } from './elements.js';

const SPHERE_SEGMENTS = 32;
const BOND_RADIUS = 0.11;

export class StructureViewer {
  /**
   * @param {HTMLElement} container
   * @param {{tooltip: HTMLElement, onStatus?: (msg: string) => void}} opts
   */
  constructor(container, { tooltip, onStatus } = {}) {
    this.container = container;
    this.tooltip = tooltip;
    this.onStatus = onStatus ?? (() => {});
    this.showBonds = true;
    this.showCell = true;
    this.showLabels = false;
    this.selected = []; // up to two atom meshes, for distance measurement

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    this.camera.up.set(0, 0, 1); // crystallographic c points up

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.scene.add(this.keyLight);
    const fill = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.6);
    this.scene.add(fill);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.structureGroup = new THREE.Group();
    this.scene.add(this.structureGroup);

    // Extra scene content (isosurfaces, slice planes, …) that survives structure rebuilds.
    this.overlay = new THREE.Group();
    this.scene.add(this.overlay);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.atomMeshes = [];

    this.renderer.domElement.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.pointerDownAt = [e.clientX, e.clientY];
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const [x0, y0] = this.pointerDownAt ?? [0, 0];
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < 5) this.#onClick(e);
    });

    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();

    const animate = () => {
      requestAnimationFrame(animate);
      this.controls.update();
      // Keep the key light over the camera's shoulder.
      this.keyLight.position.copy(this.camera.position);
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  /**
   * @param {import('./structure.js').Structure} structure
   * @param {[number, number, number]} supercell
   */
  setStructure(structure, supercell = [1, 1, 1]) {
    this.structure = structure;
    this.supercell = supercell;
    this.#rebuild();
    this.resetCamera();
  }

  setOptions({ showBonds, showCell, showLabels }) {
    if (showBonds !== undefined) this.showBonds = showBonds;
    if (showCell !== undefined) this.showCell = showCell;
    if (showLabels !== undefined) this.showLabels = showLabels;
    this.#rebuild();
  }

  setSupercell(supercell) {
    this.supercell = supercell;
    this.#rebuild();
    this.resetCamera();
  }

  resetCamera() {
    const box = new THREE.Box3().setFromObject(this.structureGroup);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 4);
    const dist = radius / Math.tan((this.camera.fov * Math.PI) / 360) * 1.15;
    const dir = new THREE.Vector3(0.6, -1, 0.38).normalize();
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    this.controls.target.copy(center);
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  #rebuild() {
    if (!this.structure) return;
    this.structureGroup.clear();
    this.atomMeshes = [];
    this.selected = [];
    this.onStatus('');

    const atoms = this.structure.displayAtoms(...this.supercell);

    // Atoms
    for (const atom of atoms) {
      const { color } = elementData(atom.element);
      const geo = new THREE.SphereGeometry(displayRadius(atom.element), SPHERE_SEGMENTS, SPHERE_SEGMENTS);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...atom.cart);
      mesh.userData.atom = atom;
      this.structureGroup.add(mesh);
      this.atomMeshes.push(mesh);

      if (this.showLabels) this.structureGroup.add(this.#makeLabel(atom));
    }

    // Bonds: two half-cylinders so each end takes its atom's color.
    if (this.showBonds) {
      for (const bond of this.structure.bonds(atoms)) {
        const a = new THREE.Vector3(...atoms[bond.i].cart);
        const b = new THREE.Vector3(...atoms[bond.j].cart);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        this.structureGroup.add(this.#halfBond(a, mid, elementData(atoms[bond.i].element).color));
        this.structureGroup.add(this.#halfBond(mid, b, elementData(atoms[bond.j].element).color));
      }
    }

    // Unit cell (of the full displayed supercell)
    if (this.showCell) this.structureGroup.add(this.#cellLines());
  }

  #halfBond(from, to, color) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(BOND_RADIUS, BOND_RADIUS, len, 12, 1, true);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from.clone().add(to).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return mesh;
  }

  #cellLines() {
    const [na, nb, nc] = this.supercell;
    const [av, bv, cv] = this.structure.lattice.map((v) => new THREE.Vector3(...v));
    const A = av.clone().multiplyScalar(na);
    const B = bv.clone().multiplyScalar(nb);
    const C = cv.clone().multiplyScalar(nc);
    const O = new THREE.Vector3(0, 0, 0);
    const corners = [O, A, B, C, A.clone().add(B), A.clone().add(C), B.clone().add(C), A.clone().add(B).add(C)];
    const edges = [[0,1],[0,2],[0,3],[1,4],[1,5],[2,4],[2,6],[3,5],[3,6],[4,7],[5,7],[6,7]];
    const pts = [];
    for (const [i, j] of edges) pts.push(corners[i], corners[j]);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x30435c, transparent: true, opacity: 0.55 });
    return new THREE.LineSegments(geo, mat);
  }

  #makeLabel(atom) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '600 40px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1c2733';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 7;
    ctx.strokeText(atom.element, 64, 32);
    ctx.fillText(atom.element, 64, 32);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
    );
    sprite.scale.set(1.1, 0.55, 1);
    sprite.position.set(atom.cart[0], atom.cart[1], atom.cart[2] + displayRadius(atom.element) + 0.35);
    return sprite;
  }

  #pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.atomMeshes, false)[0] ?? null;
  }

  #onPointerMove(event) {
    const hit = this.#pick(event);
    if (hit) {
      const { atom } = hit.object.userData;
      const f = atom.frac.map((x) => x.toFixed(3)).join(', ');
      this.tooltip.textContent = `${atom.label ?? atom.element}  (${f})`;
      const rect = this.container.getBoundingClientRect();
      this.tooltip.style.left = `${event.clientX - rect.left}px`;
      this.tooltip.style.top = `${event.clientY - rect.top}px`;
      this.tooltip.hidden = false;
      this.container.style.cursor = 'pointer';
    } else {
      this.tooltip.hidden = true;
      this.container.style.cursor = 'default';
    }
  }

  #onClick(event) {
    const hit = this.#pick(event);
    if (!hit) {
      this.#clearSelection();
      this.onStatus('');
      return;
    }
    const mesh = hit.object;
    if (this.selected.includes(mesh)) {
      this.#clearSelection();
      this.onStatus('');
      return;
    }
    if (this.selected.length === 2) this.#clearSelection();
    this.selected.push(mesh);
    mesh.material.emissive = new THREE.Color(0x3577d4);
    mesh.material.emissiveIntensity = 0.55;

    const [m1, m2] = this.selected;
    const name = (m) => m.userData.atom.label ?? m.userData.atom.element;
    if (this.selected.length === 2) {
      const d = m1.position.distanceTo(m2.position);
      this.onStatus(`${name(m1)} – ${name(m2)} distance: ${d.toFixed(3)} Å`);
    } else {
      this.onStatus(`Selected ${name(m1)} — click a second atom to measure a distance`);
    }
  }

  #clearSelection() {
    for (const m of this.selected) m.material.emissiveIntensity = 0;
    this.selected = [];
  }

  #resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
