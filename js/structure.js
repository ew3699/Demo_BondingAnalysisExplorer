import { elementData } from './elements.js';

const EPS = 1e-4;
const BOND_TOLERANCE = 1.25; // bond if d < tolerance × (r_cov,i + r_cov,j)

export class Structure {
  constructor({ lattice, sites }) {
    this.lattice = lattice; // 3×3, rows are lattice vectors (Å)
    this.sites = sites; // { element, label, oxidation, frac }
  }

  cartToFrac([x, y, z]) {
    if (!this._inv) {
      const [a, b, c] = this.lattice;
      const det =
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
      // Inverse of the (row-vector) lattice matrix, for r·L⁻¹.
      this._inv = [
        [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
        [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
        [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
      ];
    }
    const m = this._inv;
    return [
      x * m[0][0] + y * m[1][0] + z * m[2][0],
      x * m[0][1] + y * m[1][1] + z * m[2][1],
      x * m[0][2] + y * m[1][2] + z * m[2][2],
    ];
  }

  fracToCart([fa, fb, fc]) {
    const [a, b, c] = this.lattice;
    return [
      fa * a[0] + fb * b[0] + fc * c[0],
      fa * a[1] + fb * b[1] + fc * c[1],
      fa * a[2] + fb * b[2] + fc * c[2],
    ];
  }

  get latticeParams() {
    const [a, b, c] = this.lattice;
    const norm = (v) => Math.hypot(...v);
    const angle = (u, v) =>
      (Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))) * 180) / Math.PI;
    return {
      a: norm(a), b: norm(b), c: norm(c),
      alpha: angle(b, c), beta: angle(a, c), gamma: angle(a, b),
    };
  }

  get volume() {
    const [a, b, c] = this.lattice;
    return Math.abs(
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    );
  }

  // g/cm³
  get density() {
    const massAmu = this.sites.reduce((m, s) => m + elementData(s.element).mass, 0);
    return (massAmu * 1.66053907) / this.volume;
  }

  get composition() {
    const counts = new Map();
    for (const s of this.sites) counts.set(s.element, (counts.get(s.element) ?? 0) + 1);
    return counts;
  }

  // Reduced formula as [[element, count], ...], e.g. [["Bi",1],["O",1],["Cl",1]]
  get reducedFormula() {
    const counts = [...this.composition.entries()];
    const gcd = (x, y) => (y ? gcd(y, x % y) : x);
    const g = counts.map(([, n]) => n).reduce(gcd);
    return counts.map(([el, n]) => [el, n / g]);
  }

  /**
   * Atoms to display for an (na × nb × nc) supercell, including duplicate images
   * on cell boundaries so faces/edges/corners look complete.
   * Returns { element, label, oxidation, frac, cart, siteIndex }[].
   */
  displayAtoms(na = 1, nb = 1, nc = 1) {
    const dims = [na, nb, nc];
    const atoms = [];
    this.sites.forEach((site, siteIndex) => {
      // Wrap into [0,1) first so e.g. frac 1.0 is treated like 0.0.
      const base = site.frac.map((f) => ((f % 1) + 1) % 1);
      for (let i = 0; i <= na; i++) {
        for (let j = 0; j <= nb; j++) {
          for (let k = 0; k <= nc; k++) {
            const f = [base[0] + i, base[1] + j, base[2] + k];
            if (f.every((x, d) => x <= dims[d] + EPS)) {
              atoms.push({ ...site, frac: f, cart: this.fracToCart(f), siteIndex });
            }
          }
        }
      }
    });
    return atoms;
  }

  /** Bonds between displayed atoms: pairs of indices into the displayAtoms array. */
  bonds(atoms) {
    const out = [];
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        const ri = elementData(atoms[i].element).covalentRadius;
        const rj = elementData(atoms[j].element).covalentRadius;
        const cutoff = BOND_TOLERANCE * (ri + rj);
        const dx = atoms[i].cart[0] - atoms[j].cart[0];
        const dy = atoms[i].cart[1] - atoms[j].cart[1];
        const dz = atoms[i].cart[2] - atoms[j].cart[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > EPS && d2 < cutoff * cutoff) {
          out.push({ i, j, length: Math.sqrt(d2) });
        }
      }
    }
    return out;
  }
}
