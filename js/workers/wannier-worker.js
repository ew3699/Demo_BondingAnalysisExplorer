// Web Worker: heavy Wannier TB computations off the UI thread.
import { parseHr, solveKpoints, pdosFromSolution } from '../wannier.js';

let hr = null;

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      const r = await fetch(msg.url);
      if (!r.ok) throw new Error(`HTTP ${r.status} loading ${msg.url}`);
      hr = parseHr(await r.text());
      // H(R=0) block, for the matrix view and the MO-diagram tool.
      let h0 = null;
      let h0im = null;
      for (let rr = 0; rr < hr.nrpts; rr++) {
        if (hr.irvec[rr * 3] === 0 && hr.irvec[rr * 3 + 1] === 0 && hr.irvec[rr * 3 + 2] === 0) {
          h0 = hr.hamRe.slice(rr * hr.nw * hr.nw, (rr + 1) * hr.nw * hr.nw);
          h0im = hr.hamIm.slice(rr * hr.nw * hr.nw, (rr + 1) * hr.nw * hr.nw);
          break;
        }
      }
      self.postMessage({ type: 'ready', nw: hr.nw, nrpts: hr.nrpts, h0, h0im });
    } else if (msg.type === 'compute') {
      const { id, mask, maskMode, klist, pdos } = msg;
      const m = mask ? Uint8Array.from(mask) : null;

      const bandSol = solveKpoints(hr, klist, m, true, (done, total) =>
        self.postMessage({ type: 'progress', id, stage: 'band path', done, total }), maskMode
      );

      const [nx, ny, nz] = pdos.grid;
      const kg = new Float64Array(nx * ny * nz * 3);
      let p = 0;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          for (let l = 0; l < nz; l++) {
            kg[p++] = i / nx; kg[p++] = j / ny; kg[p++] = l / nz;
          }
        }
      }
      const gridSol = solveKpoints(hr, kg, m, true, (done, total) =>
        self.postMessage({ type: 'progress', id, stage: 'PDOS grid', done, total }), maskMode
      );
      const { x, curves, total } = pdosFromSolution(
        gridSol, pdos.groups, pdos.emin, pdos.emax, pdos.npts, pdos.sigma
      );

      self.postMessage({
        type: 'result',
        id,
        nw: hr.nw,
        bands: bandSol.energies,
        bandWeights: bandSol.weights,
        pdosX: x,
        pdosCurves: curves.map((c) => ({ label: c.label, y: c.y })),
        pdosTotal: total,
      });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err.message });
  }
};
