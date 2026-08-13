// Parser + sampler for VASP CHGCAR/ELFCAR-style volumetric files.
// Grid values are stored x-fastest: index = ix + nx*(iy + ny*iz),
// with point (ix,iy,iz) at fractional (ix/nx, iy/ny, iz/nz), periodic.

export function parseVolumetric(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const scale = parseFloat(lines[1]);
  const lattice = [2, 3, 4].map((i) =>
    lines[i].trim().split(/\s+/).map((x) => parseFloat(x) * scale)
  );
  const counts = lines[6].trim().split(/\s+/).map(Number);
  if (counts.some(Number.isNaN)) throw new Error('Expected VASP 5+ header with element symbols');
  const natoms = counts.reduce((a, b) => a + b, 0);

  const dimsLine = 8 + natoms; // comment, scale, 3×lattice, symbols, counts, Direct, coords…
  const dims = lines[dimsLine].trim().split(/\s+/).map(Number);
  if (dims.length !== 3 || dims.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error(`Could not read grid dimensions (got "${lines[dimsLine]}")`);
  }
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;

  const data = new Float32Array(n);
  let filled = 0;
  let min = Infinity;
  let max = -Infinity;
  // Only read the first grid block (spin-polarized files carry a second one).
  for (let li = dimsLine + 1; li < lines.length && filled < n; li++) {
    for (const tok of lines[li].trim().split(/\s+/)) {
      const v = parseFloat(tok);
      data[filled++] = v;
      if (v < min) min = v;
      if (v > max) max = v;
      if (filled === n) break;
    }
  }
  if (filled < n) throw new Error(`Grid data truncated: ${filled}/${n} values`);

  return { lattice, dims, data, min, max };
}

/** Trilinear interpolation at fractional coords, periodic in all directions. */
export function sampleVolume(volume, fx, fy, fz) {
  const [nx, ny, nz] = volume.dims;
  const { data } = volume;
  const wrap = (v) => ((v % 1) + 1) % 1;
  const gx = wrap(fx) * nx;
  const gy = wrap(fy) * ny;
  const gz = wrap(fz) * nz;
  const x0 = Math.floor(gx) % nx, y0 = Math.floor(gy) % ny, z0 = Math.floor(gz) % nz;
  const x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny, z1 = (z0 + 1) % nz;
  const tx = gx - Math.floor(gx), ty = gy - Math.floor(gy), tz = gz - Math.floor(gz);
  const at = (i, j, k) => data[i + nx * (j + ny * k)];
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(at(x0, y0, z0), at(x1, y0, z0), tx), lerp(at(x0, y1, z0), at(x1, y1, z0), tx), ty),
    lerp(lerp(at(x0, y0, z1), at(x1, y0, z1), tx), lerp(at(x0, y1, z1), at(x1, y1, z1), tx), ty),
    tz
  );
}
