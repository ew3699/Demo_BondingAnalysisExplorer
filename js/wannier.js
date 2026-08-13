// Wannier90 tight-binding tools, following alexandrub53/Wannier90HamiltonianTools
// (wanbandsrotorbs.m / GetPdosAndNFromWan.m / broaden.m), reimplemented for the browser.
//
// H(k)_mn = Σ_R e^{i 2π k·R} H(R)_mn / deg(R), Hermitized as (H + H†)/2.
// Orbitals always keep their (k-dependent) diagonal element; off-diagonal couplings
// are filtered by the mask under one of two rules (the two branches of wanbandsrotorbs.m):
//   maskMode 'off' (off-priority): coupling (i,j) survives only if BOTH orbitals are on.
//   maskMode 'on'  (on-priority):  coupling (i,j) survives if EITHER orbital is on,
//                                  so a single "on" orbital mixes with everything.

/** Parse a wannier90 seedname_hr.dat file. */
export function parseHr(text) {
  const tok = text.split(/\s+/).filter((t) => t.length > 0);
  // Header line is free text ("written on ..."): find the first token that parses
  // as an integer — everything before it is the comment.
  let p = 0;
  while (p < tok.length && !/^\d+$/.test(tok[p])) p++;
  const nw = parseInt(tok[p++], 10);
  const nrpts = parseInt(tok[p++], 10);
  const deg = new Float64Array(nrpts);
  for (let r = 0; r < nrpts; r++) deg[r] = parseInt(tok[p++], 10);

  const nl = nrpts * nw * nw;
  const irvec = new Int32Array(nrpts * 3);
  const hamRe = new Float64Array(nl); // [r][m][n] → r*nw*nw + m*nw + n
  const hamIm = new Float64Array(nl);
  for (let e = 0; e < nl; e++) {
    const R1 = parseInt(tok[p], 10), R2 = parseInt(tok[p + 1], 10), R3 = parseInt(tok[p + 2], 10);
    const m = parseInt(tok[p + 3], 10) - 1;
    const n = parseInt(tok[p + 4], 10) - 1;
    const re = parseFloat(tok[p + 5]);
    const im = parseFloat(tok[p + 6]);
    p += 7;
    const r = Math.floor(e / (nw * nw));
    if (m === 0 && n === 0) {
      irvec[r * 3] = R1; irvec[r * 3 + 1] = R2; irvec[r * 3 + 2] = R3;
    }
    hamRe[r * nw * nw + m * nw + n] = re;
    hamIm[r * nw * nw + m * nw + n] = im;
  }
  return { nw, nrpts, deg, irvec, hamRe, hamIm };
}

/**
 * Build H(k) at fractional k = [k1,k2,k3]; result written into out{Re,Im} (nw×nw row-major).
 * mask[i] = 1 marks orbital i "on"; maskMode ('off' | 'on') selects the coupling rule above.
 */
export function buildHk(hr, k, mask, outRe, outIm, maskMode = 'off') {
  const { nw, nrpts, deg, irvec, hamRe, hamIm } = hr;
  const n2 = nw * nw;
  outRe.fill(0);
  outIm.fill(0);
  for (let r = 0; r < nrpts; r++) {
    const phase = 2 * Math.PI * (k[0] * irvec[r * 3] + k[1] * irvec[r * 3 + 1] + k[2] * irvec[r * 3 + 2]);
    const c = Math.cos(phase) / deg[r];
    const s = Math.sin(phase) / deg[r];
    const off = r * n2;
    for (let e = 0; e < n2; e++) {
      const re = hamRe[off + e];
      const im = hamIm[off + e];
      outRe[e] += re * c - im * s;
      outIm[e] += re * s + im * c;
    }
  }
  // Hermitize: H ← (H + H†)/2
  for (let i = 0; i < nw; i++) {
    for (let j = i; j < nw; j++) {
      const re = 0.5 * (outRe[i * nw + j] + outRe[j * nw + i]);
      const im = 0.5 * (outIm[i * nw + j] - outIm[j * nw + i]);
      outRe[i * nw + j] = re; outIm[i * nw + j] = im;
      outRe[j * nw + i] = re; outIm[j * nw + i] = -im;
    }
  }
  if (mask) {
    for (let i = 0; i < nw; i++) {
      for (let j = 0; j < nw; j++) {
        if (j === i) continue;
        const keep = maskMode === 'on' ? (mask[i] || mask[j]) : (mask[i] && mask[j]);
        if (!keep) { outRe[i * nw + j] = 0; outIm[i * nw + j] = 0; }
      }
    }
  }
}

/**
 * Eigen-decomposition of a complex Hermitian matrix (cyclic Jacobi with phase rotations).
 * A/B are the real/imag parts (row-major n×n); they are DESTROYED.
 * Returns { values: Float64Array(n) ascending, weights: Float64Array(n*n) }
 * where weights[orb*n + band] = |⟨orb|band⟩|².
 */
export function eighHermitian(A, B, n) {
  const Vr = new Float64Array(n * n);
  const Vi = new Float64Array(n * n);
  for (let i = 0; i < n; i++) Vr[i * n + i] = 1;

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) off += A[i * n + j] ** 2 + B[i * n + j] ** 2;
    }
    if (off < 1e-20) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apqr = A[p * n + q];
        const apqi = B[p * n + q];
        const mag = Math.hypot(apqr, apqi);
        if (mag < 1e-14) continue;

        // Phase rotation so H[p][q] becomes real: col q ×= e^{-iα}, row q ×= e^{iα}.
        const ca = apqr / mag;
        const sa = apqi / mag;
        for (let t = 0; t < n; t++) {
          const cr = A[t * n + q], ci = B[t * n + q];
          A[t * n + q] = cr * ca + ci * sa;
          B[t * n + q] = ci * ca - cr * sa;
        }
        for (let t = 0; t < n; t++) {
          const rr = A[q * n + t], ri = B[q * n + t];
          A[q * n + t] = rr * ca - ri * sa;
          B[q * n + t] = ri * ca + rr * sa;
        }
        for (let t = 0; t < n; t++) {
          const vr = Vr[t * n + q], vi = Vi[t * n + q];
          Vr[t * n + q] = vr * ca + vi * sa;
          Vi[t * n + q] = vi * ca - vr * sa;
        }

        // Real Jacobi rotation on (p,q).
        const app = A[p * n + p];
        const aqq = A[q * n + q];
        const tau = (aqq - app) / (2 * mag);
        const t0 = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : 1 / (tau - Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t0 * t0);
        const s = t0 * c;
        for (let t = 0; t < n; t++) {
          const akp = A[t * n + p], bkp = B[t * n + p];
          const akq = A[t * n + q], bkq = B[t * n + q];
          A[t * n + p] = c * akp - s * akq; B[t * n + p] = c * bkp - s * bkq;
          A[t * n + q] = s * akp + c * akq; B[t * n + q] = s * bkp + c * bkq;
        }
        for (let t = 0; t < n; t++) {
          const apk = A[p * n + t], bpk = B[p * n + t];
          const aqk = A[q * n + t], bqk = B[q * n + t];
          A[p * n + t] = c * apk - s * aqk; B[p * n + t] = c * bpk - s * bqk;
          A[q * n + t] = s * apk + c * aqk; B[q * n + t] = s * bpk + c * bqk;
        }
        for (let t = 0; t < n; t++) {
          const vkp = Vr[t * n + p], wkp = Vi[t * n + p];
          const vkq = Vr[t * n + q], wkq = Vi[t * n + q];
          Vr[t * n + p] = c * vkp - s * vkq; Vi[t * n + p] = c * wkp - s * wkq;
          Vr[t * n + q] = s * vkp + c * vkq; Vi[t * n + q] = s * wkp + c * wkq;
        }
      }
    }
  }

  const order = [...Array(n).keys()].sort((a, b) => A[a * n + a] - A[b * n + b]);
  const values = new Float64Array(n);
  const weights = new Float64Array(n * n);
  for (let b = 0; b < n; b++) {
    const col = order[b];
    values[b] = A[col * n + col];
    for (let orb = 0; orb < n; orb++) {
      weights[orb * n + b] = Vr[orb * n + col] ** 2 + Vi[orb * n + col] ** 2;
    }
  }
  return { values, weights };
}

/** Diagonalize H(k) for a list of fractional k-points. Returns per-k eigenvalues (+weights). */
export function solveKpoints(hr, klist, mask, wantWeights, onProgress, maskMode = 'off') {
  const { nw } = hr;
  const nk = klist.length / 3;
  const energies = new Float64Array(nk * nw);
  const weights = wantWeights ? new Float64Array(nk * nw * nw) : null;
  const hRe = new Float64Array(nw * nw);
  const hIm = new Float64Array(nw * nw);
  for (let ik = 0; ik < nk; ik++) {
    buildHk(hr, [klist[3 * ik], klist[3 * ik + 1], klist[3 * ik + 2]], mask, hRe, hIm, maskMode);
    const { values, weights: w } = eighHermitian(hRe, hIm, nw);
    energies.set(values, ik * nw);
    if (weights) weights.set(w, ik * nw * nw);
    if (onProgress && (ik % 16 === 15 || ik === nk - 1)) onProgress(ik + 1, nk);
  }
  return { energies, weights, nk, nw };
}

/**
 * Gaussian-broadened PDOS per orbital group (broaden.m, btype=2), ×2 for spin.
 * groups: array of { label, orbitals: number[] }.
 * Returns { x: Float64Array, curves: [{label, y: Float64Array}], total: Float64Array }
 * in states/eV per unit cell.
 */
export function pdosFromSolution(sol, groups, emin, emax, npts, sigma) {
  const { energies, weights, nk, nw } = sol;
  const x = new Float64Array(npts);
  const de = (emax - emin) / (npts - 1);
  for (let i = 0; i < npts; i++) x[i] = emin + i * de;

  const norm = 2 / (nk * Math.sqrt(2 * Math.PI) * sigma); // 2 = spin
  const cut = 6 * sigma;
  const curves = groups.map((g) => ({ label: g.label, y: new Float64Array(npts) }));

  for (let ik = 0; ik < nk; ik++) {
    for (let b = 0; b < nw; b++) {
      const e = energies[ik * nw + b];
      if (e < emin - cut || e > emax + cut) continue;
      const i0 = Math.max(0, Math.ceil((e - cut - emin) / de));
      const i1 = Math.min(npts - 1, Math.floor((e + cut - emin) / de));
      for (let gi = 0; gi < groups.length; gi++) {
        let w = 0;
        for (const orb of groups[gi].orbitals) w += weights[ik * nw * nw + orb * nw + b];
        if (w < 1e-12) continue;
        const y = curves[gi].y;
        for (let i = i0; i <= i1; i++) {
          const d = (x[i] - e) / sigma;
          y[i] += w * norm * Math.exp(-0.5 * d * d);
        }
      }
    }
  }
  const total = new Float64Array(npts);
  for (const c of curves) for (let i = 0; i < npts; i++) total[i] += c.y[i];
  return { x, curves, total };
}
