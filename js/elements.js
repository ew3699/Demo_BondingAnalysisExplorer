// Per-element display and physical data.
// colors: Jmol/CPK. covalentRadius (Å): Cordero et al. 2008. mass: standard atomic weight (amu).
// electronegativity: Pauling scale (PubChem periodic table).
export const ELEMENTS = {
  H:  { color: '#ffffff', covalentRadius: 0.31, mass: 1.008,   electronegativity: 2.20 },
  C:  { color: '#909090', covalentRadius: 0.76, mass: 12.011,  electronegativity: 2.55 },
  N:  { color: '#3050f8', covalentRadius: 0.71, mass: 14.007,  electronegativity: 3.04 },
  O:  { color: '#ff0d0d', covalentRadius: 0.66, mass: 15.999,  electronegativity: 3.44 },
  F:  { color: '#90e050', covalentRadius: 0.57, mass: 18.998,  electronegativity: 3.98 },
  S:  { color: '#ffff30', covalentRadius: 1.05, mass: 32.06,   electronegativity: 2.58 },
  Cl: { color: '#1ff01f', covalentRadius: 1.02, mass: 35.45,   electronegativity: 3.16 },
  Br: { color: '#a62929', covalentRadius: 1.20, mass: 79.904,  electronegativity: 2.96 },
  I:  { color: '#940094', covalentRadius: 1.39, mass: 126.904, electronegativity: 2.66 },
  Se: { color: '#ffa100', covalentRadius: 1.20, mass: 78.971,  electronegativity: 2.55 },
  Te: { color: '#d47a00', covalentRadius: 1.38, mass: 127.60,  electronegativity: 2.10 },
  Bi: { color: '#9e4fb5', covalentRadius: 1.48, mass: 208.980, electronegativity: 2.02 },
  Pb: { color: '#575961', covalentRadius: 1.46, mass: 207.2,   electronegativity: 2.33 },
  Sn: { color: '#668080', covalentRadius: 1.39, mass: 118.710, electronegativity: 1.96 },
  Sb: { color: '#9e63b5', covalentRadius: 1.39, mass: 121.760, electronegativity: 2.05 },
};

const FALLBACK = { color: '#cccccc', covalentRadius: 1.4, mass: 0 };

export function elementData(symbol) {
  return ELEMENTS[symbol] ?? FALLBACK;
}

// Sphere radius used for drawing, in Å.
export function displayRadius(symbol) {
  return elementData(symbol).covalentRadius * 0.42 + 0.18;
}
