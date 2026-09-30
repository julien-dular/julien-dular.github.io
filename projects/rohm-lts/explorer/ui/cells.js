// Animated view of the cells of the chain, at one moment in time. One row per cell, on a common field axis:
//   - vertical line: the field h, shared by all cells
//   - dot: the reversible field h_rev,k of the cell, which sets its flux density b_k = mu0 h_rev,k
//   - box of half-width kappa_k(b) around g_k = h_rev,k + h_eddy,k + h_coupling,k: the field moves freely inside
//     it; when the field pushes on an edge, the box is dragged along and energy is dissipated (box highlighted)
//   - rate-dependent cells: segments from h_rev,k to g_k for the eddy and coupling fields
import { linearTicks, formatLinear } from './plot.js';

export class CellView {
  constructor(host, { theme, ariaLabel }) {
    this.theme = theme;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', ariaLabel);
    host.appendChild(this.canvas);
    this.host = host;
    this.margin = { left: 36, right: 80, top: 22, bottom: 38 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
  }

  resize() {
    const width = this.host.clientWidth;
    if (!width) return;
    this.width = width;
    this.layout();
  }

  layout() {
    if (!this.width || !this.data) return;
    const n = this.data.N;
    this.rowHeight = Math.max(9, Math.min(28, Math.round(240 / n)));
    this.height = this.margin.top + n * this.rowHeight + this.margin.bottom;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.draw();
  }

  // data: { N, alphas, mu0h (T, per step), cells: per cell { hrev, heddy, hcoupling, hirr } in T (mu0 * field),
  //         kappa: per step and cell (T), range: [min, max] (T) }
  setData(data) {
    const resize = !this.data || this.data.N !== data.N;
    this.data = data;
    if (resize) this.layout();
    else this.draw();
  }

  setIndex(i) {
    this.index = i;
    this.draw();
  }

  draw() {
    if (!this.width || !this.data || !this.height) return;
    const d = this.data;
    const t = this.theme;
    const i = Math.min(this.index ?? d.mu0h.length - 1, d.mu0h.length - 1);
    const { left, right, top } = this.margin;
    const w = this.width - left - right;
    const rh = this.rowHeight;
    const rowsBottom = top + d.N * rh;
    const [x0, x1] = d.range;
    const sx = (v) => left + ((v - x0) / (x1 - x0)) * w;
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = `12px ${t.font}`;

    // Axis
    const { ticks, step } = linearTicks(x0, x1, Math.max(3, Math.round(w / 90)));
    ctx.lineWidth = 1;
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of ticks) {
      const x = Math.round(sx(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? t.axis : t.grid;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, rowsBottom);
      ctx.stroke();
      ctx.fillText(formatLinear(v, step), x, rowsBottom + 6);
    }
    ctx.textBaseline = 'bottom';
    ctx.fillText('Field μ₀h (T)', left + w / 2, this.height - 2);

    // Rows
    const alphaMax = Math.max(...d.alphas, 1e-12);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top - 4, w, d.N * rh + 8);
    ctx.clip();
    for (let k = 0; k < d.N; k++) {
      const c = d.cells[k];
      const y = top + (k + 0.5) * rh;
      const hrev = c.hrev[i];
      const heddy = c.heddy ? c.heddy[i] : 0;
      const hcoupling = c.hcoupling ? c.hcoupling[i] : 0;
      const g = hrev + heddy + hcoupling;
      const kappa = d.kappa[k][i];
      const boxH = Math.max(6, rh * 0.62);

      if (kappa > 0) {
        const dragged = Math.abs(c.hirr[i]) >= kappa * (1 - 1e-3) && i > 0 && c.hrev[i] !== c.hrev[i - 1];
        const xa = sx(g - kappa);
        const xb = sx(g + kappa);
        ctx.globalAlpha = dragged ? 0.32 : 0.1;
        ctx.fillStyle = t.hyst;
        ctx.fillRect(xa, y - boxH / 2, xb - xa, boxH);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = t.hyst;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(xa, y - boxH / 2, xb - xa, boxH);
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, Math.min(4, rh * 0.18));
      if (heddy !== 0) {
        ctx.strokeStyle = t.eddy;
        ctx.beginPath();
        ctx.moveTo(sx(hrev), y);
        ctx.lineTo(sx(hrev + heddy), y);
        ctx.stroke();
      }
      if (hcoupling !== 0) {
        ctx.strokeStyle = t.coupling;
        ctx.beginPath();
        ctx.moveTo(sx(hrev + heddy), y);
        ctx.lineTo(sx(g), y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(sx(hrev), y, Math.max(2.5, Math.min(4.5, rh * 0.2)), 0, 2 * Math.PI);
      ctx.fillStyle = t.accent;
      ctx.strokeStyle = t.surface;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // The field, shared by all cells
    const xh = sx(d.mu0h[i]);
    ctx.strokeStyle = t.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xh, top - 4);
    ctx.lineTo(xh, rowsBottom);
    ctx.stroke();
    ctx.fillStyle = t.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('h', xh, top - 5);

    // Cell numbers (left) and weights (right)
    ctx.textBaseline = 'middle';
    const fontSize = Math.min(12, Math.max(9, rh - 3));
    ctx.font = `${fontSize}px ${t.font}`;
    for (let k = 0; k < d.N; k++) {
      const y = top + (k + 0.5) * rh;
      ctx.fillStyle = t.muted;
      ctx.textAlign = 'right';
      ctx.fillText(String(k + 1), left - 10, y);
      const barW = 22 * (d.alphas[k] / alphaMax);
      ctx.fillStyle = t.axis;
      ctx.fillRect(this.width - right + 8, y - 2, barW, 4);
      ctx.fillStyle = t.muted;
      ctx.textAlign = 'left';
      const pct = d.alphas[k] * 100;
      ctx.fillText((pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)) + '%', this.width - right + 34, y);
    }
  }
}
