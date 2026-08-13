// Marching cubes over a periodic fractional-coordinate grid (any lattice, incl. non-orthogonal).
// Uses the classic Bourke lookup tables shipped with three.js. Smooth shading comes from
// the field gradient (central differences), so no vertex merging is needed.
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';
import { sampleVolume } from './volumetric.js';

const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const EDGE = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * @param {{dims: number[], data: Float32Array}} volume
 * @param {number} iso isovalue
 * @param {import('./structure.js').Structure} structure supplies frac↔cart transforms
 * @returns {THREE.BufferGeometry} smooth-shaded triangle mesh in cartesian Å
 */
export function isosurfaceGeometry(volume, iso, structure) {
  const [nx, ny, nz] = volume.dims;
  const { data } = volume;
  const fracVerts = []; // flat [fx,fy,fz, ...]
  const vals = new Float32Array(8);
  const fpos = [[], [], [], [], [], [], [], []];
  const vert = [[], [], [], [], [], [], [], [], [], [], [], []];

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const ci = (i + CORNER[c][0]) % nx;
          const cj = (j + CORNER[c][1]) % ny;
          const ck = (k + CORNER[c][2]) % nz;
          vals[c] = data[ci + nx * (cj + ny * ck)];
          fpos[c][0] = (i + CORNER[c][0]) / nx;
          fpos[c][1] = (j + CORNER[c][1]) / ny;
          fpos[c][2] = (k + CORNER[c][2]) / nz;
          if (vals[c] < iso) cubeIndex |= 1 << c;
        }
        const edges = edgeTable[cubeIndex];
        if (edges === 0) continue;

        for (let e = 0; e < 12; e++) {
          if (edges & (1 << e)) {
            const [a, b] = EDGE[e];
            const t = (iso - vals[a]) / (vals[b] - vals[a]);
            vert[e][0] = fpos[a][0] + t * (fpos[b][0] - fpos[a][0]);
            vert[e][1] = fpos[a][1] + t * (fpos[b][1] - fpos[a][1]);
            vert[e][2] = fpos[a][2] + t * (fpos[b][2] - fpos[a][2]);
          }
        }
        for (let t = cubeIndex * 16; triTable[t] !== -1; t += 3) {
          for (const e of [triTable[t], triTable[t + 1], triTable[t + 2]]) {
            fracVerts.push(vert[e][0], vert[e][1], vert[e][2]);
          }
        }
      }
    }
  }

  const n = fracVerts.length / 3;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  // Rows of the inverse lattice, to rotate fractional gradients into cartesian space.
  const inv = [
    structure.cartToFrac([1, 0, 0]),
    structure.cartToFrac([0, 1, 0]),
    structure.cartToFrac([0, 0, 1]),
  ];
  const h = [1 / nx, 1 / ny, 1 / nz];

  for (let v = 0; v < n; v++) {
    const fx = fracVerts[3 * v], fy = fracVerts[3 * v + 1], fz = fracVerts[3 * v + 2];
    const [cx, cy, cz] = structure.fracToCart([fx, fy, fz]);
    positions[3 * v] = cx;
    positions[3 * v + 1] = cy;
    positions[3 * v + 2] = cz;

    // Outward normal = -∇ELF (surface encloses the high-ELF region).
    const g = [
      (sampleVolume(volume, fx + h[0], fy, fz) - sampleVolume(volume, fx - h[0], fy, fz)) / (2 * h[0]),
      (sampleVolume(volume, fx, fy + h[1], fz) - sampleVolume(volume, fx, fy - h[1], fz)) / (2 * h[1]),
      (sampleVolume(volume, fx, fy, fz + h[2]) - sampleVolume(volume, fx, fy, fz - h[2])) / (2 * h[2]),
    ];
    let gx = g[0] * inv[0][0] + g[1] * inv[0][1] + g[2] * inv[0][2];
    let gy = g[0] * inv[1][0] + g[1] * inv[1][1] + g[2] * inv[1][2];
    let gz = g[0] * inv[2][0] + g[1] * inv[2][1] + g[2] * inv[2][2];
    const len = Math.hypot(gx, gy, gz) || 1;
    normals[3 * v] = -gx / len;
    normals[3 * v + 1] = -gy / len;
    normals[3 * v + 2] = -gz / len;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}
