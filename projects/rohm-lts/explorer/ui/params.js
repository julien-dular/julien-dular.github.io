// Table of custom cell parameters. Each value can be typed, or changed continuously by clicking and dragging
// horizontally on it (hold Shift for finer steps); arrow keys also work.

// Columns: key in the preset format (T, fraction, s), symbol and subscript, displayed unit, factor from preset unit to
// displayed unit, maximum (displayed unit), additive step per pixel when dragging from 0.
const COLUMNS = {
  mu0_kappa: { sym: 'μ₀κ̄', sub: '', unit: 'mT', factor: 1e3, max: 5000, zeroStep: 1, title: 'Irreversibility parameter: half-width of the hysteresis box' },
  alpha: { sym: 'α', sub: '', unit: '%', factor: 100, max: 100, zeroStep: 0.1, title: 'Weight of the cell in the chain' },
  tau_e: { sym: 'τ', sub: 'e', unit: 'ms', factor: 1e3, max: 1000, zeroStep: 0.001, title: 'Eddy current time constant' },
  tau_c: { sym: 'τ', sub: 'c', unit: 's', factor: 1, max: 100, zeroStep: 0.001, title: 'Coupling current time constant' },
  mu0_chi: { sym: 'μ₀χ̄', sub: '', unit: 'T', factor: 1, max: 50, zeroStep: 0.01, title: 'Saturation of the coupling field' },
};

const FAMILY_COLUMNS = {
  S: ['mu0_kappa', 'alpha'],
  CS: ['mu0_kappa', 'alpha', 'tau_e', 'tau_c', 'mu0_chi'],
};

const DRAG_THRESHOLD = 3; // px before a press becomes a drag
const DRAG_RATE = 1 / 120; // value multiplied by e every 120 px

function format(v) {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) return String(Math.round(v));
  return String(+v.toPrecision(4));
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) e.append(c);
  return e;
}

// A number input that can be dragged. onChange(value) is called with values in displayed units.
function scrubInput(value, col, onChange, ariaLabel) {
  const input = el('input', { type: 'text', inputmode: 'decimal', class: 'rx-num', value: format(value), 'aria-label': ariaLabel, spellcheck: 'false' });
  let current = value;
  const set = (v, { reformat = true } = {}) => {
    current = Math.min(Math.max(v, 0), col.max);
    if (reformat) input.value = format(current);
    input.classList.remove('is-invalid');
    onChange(current);
  };

  let drag = null;
  input.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || document.activeElement === input || input.getRootNode().activeElement === input) return;
    e.preventDefault();
    input.setPointerCapture(e.pointerId);
    drag = { x0: e.clientX, v0: current, moved: false };
  });
  input.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    drag.moved = true;
    input.classList.add('is-dragging');
    const fine = e.shiftKey ? 0.1 : 1;
    const v = drag.v0 > 0 ? drag.v0 * Math.exp(dx * DRAG_RATE * fine) : Math.max(0, dx * col.zeroStep * fine);
    set(+v.toPrecision(4));
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    input.classList.remove('is-dragging');
    if (!moved) {
      input.focus();
      input.select();
    }
  };
  input.addEventListener('pointerup', endDrag);
  input.addEventListener('pointercancel', endDrag);

  input.addEventListener('input', () => {
    const v = Number(input.value.replace(',', '.').trim());
    if (input.value.trim() === '' || !Number.isFinite(v) || v < 0 || v > col.max) {
      input.classList.add('is-invalid');
      return;
    }
    set(v, { reformat: false });
  });
  input.addEventListener('blur', () => {
    input.value = format(current);
    input.classList.remove('is-invalid');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const f = e.shiftKey ? 1.01 : 1.05;
      const up = e.key === 'ArrowUp';
      const v = current > 0 ? (up ? current * f : current / f) : up ? col.zeroStep * 10 : 0;
      set(+v.toPrecision(4));
    }
  });
  return input;
}

export class ParamTable {
  // onChange(rows) is called on every edit, with rows in the preset format.
  constructor(host, onChange) {
    this.host = host;
    this.onChange = onChange;
  }

  // rows: [{ mu0_kappa, alpha, tau_e?, tau_c?, mu0_chi? }] (preset units), family: 'S' | 'CS'
  set(rows, family) {
    this.rows = rows.map((r) => ({ ...r }));
    this.family = family;
    this.render();
  }

  emit() {
    this.renderSum();
    this.onChange(this.rows.map((r) => ({ ...r })));
  }

  render() {
    const cols = FAMILY_COLUMNS[this.family];
    const head = el('tr', {}, [
      el('th', { scope: 'col', text: 'Cell' }),
      ...cols.map((key) => {
        const c = COLUMNS[key];
        return el('th', { scope: 'col', title: c.title }, [c.sym, c.sub ? el('sub', { text: c.sub }) : null, ' ', el('span', { class: 'rx-unit', text: '(' + c.unit + ')' })]);
      }),
      el('th', { scope: 'col' }, [el('span', { class: 'rx-visually-hidden', text: 'Remove' })]),
    ]);
    const body = el('tbody');
    this.rows.forEach((row, k) => {
      const tr = el('tr', {}, [el('th', { scope: 'row', text: String(k + 1) })]);
      for (const key of cols) {
        const c = COLUMNS[key];
        const input = scrubInput(row[key] * c.factor, c, (v) => {
          row[key] = v / c.factor;
          this.emit();
        }, `Cell ${k + 1}, ${c.title} (${c.unit})`);
        tr.append(el('td', {}, [input]));
      }
      const remove = el('button', { type: 'button', class: 'rx-remove', 'aria-label': `Remove cell ${k + 1}`, title: 'Remove this cell', text: '×' });
      remove.disabled = this.rows.length <= 1;
      remove.addEventListener('click', () => {
        this.rows.splice(k, 1);
        this.render();
        this.emit();
      });
      tr.append(el('td', {}, [remove]));
      body.append(tr);
    });

    const add = el('button', { type: 'button', class: 'rx-link-button', text: '+ Add a cell' });
    add.addEventListener('click', () => {
      const last = this.rows[this.rows.length - 1];
      this.rows.push({ ...last, alpha: 0 });
      this.render();
      this.emit();
    });
    this.sumEl = el('span', { class: 'rx-sum' });
    this.normalize = el('button', { type: 'button', class: 'rx-link-button', text: 'Rescale weights to 100%' });
    this.normalize.addEventListener('click', () => {
      const sum = this.rows.reduce((s, r) => s + r.alpha, 0);
      if (sum <= 0) return;
      for (const r of this.rows) r.alpha = +(r.alpha / sum).toPrecision(4);
      this.render();
      this.emit();
    });

    this.host.replaceChildren(
      el('p', { class: 'rx-hint', text: 'Type a value, or click and drag it left or right (hold Shift for finer steps).' }),
      el('div', { class: 'rx-table-wrap' }, [el('table', { class: 'rx-table' }, [el('thead', {}, [head]), body])]),
      el('div', { class: 'rx-table-foot' }, [add, this.sumEl, this.normalize]),
    );
    this.renderSum();
  }

  renderSum() {
    const sum = this.rows.reduce((s, r) => s + r.alpha, 0);
    const ok = Math.abs(sum - 1) < 5e-4;
    this.sumEl.textContent = `Sum of weights: ${+(sum * 100).toFixed(2)}%` + (ok ? '' : ' (should be 100%: otherwise b does not approach μ₀h at high field)');
    this.sumEl.classList.toggle('is-off', !ok);
    this.normalize.hidden = ok;
  }
}
