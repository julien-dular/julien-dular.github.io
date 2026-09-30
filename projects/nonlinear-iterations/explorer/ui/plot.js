// Small canvas line plot: linear or log axes, several series with their own x and y arrays (parametric
// curves work), dots on the data points, a shared marker index, text annotations, hover, and dragging
// (reports the data coordinates under the pointer while pressed). Adapted from the ROHM explorer.

const MINUS = '−';
const clampPx = (v) => Math.max(-1e5, Math.min(1e5, v));

function niceStep(span, count) {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const err = raw / mag;
  return mag * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
}

export function linearTicks(min, max, count) {
  const step = niceStep(max - min, count);
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks, step };
}

export function formatLinear(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(decimals).replace('-', MINUS);
}

// 1, 10, 100, 1k, ..., also 0.1, 0.01
export function formatCompact(v) {
  const abs = Math.abs(v);
  const units = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']];
  for (const [scale, suffix] of units) {
    if (abs >= scale) return +(v / scale).toPrecision(3) + suffix;
  }
  return String(+v.toPrecision(3)).replace('-', MINUS);
}

// 10^e as 1, 10, 100, 1000 or 10⁻⁸
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function formatPower(e) {
  if (e >= 0 && e <= 3) return String(10 ** e);
  return '10' + String(e).split('').map((c) => SUP[c]).join('');
}

export class LinePlot {
  // opts: { theme, xLog, yLog, xLabel, yLabel, hover: 'x' | 'nearest' | 'none', onHover(index | null),
  //         onClick(index), onDrag(x, y, phase: 'start' | 'move' | 'end'), cursor(x, y) -> CSS cursor,
  //         ariaLabel, height }
  constructor(host, opts) {
    this.opts = { height: 240, hover: 'x', ...opts };
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    if (opts.ariaLabel) this.canvas.setAttribute('aria-label', opts.ariaLabel);
    host.appendChild(this.canvas);
    this.series = [];
    this.marker = null;
    this.vline = null;
    this.hline = null;
    this.labels = [];
    this.margin = { left: 52, right: 14, top: 10, bottom: 38 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.host = host;
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.drag(e, 'move');
      else {
        this.pointer(e);
        if (this.opts.cursor) {
          const [xv, yv] = this.toData(e);
          this.canvas.style.cursor = this.opts.cursor(xv, yv);
        }
      }
    });
    this.canvas.addEventListener('pointerleave', () => this.opts.onHover && this.opts.onHover(null));
    this.canvas.addEventListener('click', (e) => {
      if (this.opts.onDrag) return;
      const i = this.pick(e);
      if (i !== null && this.opts.onClick) this.opts.onClick(i);
    });
    if (opts.onDrag) {
      this.canvas.style.cursor = 'crosshair';
      this.canvas.addEventListener('pointerdown', (e) => {
        this.dragging = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.drag(e, 'start');
      });
      const end = (e) => {
        if (!this.dragging) return;
        this.dragging = false;
        this.drag(e, 'end');
      };
      this.canvas.addEventListener('pointerup', end);
      this.canvas.addEventListener('pointercancel', end);
    }
  }

  resize() {
    const width = this.host.clientWidth;
    if (!width) return;
    const dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = this.opts.height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.dpr = dpr;
    this.draw();
  }

  // series: [{ x, y, color, width, dash, alpha, progressive }]; progressive series are drawn faintly
  // beyond the marker index. range: { x: [min, max], y: [min, max] } (optional, else from data).
  setData(series, range = {}, labels = {}) {
    this.series = series;
    this.range = range;
    Object.assign(this.opts, labels);
    this.draw();
  }

  setMarker(index) {
    this.marker = index;
    this.draw();
  }

  setVLine(x) {
    this.vline = x;
    this.draw();
  }

  // labels: [{ x, y, text, color, align: 'left' | 'right' | 'center', dy }]
  setLabels(labels) {
    this.labels = labels || [];
    this.draw();
  }

  extent(axis) {
    const log = axis === 'x' ? this.opts.xLog : this.opts.yLog;
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.series) {
      const arr = s[axis];
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (!Number.isFinite(v) || (log && v <= 0)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min)) return log ? [1, 10] : [-1, 1];
    if (log) return [10 ** Math.floor(Math.log10(min) + 1e-9), 10 ** Math.ceil(Math.log10(max) - 1e-9)];
    if (min === max) {
      const d = Math.abs(min) || 1;
      return [min - d, max + d];
    }
    const pad = (max - min) * 0.06;
    return [min - pad, max + pad];
  }

  scales() {
    const { left, right, top, bottom } = this.margin;
    const [x0, x1] = (this.range && this.range.x) || this.extent('x');
    const [y0, y1] = (this.range && this.range.y) || this.extent('y');
    const w = this.width - left - right;
    const h = this.height - top - bottom;
    const f = (log, a, b, size, flip) => {
      const la = log ? Math.log10(a) : a;
      const lb = log ? Math.log10(b) : b;
      return (v) => {
        const t = ((log ? Math.log10(v) : v) - la) / (lb - la);
        return flip ? top + h - t * h : left + t * w;
      };
    };
    return {
      x0, x1, y0, y1, w, h,
      sx: f(this.opts.xLog, x0, x1, w, false),
      sy: f(this.opts.yLog, y0, y1, h, true),
      ix: (px) => {
        const t = (px - left) / w;
        return this.opts.xLog ? 10 ** (Math.log10(x0) + t * (Math.log10(x1) - Math.log10(x0))) : x0 + t * (x1 - x0);
      },
      iy: (py) => {
        const t = (top + h - py) / h;
        return this.opts.yLog ? 10 ** (Math.log10(y0) + t * (Math.log10(y1) - Math.log10(y0))) : y0 + t * (y1 - y0);
      },
    };
  }

  ticks(log, a, b, count) {
    if (log) {
      const out = [];
      const e0 = Math.ceil(Math.log10(a) - 1e-9);
      const e1 = Math.floor(Math.log10(b) + 1e-9);
      const every = Math.max(1, Math.ceil((e1 - e0 + 1) / count));
      for (let e = e0; e <= e1; e++) if ((e - e0) % every === 0) out.push({ v: 10 ** e, label: formatPower(e) });
      return out;
    }
    const { ticks, step } = linearTicks(a, b, count);
    return ticks.map((v) => ({ v, label: formatLinear(v, step) }));
  }

  draw() {
    if (!this.width) return;
    const ctx = this.canvas.getContext('2d');
    const t = this.opts.theme;
    const { left, top } = this.margin;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const s = this.scales();
    const clipRect = () => {
      ctx.beginPath();
      ctx.rect(left, top, s.w, s.h);
      ctx.clip();
    };

    // Grid and axes
    ctx.font = `12px ${t.font}`;
    ctx.lineWidth = 1;
    ctx.fillStyle = t.muted;
    const xt = this.ticks(this.opts.xLog, s.x0, s.x1, Math.max(3, Math.round(s.w / 90)));
    const yt = this.ticks(this.opts.yLog, s.y0, s.y1, Math.max(3, Math.round(s.h / 50)));
    ctx.strokeStyle = t.grid;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const { v, label } of xt) {
      const x = Math.round(s.sx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + s.h);
      ctx.stroke();
      ctx.fillText(label, x, top + s.h + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const { v, label } of yt) {
      const y = Math.round(s.sy(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + s.w, y);
      ctx.stroke();
      ctx.fillText(label, left - 6, y);
    }
    // Zero lines are the baseline of linear axes
    ctx.strokeStyle = t.axis;
    if (!this.opts.yLog && s.y0 < 0 && s.y1 > 0) {
      const y = Math.round(s.sy(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + s.w, y);
      ctx.stroke();
    }
    if (!this.opts.xLog && s.x0 < 0 && s.x1 > 0) {
      const x = Math.round(s.sx(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + s.h);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(this.opts.xLabel || '', left + s.w / 2, this.height - 2);
    ctx.save();
    ctx.translate(12, top + s.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(this.opts.yLabel || '', 0, 0);
    ctx.restore();

    // Series
    ctx.save();
    clipRect();
    if (this.vline !== null) {
      ctx.strokeStyle = t.axis;
      ctx.setLineDash([]);
      const x = Math.round(s.sx(this.vline)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + s.h);
      ctx.stroke();
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const ser of this.series) {
      const n = ser.x.length;
      const cut = ser.progressive && this.marker !== null ? Math.min(this.marker, n - 1) : n - 1;
      const path = (from, to) => {
        ctx.beginPath();
        let pen = false;
        for (let i = from; i <= to; i++) {
          const xv = ser.x[i];
          const yv = ser.y[i];
          if (!Number.isFinite(xv) || !Number.isFinite(yv) || (this.opts.yLog && yv <= 0) || (this.opts.xLog && xv <= 0)) {
            pen = false;
            continue;
          }
          const px = clampPx(s.sx(xv));
          const py = clampPx(s.sy(yv));
          if (pen) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          pen = true;
        }
        ctx.stroke();
      };
      ctx.strokeStyle = ser.color;
      ctx.lineWidth = ser.width || 2;
      ctx.setLineDash(ser.dash || []);
      if (cut < n - 1) {
        ctx.globalAlpha = 0.18;
        path(cut, n - 1);
      }
      ctx.globalAlpha = ser.alpha ?? 1;
      if (!ser.noLine) path(0, cut);
      ctx.globalAlpha = 1;
      if (ser.dots) {
        ctx.setLineDash([]);
        for (let i = 0; i <= cut; i++) {
          const xv = ser.x[i];
          const yv = ser.y[i];
          if (!Number.isFinite(xv) || !Number.isFinite(yv) || (this.opts.yLog && yv <= 0)) continue;
          ctx.beginPath();
          ctx.arc(clampPx(s.sx(xv)), clampPx(s.sy(yv)), ser.dots, 0, 2 * Math.PI);
          ctx.fillStyle = ser.dotColor || ser.color;
          ctx.strokeStyle = t.surface;
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    if (this.hline !== null) {
      ctx.strokeStyle = t.axis;
      ctx.setLineDash([4, 4]);
      const y = Math.round(s.sy(this.hline)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + s.w, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // Annotations, in ink (the mark next to them carries the color)
    ctx.font = `12px ${t.font}`;
    for (const lab of this.labels) {
      if (!Number.isFinite(lab.x) || !Number.isFinite(lab.y)) continue;
      const px = s.sx(lab.x);
      const py = s.sy(lab.y) + (lab.dy || 0);
      if (px < left - 1 || px > left + s.w + 1 || py < top - 1 || py > top + s.h + 1) continue;
      ctx.textAlign = lab.align || 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.surface;
      const wText = ctx.measureText(lab.text).width;
      const bx = lab.align === 'right' ? px - wText - 2 : lab.align === 'center' ? px - wText / 2 - 2 : px - 2;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(bx, py - 8, wText + 4, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = lab.color || t.text;
      ctx.fillText(lab.text, px, py);
    }

    // Marker: filled dot with a surface ring
    if (this.marker !== null) {
      for (const ser of this.series) {
        if (ser.marker === false) continue;
        const i = this.marker;
        if (i < 0 || i >= ser.x.length) continue;
        const xv = ser.x[i];
        const yv = ser.y[i];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || (this.opts.yLog && yv <= 0)) continue;
        ctx.beginPath();
        ctx.arc(clampPx(s.sx(xv)), clampPx(s.sy(yv)), ser.markerSize || 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = ser.color;
        ctx.strokeStyle = t.surface;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Index of the data point under the pointer: nearest in x for monotonic x, nearest on screen otherwise.
  pick(e) {
    if (!this.series.length || !this.width || this.opts.hover === 'none') return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const s = this.scales();
    const ref = this.series[0];
    const n = ref.x.length;
    if (!n) return null;
    if (this.opts.hover === 'x') {
      const xv = s.ix(px);
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ref.x[mid] <= xv) lo = mid;
        else hi = mid;
      }
      return Math.abs(ref.x[lo] - xv) <= Math.abs(ref.x[hi] - xv) ? lo : hi;
    }
    let best = null;
    let bestD = 30 * 30; // pointer must be within 30 px of the curve
    for (let i = 0; i < n; i++) {
      const dx = s.sx(ref.x[i]) - px;
      const dy = s.sy(ref.y[i]) - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  pointer(e) {
    if (!this.opts.onHover) return;
    this.opts.onHover(this.pick(e));
  }

  // Data coordinates under the pointer, clamped to the plot area
  toData(e) {
    const rect = this.canvas.getBoundingClientRect();
    const s = this.scales();
    const { left, top } = this.margin;
    const px = Math.max(left, Math.min(left + s.w, e.clientX - rect.left));
    const py = Math.max(top, Math.min(top + s.h, e.clientY - rect.top));
    return [s.ix(px), s.iy(py)];
  }

  drag(e, phase) {
    if (!this.width) return;
    const [xv, yv] = this.toData(e);
    this.opts.onDrag(xv, yv, phase);
  }
}
