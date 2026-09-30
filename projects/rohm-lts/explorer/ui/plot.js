// Small canvas line plot for the explorer: linear or log axes, several series with their own x and y
// arrays (so parametric curves such as hysteresis loops work), a shared marker index, and hover.

const MINUS = '−';

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

export class LinePlot {
  // opts: { theme, xLog, yLog, xLabel, yLabel, hover: 'x' | 'nearest', onHover(index | null), onClick(index),
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
    this.margin = { left: 52, right: 14, top: 10, bottom: 38 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.host = host;
    this.canvas.addEventListener('pointermove', (e) => this.pointer(e));
    this.canvas.addEventListener('pointerleave', () => this.opts.onHover && this.opts.onHover(null));
    this.canvas.addEventListener('click', (e) => {
      const i = this.pick(e);
      if (i !== null && this.opts.onClick) this.opts.onClick(i);
    });
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
    };
  }

  ticks(log, a, b, count) {
    if (log) {
      const out = [];
      for (let e = Math.ceil(Math.log10(a) - 1e-9); e <= Math.floor(Math.log10(b) + 1e-9); e++) out.push({ v: 10 ** e, label: formatCompact(10 ** e) });
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
          const px = s.sx(xv);
          const py = s.sy(yv);
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
      path(0, cut);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

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
        ctx.arc(s.sx(xv), s.sy(yv), 4.5, 0, 2 * Math.PI);
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
    if (!this.series.length || !this.width) return null;
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
}
