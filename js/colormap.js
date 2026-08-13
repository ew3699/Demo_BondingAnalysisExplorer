// Perceptually-uniform sequential colormaps (anchor stops, linearly interpolated).
// Rainbow/jet is deliberately not offered: magnitude data gets a uniform ramp.

const STOPS = {
  viridis: [
    [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
    [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
  ],
  magma: [
    [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122],
    [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191], [252, 253, 191],
  ],
  grayscale: [
    [245, 246, 248], [218, 221, 226], [190, 195, 203], [161, 168, 179], [132, 141, 155],
    [104, 114, 130], [77, 87, 104], [51, 60, 77], [28, 35, 50], [10, 15, 26],
  ],
};

export const COLORMAPS = Object.keys(STOPS);

/** t in [0,1] → [r,g,b] 0-255 */
export function colormap(name, t) {
  const stops = STOPS[name] ?? STOPS.viridis;
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  return [0, 1, 2].map((c) => Math.round(stops[i][c] + f * (stops[i + 1][c] - stops[i][c])));
}

/** Draw a horizontal colorbar with end labels into a canvas. */
export function drawColorbar(canvas, name, lo = 0, hi = 1, label = '') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const barH = h - 16;
  for (let x = 0; x < w; x++) {
    const [r, g, b] = colormap(name, x / (w - 1));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, 0, 1, barH);
  }
  ctx.strokeStyle = '#c6ccd4';
  ctx.strokeRect(0.5, 0.5, w - 1, barH - 1);
  ctx.fillStyle = '#5b6b7b';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(lo.toFixed(2), 0, barH + 3);
  ctx.textAlign = 'right';
  ctx.fillText(hi.toFixed(2), w, barH + 3);
  if (label) {
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, barH + 3);
  }
}
