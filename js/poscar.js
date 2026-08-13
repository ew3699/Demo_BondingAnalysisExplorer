// Minimal VASP POSCAR parser (direct or cartesian coordinates, VASP5+ element line).
// Site labels after coordinates (e.g. "Bi3+") are kept as oxidation-state annotations.

export function parsePoscar(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 8) throw new Error('POSCAR too short');

  const comment = lines[0].trim();
  const scale = parseFloat(lines[1]);
  const lattice = [2, 3, 4].map((i) =>
    lines[i].trim().split(/\s+/).map((x) => parseFloat(x) * scale)
  );

  // Normalize POTCAR-style names ("Bi_d/572e7eac3" → "Bi"), as found in CHGCAR/ELFCAR headers.
  const symbols = lines[5].trim().split(/\s+/).map((s) => s.split('/')[0].split('_')[0]);
  const counts = lines[6].trim().split(/\s+/).map(Number);
  if (counts.some(Number.isNaN)) {
    throw new Error('POSCAR must contain an element-symbol line (VASP 5+ format)');
  }

  let cursor = 7;
  if (/^s/i.test(lines[cursor].trim())) cursor += 1; // selective dynamics
  const direct = /^[dD]/.test(lines[cursor].trim());
  cursor += 1;

  const sites = [];
  for (let s = 0; s < symbols.length; s++) {
    for (let n = 0; n < counts[s]; n++) {
      const parts = lines[cursor].trim().split(/\s+/);
      const pos = parts.slice(0, 3).map(Number);
      const label = parts.length > 3 && Number.isNaN(Number(parts[3])) ? parts[3] : null;
      sites.push({
        element: symbols[s],
        label,
        oxidation: label ? label.replace(symbols[s], '') : null,
        frac: direct ? pos : cartToFrac(pos, lattice),
      });
      cursor += 1;
    }
  }

  return { comment, lattice, sites };
}

function cartToFrac(pos, lattice) {
  // Solve pos = f · L (rows of L are lattice vectors) via inverse of L^T.
  const [a, b, c] = lattice;
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  const inv = [
    [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
  return [0, 1, 2].map((i) => pos[0] * inv[0][i] + pos[1] * inv[1][i] + pos[2] * inv[2][i]);
}
