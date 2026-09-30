// Convergence map: number of iterations as a function of the initial iterate x0 (horizontal) and the
// right-hand side r (vertical), one cell per run, as in the maps of the thesis. Failed runs are hatched.
// The exact solution x̄(r) is drawn over it, and a dot marks the current (x0, r). Click or drag to move it.
import { linearTicks, formatLinear, formatPower } from './plot.js';

// Sequential ramp: viridis, reversed (yellow, green, teal, blue, purple), light for few iterations. Each stop is
// placed at its OKLab lightness and colors are interpolated in OKLab, so lightness decreases linearly.
const STOPS = ['#fde725', '#addc30', '#5ec962', '#28ae80', '#21918c', '#2c728e', '#3b528b', '#472d7b', '#440154'];

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklab(hex) {
  const v = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((c) => Math.round(255 * Math.max(0, Math.min(1, toGamma(c)))));
}

const LAB = STOPS.map(hexToOklab);
const POS = LAB.map(([L]) => (LAB[0][0] - L) / (LAB[0][0] - LAB[LAB.length - 1][0]));

// Color of t in [0, 1] along the ramp, as [r, g, b]
export function rampColor(t) {
  const u = Math.max(0, Math.min(1, t));
  let k = 0;
  while (k < POS.length - 2 && u > POS[k + 1]) k++;
  const f = (u - POS[k]) / (POS[k + 1] - POS[k]);
  return oklabToRgb(LAB[k].map((c, i) => c + f * (LAB[k + 1][i] - c)));
}

// Lookup table for the cells of the map
const LUT = Array.from({ length: 1024 }, (_, i) => rampColor(i / 1023));
const lutColor = (t) => LUT[Math.round(Math.max(0, Math.min(1, t)) * 1023)];

export const RAMP_CSS = `linear-gradient(90deg in oklab, ${STOPS.map((c, i) => `${c} ${(100 * POS[i]).toFixed(1)}%`).join(', ')})`;

export class ConvergenceMap {
  // opts: { theme, height, onPick(x0, r), onHover(cell | null), ariaLabel }
  constructor(host, opts) {
    this.opts = { height: 320, ...opts };
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    if (opts.ariaLabel) this.canvas.setAttribute('aria-label', opts.ariaLabel);
    this.canvas.style.cursor = 'crosshair';
    host.appendChild(this.canvas);
    this.margin = { left: 52, right: 14, top: 10, bottom: 38 };
    this.image = document.createElement('canvas');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => (this.dragging ? this.pick(e) : this.hover(e)));
    const end = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointerleave', () => this.opts.onHover && this.opts.onHover(null));
  }

  resize() {
    const width = this.host.clientWidth;
    if (!width) return;
    this.dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = this.opts.height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.draw();
  }

  // data: { x0s, rs, counts (Int16Array, row-major in r), xRange, rRange, cMax, solution: { x, r } }
  setData(data, labels) {
    this.data = data;
    this.labels = labels;
    const { x0s, rs, counts, cMax } = data;
    this.image.width = x0s.length;
    this.image.height = rs.length;
    const ctx = this.image.getContext('2d');
    const img = ctx.createImageData(x0s.length, rs.length);
    const lmax = Math.log(cMax);
    for (let j = 0; j < rs.length; j++) {
      for (let i = 0; i < x0s.length; i++) {
        const c = counts[j * x0s.length + i];
        const p = 4 * ((rs.length - 1 - j) * x0s.length + i); // r increases upwards
        if (c > 0) {
          const [R, G, B] = lutColor(Math.log(c) / lmax);
          img.data[p] = R;
          img.data[p + 1] = G;
          img.data[p + 2] = B;
          img.data[p + 3] = 255;
        } else img.data[p + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.draw();
  }

  setCurrent(x0, r) {
    this.current = { x0, r };
    this.draw();
  }

  scales() {
    const { left, right, top, bottom } = this.margin;
    const [x0, x1] = this.data.xRange;
    const [y0, y1] = this.data.rRange;
    const w = this.width - left - right;
    const h = this.height - top - bottom;
    return {
      w, h, x0, x1, y0, y1,
      sx: (v) => left + ((v - x0) / (x1 - x0)) * w,
      sy: (v) => top + h - ((v - y0) / (y1 - y0)) * h,
      ix: (px) => x0 + ((px - left) / w) * (x1 - x0),
      iy: (py) => y0 + ((top + h - py) / h) * (y1 - y0),
    };
  }

  hatch(ctx) {
    const t = this.opts.theme;
    const size = 8;
    const tile = document.createElement('canvas');
    tile.width = tile.height = size * this.dpr;
    const c = tile.getContext('2d');
    c.scale(this.dpr, this.dpr);
    c.fillStyle = t.surface;
    c.fillRect(0, 0, size, size);
    c.strokeStyle = t.axis;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, size);
    c.lineTo(size, 0);
    c.moveTo(-1, 1);
    c.lineTo(1, -1);
    c.moveTo(size - 1, size + 1);
    c.lineTo(size + 1, size - 1);
    c.stroke();
    const pattern = ctx.createPattern(tile, 'repeat');
    pattern.setTransform(new DOMMatrix().scale(1 / this.dpr));
    return pattern;
  }

  draw() {
    if (!this.width || !this.data) return;
    const ctx = this.canvas.getContext('2d');
    const t = this.opts.theme;
    const { left, top } = this.margin;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const s = this.scales();

    // Cells over the failure hatch
    ctx.fillStyle = this.hatch(ctx);
    ctx.fillRect(left, top, s.w, s.h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.image, left, top, s.w, s.h);

    // Axes
    ctx.font = `12px ${t.font}`;
    ctx.fillStyle = t.muted;
    ctx.strokeStyle = t.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, s.w - 1, s.h - 1);
    const xt = linearTicks(s.x0, s.x1, Math.max(3, Math.round(s.w / 90)));
    const yt = linearTicks(s.y0, s.y1, Math.max(3, Math.round(s.h / 50)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of xt.ticks) {
      const x = Math.round(s.sx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top + s.h);
      ctx.lineTo(x, top + s.h + 4);
      ctx.stroke();
      ctx.fillText(formatLinear(v, xt.step), x, top + s.h + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of yt.ticks) {
      const y = Math.round(s.sy(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left - 4, y);
      ctx.lineTo(left, y);
      ctx.stroke();
      ctx.fillText(formatLinear(v, yt.step), left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(this.labels.x, left + s.w / 2, this.height - 2);
    ctx.save();
    ctx.translate(12, top + s.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(this.labels.y, 0, 0);
    ctx.restore();

    // Exact solution and current point
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, s.w, s.h);
    ctx.clip();
    const sol = this.data.solution;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = t.surface;
    ctx.lineWidth = 4;
    const solPath = () => {
      ctx.beginPath();
      for (let k = 0; k < sol.x.length; k++) {
        const px = Math.max(-1e4, Math.min(1e4, s.sx(sol.x[k])));
        const py = s.sy(sol.r[k]);
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    };
    solPath();
    ctx.strokeStyle = t.text;
    ctx.lineWidth = 2;
    solPath();
    if (this.current) {
      const px = s.sx(this.current.x0);
      const py = s.sy(this.current.r);
      ctx.strokeStyle = t.highlightInk;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(left, py);
      ctx.lineTo(left + s.w, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, 2 * Math.PI);
      ctx.fillStyle = t.iterate;
      ctx.strokeStyle = t.surface;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  cellAt(e) {
    if (!this.data || !this.width) return null;
    const rect = this.canvas.getBoundingClientRect();
    const s = this.scales();
    const { left, top } = this.margin;
    const px = Math.max(left, Math.min(left + s.w - 1e-6, e.clientX - rect.left));
    const py = Math.max(top + 1e-6, Math.min(top + s.h, e.clientY - rect.top));
    const { x0s, rs, counts } = this.data;
    const i = Math.min(x0s.length - 1, Math.floor(((px - left) / s.w) * x0s.length));
    const j = Math.min(rs.length - 1, Math.floor(((top + s.h - py) / s.h) * rs.length));
    return { x0: s.ix(px), r: s.iy(py), count: counts[j * x0s.length + i], cellX0: x0s[i], cellR: rs[j] };
  }

  pick(e) {
    const c = this.cellAt(e);
    if (c && this.opts.onPick) this.opts.onPick(c.x0, c.r);
  }

  hover(e) {
    if (this.opts.onHover) this.opts.onHover(this.cellAt(e));
  }
}

// Ticks of the color scale (log): 1, 3, 10, 30, 100, 300 up to cMax
export function colorTicks(cMax) {
  const out = [];
  for (let e = 0; 10 ** e <= cMax; e++) for (const m of [1, 3]) if (m * 10 ** e <= cMax) out.push(m * 10 ** e);
  return out.map((v) => ({ v, t: Math.log(v) / Math.log(cMax), label: v >= 10000 ? formatPower(Math.log10(v)) : String(v) }));
}
