// <iteration-explorer>: interactive explorer of Picard and Newton-Raphson iterations on single degree of
// freedom analogues of the power law (superconductors) and the saturation law (ferromagnets), after
// Section 2.7 of J. Dular's PhD thesis.
// Self-contained: everything renders in a shadow root and every file is loaded relative to this module,
// so the host page only needs the element and one <script type="module"> tag.
import {
  PROBLEMS, DEFAULTS, METHODS, ITER_DEFAULTS, makeLaw, solve, iterate, convergenceMap, grid, stepKind,
  picardStep, newtonStep, secantStep, iterationFunction,
} from './model/iterations.js';
import { LinePlot } from './ui/plot.js';
import { ConvergenceMap, RAMP_CSS, colorTicks } from './ui/map.js';
import { EQUATIONS, iterationFormula, relaxFormula, inline, mo, par, x as mx } from './ui/math.js';
import { STEPS } from './ui/tour.js';

const here = (path) => new URL(path, import.meta.url).href;

const THESIS_URL = 'https://hdl.handle.net/2268/298054';

const MAP_FAST = 64; // cells per side while a control is being dragged
const MAP_FULL = 160; // cells per side once it is released
const SHOWN_FAILED = 60; // iterations kept for display when a run fails (300 cycling iterations fill the plots)
const SLIDER_MAX = 1000;

const LAWS = {
  power: { label: 'Power law (superconductor)' },
  ferro: { label: 'Saturation law (ferromagnet)' },
};

const FORMS = {
  power: {
    h: 'h-formulation: unknown ∼ current, nonlinear resistivity',
    a: 'a-formulation: unknown ∼ electric field, nonlinear conductivity',
  },
  ferro: {
    h: 'h-formulation: unknown μ₀h (T), nonlinear permeability',
    a: 'a-formulation: unknown b (T), nonlinear reluctivity',
  },
};

// Starting (right-hand side, initial guess) for each problem
const START = {
  'power-h': { rhs: 1.1, x0: 0.5 },
  'power-a': { rhs: 0.6, x0: 0.002 },
  'ferro-h': { rhs: 0.5, x0: 0.1 },
  'ferro-a': { rhs: 0.1, x0: 0.5 },
};

// Parameter sliders: [key, label, range, log, integer]
const PARAMS = {
  n: { label: 'Exponent n', range: [1, 50], log: false, int: true, laws: ['power'] },
  lambda: { label: 'Scaling λ', range: [0.1, 10], log: true, laws: ['power'] },
  eps: { label: 'Regularization ε', range: [1e-10, 1e-2], log: true, forms: ['power-a'] },
  mur0: { label: 'Initial permeability μr,0', range: [10, 1e4], log: true, laws: ['ferro'] },
};

const MINUS = '−';
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

// Compact number: 3 significant digits, scientific notation with superscripts when small or large
function fmt(v, digits = 3) {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e5) return String(+v.toPrecision(digits)).replace('-', MINUS);
  const e = Math.floor(Math.log10(a));
  const m = +(v / 10 ** e).toPrecision(digits);
  const exp = String(e).split('').map((ch) => SUP[ch]).join('');
  return (m === 1 ? '' : m === -1 ? MINUS : String(m).replace('-', MINUS) + '×') + '10' + exp;
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

// Sample points over [a, b] for plotting a function: uniform, plus a geometric refinement around 0
// (where the laws of the a-formulation and of the ferromagnet change abruptly) and around given points.
function samples(a, b, extra = []) {
  const pts = [];
  const m = 500;
  for (let k = 0; k <= m; k++) pts.push(a + ((b - a) * k) / m);
  const w = b - a;
  const refine = (c) => {
    for (let e = -14; e <= 0; e += 0.1) {
      const d = w * 10 ** e;
      for (const p of [c - d, c + d]) if (p > a && p < b) pts.push(p);
    }
    if (c > a && c < b) pts.push(c);
  };
  refine(0);
  for (const c of extra) if (Number.isFinite(c)) refine(c);
  return Float64Array.from(pts).sort();
}

class IterationExplorer extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.init().catch((err) => {
      this.shadowRoot.replaceChildren(el('p', { class: 'fx-error', text: 'The explorer could not be loaded (' + err.message + ').' }));
    });
  }

  disconnectedCallback() {
    this.stop();
  }

  async init() {
    const css = el('link', { rel: 'stylesheet', href: here('explorer.css') });
    const cssLoaded = new Promise((resolve) => {
      css.addEventListener('load', resolve);
      css.addEventListener('error', resolve);
    });
    this.shadowRoot.append(css);
    await Promise.all([cssLoaded, document.fonts ? document.fonts.ready : null]);
    this.state = {
      mode: 'explore',
      step: 0,
      law: 'power',
      form: 'h',
      method: 'newton',
      gamma: 1,
      iSwitch: 5,
      aitken: false,
      params: { ...DEFAULTS },
      start: structuredClone(START),
      zoom: false,
      compose: false,
    };
    this.build();
    this.theme = this.readTheme();
    this.makePlots();
    this.syncControls();
    this.update({ map: true });
  }

  get key() {
    return `${this.state.law}-${this.state.form}`;
  }

  // Resolves the CSS tokens to concrete colors for the canvas.
  readTheme() {
    const probe = el('span', { hidden: '' });
    this.root.append(probe);
    const color = (name) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const theme = {
      text: color('--fx-text'),
      muted: color('--fx-muted'),
      surface: color('--fx-surface'),
      grid: color('--fx-grid'),
      axis: color('--fx-axis'),
      input: color('--fx-input'),
      law: color('--fx-law'),
      iterate: color('--fx-iterate'),
      phi: color('--fx-phi'),
      phi2: color('--fx-phi2'),
      aitken: color('--fx-aitken'),
      highlightInk: color('--fx-muted'),
      font: getComputedStyle(this).getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif',
    };
    probe.remove();
    return theme;
  }

  build() {
    const s = this.state;
    this.root = el('div', { class: 'fx' });

    // Header, with the choice between free exploration and the guided tour
    this.modeButtons = {};
    const modes = el('div', { class: 'fx-seg', role: 'group', 'aria-label': 'Mode' });
    for (const [key, label] of [['explore', 'Explore'], ['learn', 'Learn step by step']]) {
      const b = el('button', { type: 'button', text: label });
      b.addEventListener('click', () => this.setMode(key));
      modes.append(b);
      this.modeButtons[key] = b;
    }
    this.root.append(
      el('div', { class: 'fx-head' }, [
        el('div', { class: 'fx-head-row' }, [el('h2', { text: 'Try the iterations' }), modes]),
        el('p', {
          text:
            'Pick a material law, a formulation and a method. Click or drag on the plots to choose the initial guess x₀ ' +
            '(drag the dashed level to change the right-hand side), or on the convergence map to choose both: every plot updates instantly. ' +
            'New to the topic? Learn it step by step.',
        }),
      ]),
    );

    // Guided tour
    this.tour = {
      count: el('p', { class: 'fx-step-count' }),
      title: el('h3'),
      body: el('div', { class: 'fx-tour-body' }),
      details: el('div', { class: 'fx-tour-details' }),
      prev: el('button', { type: 'button', class: 'fx-button', text: '← Previous' }),
      next: el('button', { type: 'button', class: 'fx-button fx-button-primary', text: 'Next →' }),
    };
    this.tour.prev.addEventListener('click', () => this.setStep(s.step - 1));
    this.tour.next.addEventListener('click', () => this.setStep(s.step + 1));
    this.tourCard = el('section', { class: 'fx-tour', 'aria-label': 'Guided tour' }, [
      this.tour.count,
      this.tour.title,
      this.tour.body,
      el('details', { class: 'fx-details' }, [el('summary', { text: 'Full details' }), this.tour.details]),
      el('div', { class: 'fx-tour-nav' }, [this.tour.prev, this.tour.next]),
    ]);
    this.root.append(this.tourCard);

    // Controls: law, formulation, method and its options
    this.lawSelect = el('select', { 'aria-label': 'Material law' });
    for (const [key, l] of Object.entries(LAWS)) this.lawSelect.append(el('option', { value: key, text: l.label }));
    this.lawSelect.addEventListener('change', () => {
      s.law = this.lawSelect.value;
      this.changed({ map: true });
    });

    this.formSelect = el('select', { 'aria-label': 'Formulation' });
    this.formSelect.addEventListener('change', () => {
      s.form = this.formSelect.value;
      this.changed({ map: true });
    });

    this.methodSelect = el('select', { 'aria-label': 'Iterative method' });
    for (const [key, label] of Object.entries(METHODS)) this.methodSelect.append(el('option', { value: key, text: label }));
    this.methodSelect.addEventListener('change', () => {
      s.method = this.methodSelect.value;
      this.changed({ map: true });
    });

    this.aitkenCheck = el('input', { type: 'checkbox' });
    this.aitkenCheck.addEventListener('change', () => {
      s.aitken = this.aitkenCheck.checked;
      this.changed({ map: true });
    });
    this.aitkenField = el('label', { class: 'fx-check' }, [this.aitkenCheck, el('span', { text: 'Aitken acceleration' })]);

    this.switchInput = el('input', { type: 'number', min: '0', max: '100', step: '1', class: 'fx-num-small', 'aria-label': 'Picard iterations before switching' });
    this.switchInput.addEventListener('input', () => {
      const v = Math.round(+this.switchInput.value);
      if (!Number.isFinite(v) || v < 0 || v > 100) return;
      s.iSwitch = v;
      this.changed({ map: true, fast: true });
    });
    this.switchField = el('label', { class: 'fx-field' }, [el('span', { text: 'Picard iterations first' }), this.switchInput]);

    const slider = (label, range, { log = false, int = false, format = fmt } = {}, onInput) => {
      const input = el('input', { type: 'range', min: '0', max: String(SLIDER_MAX), 'aria-label': label });
      const out = el('output');
      let [a, b] = range;
      const toValue = (pos) => {
        const t = pos / SLIDER_MAX;
        const v = log ? 10 ** (Math.log10(a) + t * (Math.log10(b) - Math.log10(a))) : a + t * (b - a);
        return int ? Math.round(v) : v;
      };
      const toPos = (v) => Math.round((log ? (Math.log10(v) - Math.log10(a)) / (Math.log10(b) - Math.log10(a)) : (v - a) / (b - a)) * SLIDER_MAX);
      input.addEventListener('input', () => {
        const v = toValue(+input.value);
        out.textContent = format(v);
        onInput(v);
      });
      input.addEventListener('change', () => this.refineMap());
      const labelEl = el('span', { text: label });
      const field = el('label', { class: 'fx-field fx-slider' }, [labelEl, el('span', { class: 'fx-slider-row' }, [input, out])]);
      const setValue = (v) => {
        input.value = String(toPos(v));
        out.textContent = format(v);
      };
      const setRange = (r) => ([a, b] = r);
      return { input, out, field, label: labelEl, setValue, setRange };
    };

    this.gammaSlider = slider('Relaxation factor γ', [0.05, 1.5], { format: (v) => v.toFixed(2) }, (v) => {
      s.gamma = v;
      this.changed({ map: true, fast: true });
    });

    this.root.append(
      el('div', { class: 'fx-controls' }, [
        el('label', { class: 'fx-field' }, [el('span', { text: 'Material law' }), this.lawSelect]),
        el('label', { class: 'fx-field' }, [el('span', { text: 'Formulation' }), this.formSelect]),
        el('label', { class: 'fx-field' }, [el('span', { text: 'Method' }), this.methodSelect]),
        this.switchField,
        this.gammaSlider.field,
        this.aitkenField,
      ]),
    );

    // Equation and iteration formula
    this.equation = el('div', { class: 'fx-equation', 'aria-live': 'polite' });
    this.root.append(this.equation);

    // Sticky bar: parameters of the law, right-hand side and initial guess, iterations, outcome
    this.paramSliders = {};
    const paramRow = el('div', { class: 'fx-bar-row' });
    for (const [key, p] of Object.entries(PARAMS)) {
      const sl = slider(p.label, p.range, { log: p.log, int: p.int, format: p.int ? (v) => String(v) : fmt }, (v) => {
        s.params[key] = v;
        this.changed({ map: true, fast: true });
      });
      this.paramSliders[key] = sl;
      paramRow.append(sl.field);
    }
    this.resetParams = el('button', { type: 'button', class: 'fx-link-button fx-reset', text: 'Reset' });
    this.resetParams.addEventListener('click', () => {
      s.params = { ...DEFAULTS };
      this.changed({ map: true });
    });
    const number = (label, key) => {
      const input = el('input', { type: 'number', step: 'any', class: 'fx-num-small', 'aria-label': label });
      input.addEventListener('change', () => {
        const v = +input.value;
        if (input.value === '' || !Number.isFinite(v)) return this.syncControls();
        s.start[this.key][key] = v;
        this.changed();
      });
      const name = el('span');
      return { input, name, field: el('label', { class: 'fx-field fx-point' }, [name, input]) };
    };
    this.rhsInput = number('Right-hand side', 'rhs');
    this.x0Input = number('Initial guess', 'x0');
    this.x0Input.name.textContent = 'Initial guess x₀';
    paramRow.append(this.resetParams, this.rhsInput.field, this.x0Input.field);

    this.playButton = el('button', { type: 'button', 'aria-label': 'Play the iterations', text: '▶' });
    this.playButton.addEventListener('click', () => (this.raf ? this.stop() : this.play()));
    this.prevButton = el('button', { type: 'button', 'aria-label': 'Previous iteration', text: '‹' });
    this.prevButton.addEventListener('click', () => {
      this.stop();
      this.setK(this.k - 1);
    });
    this.nextButton = el('button', { type: 'button', 'aria-label': 'Next iteration', text: '›' });
    this.nextButton.addEventListener('click', () => {
      this.stop();
      this.setK(this.k + 1);
    });
    this.kInput = el('input', { type: 'range', min: '0', max: '1', value: '1', 'aria-label': 'Iteration shown' });
    this.kInput.addEventListener('input', () => {
      this.stop();
      this.setK(+this.kInput.value);
    });
    this.kOut = el('output');
    const steps = el('div', { class: 'fx-field fx-steps' }, [
      el('span', { text: 'Iterations' }),
      el('span', { class: 'fx-slider-row' }, [this.playButton, this.prevButton, this.kInput, this.nextButton, this.kOut]),
    ]);
    this.status = el('p', { class: 'fx-status', 'aria-live': 'polite' });
    this.root.append(el('div', { class: 'fx-sticky' }, [paramRow, steps, this.status]));

    // Plots
    const figure = (title, sub, wide = false, tools = null) => {
      const canvas = el('div', { class: 'fx-canvas' });
      const readout = el('ul', { class: 'fx-readout' });
      const subEl = el('p', { class: 'fx-sub', text: sub });
      const titleEl = el('h3', { text: title });
      const fig = el('figure', { class: 'fx-plot' + (wide ? ' is-wide' : '') }, [titleEl, subEl, tools, canvas, readout]);
      return { fig, canvas, readout, sub: subEl, title: titleEl };
    };
    const check = (label, onChange) => {
      const input = el('input', { type: 'checkbox' });
      input.addEventListener('change', () => onChange(input.checked));
      return { input, field: el('label', { class: 'fx-check' }, [input, el('span', { text: label })]) };
    };
    this.zoomCheck = check('Zoom on the iterates', (v) => {
      s.zoom = v;
      this.renderPlots();
    });
    this.composeCheck = check('Show Φ(Φ(x)), two iterations at once', (v) => {
      s.compose = v;
      this.renderPlots();
    });
    this.figs = {
      law: figure('The equation', '', false, el('div', { class: 'fx-figtools' }, [this.zoomCheck.field])),
      cobweb: figure('Iterations as a fixed point search', '', false, el('div', { class: 'fx-figtools' }, [this.composeCheck.field])),
      map: figure('Convergence map', '', true),
      residual: figure('Residual', 'How far each iterate is from solving the equation. Converged below the dashed line.'),
      iterates: figure('Iterates', 'Each iterate, and the exact solution (dashed).'),
    };
    this.scale = el('div', { class: 'fx-scale' });
    this.figs.map.readout.before(this.scale);
    this.root.append(el('div', { class: 'fx-grid' }, Object.values(this.figs).map((f) => f.fig)));

    const foot = el('p', { class: 'fx-foot' });
    foot.append(
      'After Section 2.7 of J. Dular, ',
      el('a', { href: THESIS_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Standard and mixed finite element formulations for systems with type-II superconductors' }),
      ', PhD thesis, University of Liège (2023). Convergence: |residual| < 10⁻⁸, at most 300 iterations.',
    );
    this.root.append(foot);
    this.root.append(
      el('p', {
        class: 'fx-ai',
        text:
          'The development of this application was assisted by Claude Opus 5.5, outputs and results were carefully checked but errors may remain. ' +
          'Please contact me if you find any, or if you have any question or suggestion for improvement. Thank you!',
      }),
    );

    this.shadowRoot.append(this.root);
  }

  makePlots() {
    const t = this.theme;
    const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
    // Dragging on the geometric plots moves x0, or the right-hand side when the dashed level is grabbed.
    // The axes stay fixed during a drag, so that the view does not move under the pointer.
    const nearLevel = (yv) => {
      const sc = this.plots.law.scales();
      return Math.abs(sc.sy(yv) - sc.sy(this.state.start[this.key].rhs)) < 8;
    };
    const drag = (plot) => (xv, yv, phase) => {
      const P = PROBLEMS[this.key];
      const st = this.state.start[this.key];
      if (phase === 'start') {
        this.dragMode = plot === 'law' && nearLevel(yv) ? 'rhs' : 'x0';
        this.frozen = this.view;
      }
      if (phase === 'end') {
        this.frozen = null;
        this.renderPlots();
        return;
      }
      if (this.dragMode === 'rhs') st.rhs = clamp(yv, P.rhsRange);
      else st.x0 = clamp(xv, P.x0Range);
      this.changed();
    };
    this.plots = {
      law: new LinePlot(this.figs.law.canvas, {
        theme: t,
        hover: 'none',
        onDrag: drag('law'),
        cursor: (xv, yv) => (nearLevel(yv) ? 'ns-resize' : 'crosshair'),
        ariaLabel: 'Nonlinear law and iterations',
        height: 300,
      }),
      cobweb: new LinePlot(this.figs.cobweb.canvas, { theme: t, hover: 'none', onDrag: drag('cobweb'), ariaLabel: 'Iteration function and cobweb diagram', height: 300 }),
      residual: new LinePlot(this.figs.residual.canvas, { theme: t, yLog: true, hover: 'x', onHover: (i) => this.setHover(i), onClick: (i) => this.setK(i), ariaLabel: 'Residual at each iteration', height: 220 }),
      iterates: new LinePlot(this.figs.iterates.canvas, { theme: t, hover: 'x', onHover: (i) => this.setHover(i), onClick: (i) => this.setK(i), ariaLabel: 'Iterates', height: 220 }),
    };
    this.map = new ConvergenceMap(this.figs.map.canvas, {
      theme: t,
      height: 340,
      ariaLabel: 'Number of iterations as a function of the initial guess and the right-hand side',
      onPick: (x0, r) => {
        Object.assign(this.state.start[this.key], { x0, rhs: r });
        this.changed();
      },
      onHover: (cell) => this.renderMapReadout(cell),
    });
  }

  // Brings every control in line with the state.
  syncControls() {
    const s = this.state;
    const P = PROBLEMS[this.key];
    const st = s.start[this.key];
    for (const [key, b] of Object.entries(this.modeButtons)) b.setAttribute('aria-pressed', String(key === s.mode));
    this.tourCard.hidden = s.mode !== 'learn';

    this.lawSelect.value = s.law;
    this.formSelect.replaceChildren(...Object.entries(FORMS[s.law]).map(([k, label]) => el('option', { value: k, text: label })));
    this.formSelect.value = s.form;
    this.methodSelect.value = s.method;
    this.switchField.hidden = s.method !== 'hybrid';
    this.switchInput.value = String(s.iSwitch);
    this.aitkenField.hidden = s.method !== 'picard';
    this.aitkenCheck.checked = s.aitken;
    this.gammaSlider.setValue(s.gamma);

    for (const [key, p] of Object.entries(PARAMS)) {
      const shown = (p.laws && p.laws.includes(s.law)) || (p.forms && p.forms.includes(this.key));
      this.paramSliders[key].field.hidden = !shown;
      this.paramSliders[key].setValue(s.params[key]);
    }

    this.rhsInput.name.textContent = `Right-hand side ${P.rhs}`;
    this.rhsInput.input.value = String(+st.rhs.toPrecision(4));
    this.x0Input.input.value = String(+st.x0.toPrecision(4));

    this.zoomCheck.input.checked = s.zoom;
    this.composeCheck.input.checked = s.compose;
    this.renderEquation();
  }

  renderEquation() {
    const s = this.state;
    const eq = EQUATIONS[this.key];
    const lines = [];
    const line = (label, math) => `<p><span class="fx-eq-label">${label}</span>${math}</p>`;
    lines.push(line('Solve for x', inline(eq.fn, par(mx), mo('='), eq.expr, mo('='), '<mn>0</mn>')));
    if (this.key !== 'ferro-a' || s.method === 'picard' || s.method === 'hybrid') lines.push(line('with A(x) =', inline(eq.A)));
    const kinds = s.method === 'hybrid' ? ['picard', 'newton'] : s.method === 'secant' ? ['secant'] : [s.method];
    const names = { picard: 'Picard', newton: 'Newton–Raphson', secant: 'Secant' };
    for (const k of kinds) {
      const label = s.method === 'hybrid' ? (k === 'picard' ? `Picard (i &lt; ${s.iSwitch})` : `then Newton–Raphson`) : names[k];
      lines.push(line(label, inline(iterationFormula(k, eq))));
    }
    if (Math.abs(s.gamma - 1) > 1e-9) lines.push(line(`Relaxation, γ = ${s.gamma.toFixed(2)}`, inline(relaxFormula)));
    this.equation.innerHTML = lines.join(''); // static MathML authored in ui/math.js
  }

  setMode(mode) {
    this.state.mode = mode;
    this.syncControls();
    if (mode === 'learn') this.setStep(this.state.step);
  }

  setStep(k) {
    const s = this.state;
    s.step = Math.max(0, Math.min(STEPS.length - 1, k));
    const step = STEPS[s.step];
    this.tour.count.textContent = `Step ${s.step + 1} of ${STEPS.length}`;
    this.tour.title.textContent = step.title;
    this.tour.body.innerHTML = step.body; // static content authored in ui/tour.js
    this.tour.details.innerHTML = step.details;
    this.tour.details.parentElement.open = false;
    this.tour.prev.disabled = s.step === 0;
    this.tour.next.disabled = s.step === STEPS.length - 1;
    this.applySetup(step.setup);
  }

  // Sets the explorer to a given configuration (used by the guided tour).
  applySetup({ problem, method, rhs, x0, gamma = 1, iSwitch = 5, aitken = false, zoom = false, compose = false, params = {} }) {
    const s = this.state;
    this.stop();
    const [law, form] = problem.split('-');
    Object.assign(s, { law, form, method, gamma, iSwitch, aitken, zoom, compose, params: { ...DEFAULTS, ...params } });
    s.start[problem] = { rhs, x0 };
    this.k = undefined;
    this.syncControls();
    this.update({ map: true });
  }

  // A control changed: resync and recompute (the map only when the law or the method changed)
  changed({ map = false, fast = false } = {}) {
    this.k = undefined;
    this.syncControls();
    this.schedule({ map, fast });
  }

  // Coalesces updates from continuous inputs to one per frame.
  schedule({ map = false, fast = false } = {}) {
    this.pendingMap = this.pendingMap || map;
    this.pendingFast = this.pendingFast || fast;
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      const m = this.pendingMap;
      const f = this.pendingFast;
      this.pending = null;
      this.pendingMap = false;
      this.pendingFast = false;
      this.update({ map: m, fast: f });
    });
  }

  law() {
    return makeLaw(this.key, this.state.params);
  }

  iterOptions() {
    const s = this.state;
    return { method: s.method, gamma: s.gamma, iSwitch: s.iSwitch, aitken: s.aitken };
  }

  update({ map = false, fast = false } = {}) {
    const s = this.state;
    const law = this.law();
    const st = s.start[this.key];
    this.lawFn = law;
    this.run = iterate(law, st.x0, st.rhs, this.iterOptions(), true);
    this.xbar = solve(law, st.rhs);
    this.lastTwo = this.run.xs.slice(-2);
    if (this.run.status !== 'converged') {
      for (const key of ['xs', 'res', 'kinds', 'xa', 'resA']) if (this.run[key]) this.run[key] = this.run[key].slice(0, SHOWN_FAILED + 1);
    }
    const N = this.run.xs.length - 1;
    this.kInput.max = String(N);
    if (this.k === undefined || this.k > N) this.k = N;
    this.kInput.value = String(this.k);
    if (map) this.computeMap(fast ? MAP_FAST : MAP_FULL);
    if (fast && map) {
      clearTimeout(this.refineTimer);
      this.refineTimer = setTimeout(() => this.refineMap(), 250);
    }
    this.map.setCurrent(st.x0, st.rhs);
    this.renderStatus();
    this.renderPlots();
  }

  computeMap(m) {
    const P = PROBLEMS[this.key];
    const law = this.law();
    const x0s = grid(...P.x0Range, m);
    const rs = grid(...P.rhsRange, m);
    const counts = convergenceMap(law, x0s, rs, this.iterOptions());
    const solR = Array.from({ length: 241 }, (_, k) => P.rhsRange[0] + ((P.rhsRange[1] - P.rhsRange[0]) * k) / 240);
    this.mapData = { x0s, rs, counts, xRange: P.x0Range, rRange: P.rhsRange, cMax: ITER_DEFAULTS.iMax, solution: { r: solR, x: solR.map((r) => solve(law, r)) } };
    this.mapResolution = m;
    let fails = 0;
    for (const c of counts) if (c < 0) fails++;
    this.mapFailFraction = fails / counts.length;
    this.map.setData(this.mapData, { x: 'Initial guess x₀', y: `Right-hand side ${P.rhs}` });
  }

  refineMap() {
    clearTimeout(this.refineTimer);
    if (this.mapResolution === MAP_FULL) return;
    this.computeMap(MAP_FULL);
    this.renderMapFigure();
  }

  // The unrelaxed target of step i (from x_{i-1}), for the construction lines
  target(i) {
    const s = this.state;
    const xs = this.run.xs;
    const kind = stepKind(s.method, i, s.iSwitch);
    const r = s.start[this.key].rhs;
    if (kind === 'picard') return picardStep(this.lawFn, xs[i - 1], r);
    if (kind === 'newton') return newtonStep(this.lawFn, xs[i - 1], r);
    return secantStep(this.lawFn, xs[i - 1], xs[i - 2], r);
  }

  // x window of the two geometric plots
  window() {
    const s = this.state;
    const P = PROBLEMS[this.key];
    const xs = this.run.xs.filter((v) => Number.isFinite(v) && Math.abs(v) < 1e8);
    const width = P.x0Range[1] - P.x0Range[0];
    let a;
    let b;
    if (s.zoom) {
      const pts = [...xs.slice(0, this.k + 1), this.xbar];
      a = Math.min(...pts);
      b = Math.max(...pts);
      const w = Math.max(b - a, width * 1e-6);
      const pad = 0.12 * w;
      a -= pad + (w - (b - a)) / 2;
      b += pad + (w - (b - a)) / 2;
    } else {
      a = P.x0Range[0];
      b = P.x0Range[1];
      const lim = 1.5 * width;
      for (const v of [...xs, this.xbar]) {
        if (v < a && v > P.x0Range[0] - lim) a = v;
        if (v > b && v < P.x0Range[1] + lim) b = v;
      }
      const pad = 0.04 * (b - a);
      a -= pad;
      b += pad;
    }
    return [a, b];
  }

  renderStatus() {
    const run = this.run;
    const badge = (text, bad) => el('span', { class: 'fx-badge' + (bad ? ' is-bad' : ''), text });
    const [xa, xb] = this.lastTwo;
    let content;
    if (run.status === 'converged') {
      content = [badge('Converged', false), `in ${run.iterations} iteration${run.iterations > 1 ? 's' : ''}, to x = ${fmt(run.x, 6)} (exact solution x̄ = ${fmt(this.xbar, 6)}).`];
    } else if (run.status === 'cycle') {
      content = [badge('Cycle', true), `The iterates jump between x = ${fmt(xa)} and ${fmt(xb)} forever (a cycle of period 2), far from the solution x̄ = ${fmt(this.xbar)}.`];
    } else if (run.status === 'diverged') {
      content = [badge('Diverged', true), `The iterates run away to infinity (solution x̄ = ${fmt(this.xbar)}).`];
    } else {
      content = [badge('Not converged', true), `after ${run.iterations} iterations (slow convergence or a longer cycle). Solution x̄ = ${fmt(this.xbar)}.`];
    }
    this.status.replaceChildren(...content);
  }

  renderPlots() {
    const s = this.state;
    const t = this.theme;
    const law = this.lawFn;
    const run = this.run;
    const xs = run.xs;
    const k = this.k;
    const P = PROBLEMS[this.key];
    const r = s.start[this.key].rhs;
    const [a, b] = this.frozen ? this.frozen.x : this.window();
    const X = samples(a, b, [...xs.slice(0, k + 1), this.xbar]);
    const lawName = { 'power-h': 'f', 'power-a': 'g', 'ferro-h': 'ḡ', 'ferro-a': 'f̄' }[this.key];

    // 1. The equation: A(x) x against the level r, with the construction of each step
    const L = X.map((v) => law.L(v));
    const Lk = xs.slice(0, k + 1).map((v) => law.L(v));
    let ya;
    let yb;
    if (s.zoom) {
      const pts = [r, ...Lk].filter(Number.isFinite);
      ya = Math.min(...pts);
      yb = Math.max(...pts);
      const w = Math.max(yb - ya, Math.abs(r) * 1e-3, 1e-9);
      ya -= 0.15 * w;
      yb += 0.15 * w;
    } else {
      const cap = 2.5 * Math.max(Math.abs(P.rhsRange[0]), Math.abs(P.rhsRange[1]));
      ya = Math.max(-cap, Math.min(r, ...L.filter(Number.isFinite)));
      yb = Math.min(cap, Math.max(r, ...L.filter(Number.isFinite)));
      const pad = 0.06 * (yb - ya);
      ya -= pad;
      yb += pad;
    }
    if (this.frozen) [ya, yb] = this.frozen.y;
    this.view = { x: [a, b], y: [ya, yb] };
    // Zigzag: (x_i, L(x_i)) -> (target, r) -> (x_{i+1}, r) -> (x_{i+1}, L(x_{i+1}))
    const zx = [xs[0]];
    const zy = [law.L(xs[0])];
    for (let i = 1; i <= k; i++) {
      const tg = this.target(i);
      zx.push(tg, xs[i], xs[i]);
      zy.push(r, r, law.L(xs[i]));
    }
    const lawSeries = [
      { x: [a, b], y: [r, r], color: t.input, width: 1.5, dash: [5, 4], marker: false },
      { x: X, y: L, color: t.law, width: 2.5, marker: false },
      { x: zx, y: zy, color: t.iterate, width: 1.5, marker: false },
    ];
    // Construction line of the next step (from the shown iterate), dashed
    if (k < xs.length - 1) {
      const i = k + 1;
      const kind = stepKind(s.method, i, s.iSwitch);
      const tg = this.target(i);
      if (kind === 'picard') lawSeries.push({ x: [0, tg], y: [0, r], color: t.iterate, width: 1.2, dash: [2, 4], marker: false });
      else {
        const x1 = xs[k];
        const y1 = law.L(x1);
        const slope = (y1 - r) / (x1 - tg);
        const ext = (b - a) * 2;
        const xe = [x1 - ext, x1 + ext];
        lawSeries.push({ x: xe, y: xe.map((v) => y1 + slope * (v - x1)), color: t.iterate, width: 1.2, dash: [2, 4], marker: false });
      }
    }
    lawSeries.push({ x: xs.slice(0, k + 1), y: Lk, color: t.iterate, noLine: true, dots: 3.5, marker: false });
    lawSeries.push({ x: [xs[k]], y: [law.L(xs[k])], color: t.iterate, markerSize: 6 });
    this.plots.law.setData(lawSeries, { x: [a, b], y: [ya, yb] }, { xLabel: 'x', yLabel: `A(x) x  and  ${P.rhs}` });
    this.plots.law.setMarker(0);
    this.plots.law.setLabels([
      { x: this.xbar, y: r, text: 'x̄', align: 'center', dy: 14 },
      { x: a + 0.02 * (b - a), y: r, text: `${P.rhs} = ${fmt(r)}`, dy: -10 },
    ]);
    this.figs.law.sub.textContent =
      `Solution x̄: where the curve A(x) x crosses the dashed level ${P.rhs} (drag it to change ${P.rhs}). ` +
      ({
        picard: 'Picard follows the line through the origin (dotted) to the level, then back up to the curve.',
        newton: 'Newton–Raphson follows the tangent (dotted) to the level, then back up to the curve.',
        hybrid: `Picard (line through the origin) for the first ${s.iSwitch} iterations, then Newton–Raphson (tangent).`,
        secant: 'The secant method follows the line through the last two points of the curve.',
      })[s.method] + ' Drag to move x₀.';
    const item = (color, label, value, kind = 'line') => {
      const li = el('li');
      if (color) {
        const key = el('span', { class: 'key key-' + kind });
        key.style.setProperty('--c', color);
        li.append(key);
      }
      li.append(label + ' ', el('strong', { text: value }));
      return li;
    };
    this.figs.law.readout.replaceChildren(
      item(t.iterate, `x${sub_(k)}`, fmt(xs[k], 5), 'dot'),
      item(null, `${lawName}(x${sub_(k)}) =`, fmt(law.L(xs[k]) - r)),
    );

    // 2. Cobweb on the iteration function of the next step
    const nextKind = stepKind(s.method, Math.min(k + 1, xs.length - 1) || 1, s.iSwitch);
    const kindForPhi = nextKind === 'secant' ? null : nextKind;
    const cob = [{ x: [a, b], y: [a, b], color: t.axis, width: 1.5, dash: [5, 4], marker: false }];
    let phiPrime = null;
    if (kindForPhi) {
      const phi = iterationFunction(law, kindForPhi, r, s.gamma);
      const Y = X.map(phi);
      if (s.compose) cob.push({ x: X, y: X.map((v) => phi(phi(v))), color: t.phi2, width: 2, marker: false });
      cob.push({ x: X, y: Y, color: t.phi, width: 2.5, marker: false });
      const h = Math.max(Math.abs(this.xbar), (b - a) * 1e-6) * 1e-6;
      phiPrime = (phi(this.xbar + h) - phi(this.xbar - h)) / (2 * h);
    }
    const cx = [xs[0]];
    const cy = [xs[0]];
    for (let i = 1; i <= k; i++) {
      cx.push(xs[i - 1], xs[i]);
      cy.push(xs[i], xs[i]);
    }
    cob.push({ x: cx, y: cy, color: t.iterate, width: 1.5, marker: false });
    cob.push({ x: xs.slice(0, k + 1), y: xs.slice(0, k + 1), color: t.iterate, noLine: true, dots: 3.5, marker: false });
    cob.push({ x: [this.xbar], y: [this.xbar], color: t.text, noLine: true, dots: 4.5, marker: false });
    cob.push({ x: [xs[k]], y: [xs[k]], color: t.iterate, markerSize: 6 });
    this.plots.cobweb.setData(cob, { x: [a, b], y: [a, b] }, { xLabel: 'xᵢ', yLabel: 'xᵢ₊₁ = Φ(xᵢ)' });
    this.plots.cobweb.setMarker(0);
    this.plots.cobweb.setLabels([{ x: this.xbar + (b - a) * 0.015, y: this.xbar, text: 'x̄', dy: 12 }]);
    const kindName = { picard: 'Picard', newton: 'Newton–Raphson' }[kindForPhi];
    this.figs.cobweb.sub.textContent = kindForPhi
      ? `Φ is the ${kindName} iteration function${s.method === 'hybrid' ? ' of the next step' : ''}. The solution is where Φ crosses the diagonal. ` +
        'Up to the curve, across to the diagonal, and again.'
      : 'The secant step depends on the last two iterates, so it is not a function of xᵢ alone: only the iterates are drawn.';
    const cobItems = [];
    if (kindForPhi) {
      cobItems.push(item(t.phi, 'Φ(x)', kindName));
      if (s.compose) cobItems.push(item(t.phi2, 'Φ(Φ(x))', ''));
      const ap = Math.abs(phiPrime);
      const verdict = ap < 1e-6 ? 'flat: fast convergence close to x̄' : ap < 1 ? 'attractive' : 'repulsive: the iterates are pushed away';
      cobItems.push(el('li', {}, ['Slope at the solution Φ′(x̄) = ', el('strong', { text: fmt(ap < 1e-9 ? 0 : phiPrime) }), ` (${verdict})`]));
    }
    this.figs.cobweb.readout.replaceChildren(...cobItems);

    // 3. Residual and 4. iterates, against the iteration number
    const it = Float64Array.from({ length: xs.length }, (_, i) => i);
    const resSeries = [{ x: it, y: run.res.map((v) => Math.max(v, 1e-18)), color: t.iterate, dots: xs.length < 80 ? 3 : 0, progressive: true }];
    if (run.xa) resSeries.push({ x: it, y: run.resA.map((v) => (Number.isFinite(v) ? Math.max(v, 1e-18) : NaN)), color: t.aitken, dots: xs.length < 80 ? 3 : 0, progressive: true });
    this.plots.residual.hline = ITER_DEFAULTS.tol;
    const resVals = run.res.filter((v) => Number.isFinite(v) && v > 0);
    const rmax = Math.max(1, ...resVals.map((v) => Math.min(v, 1e12)));
    const rmin = Math.min(1e-9, ...resVals);
    this.plots.residual.setData(resSeries, { x: [0, Math.max(1, xs.length - 1)], y: [10 ** Math.floor(Math.log10(rmin)), 10 ** Math.ceil(Math.log10(rmax))] }, { xLabel: 'Iteration i', yLabel: `|${lawName}(xᵢ)|` });

    const itSeries = [
      { x: [0, Math.max(1, xs.length - 1)], y: [this.xbar, this.xbar], color: t.text, width: 1.5, dash: [5, 4], marker: false },
      { x: it, y: xs.map((v) => (Math.abs(v) < 1e8 ? v : NaN)), color: t.iterate, dots: xs.length < 80 ? 3 : 0, progressive: true },
    ];
    if (run.xa) itSeries.push({ x: it, y: run.xa, color: t.aitken, dots: xs.length < 80 ? 3 : 0, progressive: true });
    this.plots.iterates.setData(itSeries, { x: [0, Math.max(1, xs.length - 1)] }, { xLabel: 'Iteration i', yLabel: 'xᵢ' });
    this.renderIndex(k);
    this.renderMapFigure();
  }

  renderMapFigure() {
    const s = this.state;
    const P = PROBLEMS[this.key];
    const name = s.method === 'hybrid' ? `hybrid, ${s.iSwitch} Picard iterations first` : METHODS[s.method] + (s.aitken && s.method === 'picard' ? ' with Aitken acceleration' : '');
    const relax = Math.abs(s.gamma - 1) > 1e-9 ? `, γ = ${s.gamma.toFixed(2)}` : '';
    this.figs.map.title.textContent = `Convergence map: ${name}${relax}`;
    this.figs.map.sub.textContent =
      `Iterations needed from each initial guess x₀ (horizontal) for each right-hand side ${P.rhs} (vertical). ` +
      `Hatched: no convergence (${Math.round(100 * this.mapFailFraction)} % of this map). The black curve is the exact solution x̄(${P.rhs}). Click or drag to pick a run.`;
    const ticks = colorTicks(ITER_DEFAULTS.iMax);
    const bar = el('div', { class: 'fx-scale-bar' });
    bar.style.background = RAMP_CSS;
    for (const tk of ticks) {
      const lab = el('span', { text: tk.label });
      lab.style.left = `${100 * tk.t}%`;
      bar.append(lab);
    }
    this.scale.replaceChildren(el('span', { text: 'Iterations' }), bar, el('span', { class: 'fx-scale-fail' }, [el('i'), 'No convergence']));
    this.renderMapReadout(null);
  }

  renderMapReadout(cell) {
    const P = PROBLEMS[this.key];
    const out = this.figs.map.readout;
    if (!cell) {
      out.replaceChildren(el('li', { text: 'Hover the map to inspect a run.' }));
      return;
    }
    const c = cell.count;
    const what = c > 0 ? `converged in ${c} iteration${c > 1 ? 's' : ''}` : c === -1 ? 'cycle of period 2' : c === -2 ? 'diverged' : 'not converged in 300 iterations';
    out.replaceChildren(el('li', {}, [`x₀ = ${fmt(cell.cellX0)}, ${P.rhs} = ${fmt(cell.cellR)}: `, el('strong', { text: what })]));
  }

  setHover(i) {
    this.renderIndex(i === null ? this.k : i);
  }

  setK(k) {
    const N = this.run.xs.length - 1;
    this.k = Math.max(0, Math.min(N, k));
    this.kInput.value = String(this.k);
    this.renderPlots();
  }

  renderIndex(i) {
    const N = this.run.xs.length - 1;
    for (const key of ['residual', 'iterates']) this.plots[key].setMarker(i);
    this.kOut.textContent = N < this.run.iterations ? `i = ${this.k} (first ${N} of ${this.run.iterations})` : `i = ${this.k} of ${N}`;
    this.prevButton.disabled = this.k <= 0;
    this.nextButton.disabled = this.k >= N;
    const t = this.theme;
    const run = this.run;
    const li = (color, label, value) => {
      const e = el('li');
      if (color) {
        const key = el('span', { class: 'key key-line' });
        key.style.setProperty('--c', color);
        e.append(key);
      }
      e.append(label + ' ', el('strong', { text: value }));
      return e;
    };
    const res = [li(t.iterate, `Iteration ${i}:`, fmt(run.res[i]))];
    if (run.xa) res.push(li(t.aitken, 'Aitken', fmt(run.resA[i])));
    this.figs.residual.readout.replaceChildren(...res);
    const its = [li(t.iterate, `x${sub_(i)} =`, fmt(run.xs[i], 5))];
    if (run.xa) its.push(li(t.aitken, 'Aitken', fmt(run.xa[i], 5)));
    this.figs.iterates.readout.replaceChildren(...its);
  }

  play() {
    const N = this.run.xs.length - 1;
    if (this.k >= N) this.setK(0);
    this.playButton.textContent = '❚❚';
    this.playButton.setAttribute('aria-label', 'Pause');
    const perSecond = 2.5;
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      acc += (Math.max(0, now - last) / 1000) * perSecond;
      last = Math.max(last, now);
      const adv = Math.floor(acc);
      acc -= adv;
      if (adv) this.setK(this.k + adv);
      if (this.k >= N) {
        this.stop();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.playButton) {
      this.playButton.textContent = '▶';
      this.playButton.setAttribute('aria-label', 'Play the iterations');
    }
  }
}

// Subscript digits for x_i labels
function sub_(i) {
  const d = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
  return String(i).split('').map((c) => d[c]).join('');
}

if (!customElements.get('iteration-explorer')) customElements.define('iteration-explorer', IterationExplorer);
