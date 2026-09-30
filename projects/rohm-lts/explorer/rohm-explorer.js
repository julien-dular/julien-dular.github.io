// <rohm-explorer>: interactive explorer of the ROHM model.
// Self-contained: everything renders in a shadow root and every file is loaded relative to this module,
// so the host page only needs the element and one <script type="module"> tag.
import { MU0, makeChain, kappaScale, computeS, computeCS, lossPerCycle, frequencySpan } from './model/rohm.js';
import { LinePlot, formatCompact } from './ui/plot.js';
import { CellView } from './ui/cells.js';
import { ParamTable } from './ui/params.js';
import { STEPS } from './ui/tour.js';

const here = (path) => new URL(path, import.meta.url).href;

const PAPER_URL = 'https://iopscience.iop.org/article/10.1088/1361-6668/adb5cc';
const ARXIV_URL = 'https://arxiv.org/abs/2409.13653';
const AMP_RANGE = [0.01, 4]; // T
const FREQ_RANGE = [0.01, 1e4]; // Hz
const PERIODS = 2;
const STEPS_PER_PERIOD = 400;
const SWEEP_FREQS = Array.from({ length: 25 }, (_, i) => 10 ** (-2 + (6 * i) / 24));
const SLIDER_MAX = 1000;

const WAVES = {
  sine: { label: 'Sine', h: (t, f) => Math.sin(2 * Math.PI * f * t) },
  ripple: {
    label: 'Sine with ripple (minor loops)',
    h: (t, f) => Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * 6 * Math.PI * f * t),
  },
};

const FAMILIES = {
  CS: { title: 'Chain of composite superconductor (CS) cells: filament hysteresis, coupling currents and eddy currents.' },
  S: { title: 'Chain of superconductor (S) cells: filament hysteresis only, independent of the speed of the field change.' },
};

// Log slider <-> value
const toValue = (pos, [a, b]) => 10 ** (Math.log10(a) + (pos / SLIDER_MAX) * (Math.log10(b) - Math.log10(a)));
const toPos = (v, [a, b]) => Math.round(((Math.log10(v) - Math.log10(a)) / (Math.log10(b) - Math.log10(a))) * SLIDER_MAX);

function formatT(v) {
  const abs = Math.abs(v);
  const s = abs >= 1 ? v.toFixed(2) : abs >= 0.1 ? v.toFixed(3) : abs >= 0.01 ? v.toFixed(4) : v.toPrecision(2);
  return s.replace('-', '−') + ' T';
}

function formatHz(f) {
  if (f >= 1000) return +(f / 1000).toPrecision(2) + ' kHz';
  return +f.toPrecision(2) + ' Hz';
}

// SI prefix for a set of values in a base unit: returns the scale and the prefixed unit
function siScale(maxAbs, unit) {
  const prefixes = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, '']];
  for (const [s, p] of prefixes) if (maxAbs >= s) return { scale: s, unit: p + unit };
  return { scale: 1, unit };
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

// Cell parameters of a preset, one object per cell (the format of the custom values table)
function presetRows(preset) {
  return preset.mu0_kappa.map((k, i) => {
    const row = { mu0_kappa: k, alpha: preset.alpha[i] };
    if (preset.tau_c) Object.assign(row, { tau_e: preset.tau_e[i], tau_c: preset.tau_c[i], mu0_chi: preset.mu0_chi[i] });
    return row;
  });
}

function rowsToPreset(rows, family) {
  const preset = { mu0_kappa: rows.map((r) => r.mu0_kappa), alpha: rows.map((r) => r.alpha) };
  if (family === 'CS') {
    preset.tau_e = rows.map((r) => r.tau_e ?? 0);
    preset.tau_c = rows.map((r) => r.tau_c ?? 0);
    preset.mu0_chi = rows.map((r) => r.mu0_chi ?? 0);
  }
  return preset;
}

class RohmExplorer extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.init().catch((err) => {
      this.shadowRoot.replaceChildren(el('p', { class: 'rx-error', text: 'The ROHM explorer could not be loaded (' + err.message + ').' }));
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
    const [presets, scalings] = await Promise.all([
      fetch(here('data/presets.json')).then((r) => r.json()),
      fetch(here('data/scalings.json')).then((r) => r.json()),
      cssLoaded,
      document.fonts ? document.fonts.ready : null,
    ]);
    this.presets = presets;
    this.scalings = scalings;
    this.state = { mode: 'explore', step: 0, family: 'CS', preset: { CS: 'cs15', S: 's6' }, custom: false, wave: 'sine', amp: 1, freq: 1 };
    this.customRows = { S: null, CS: null };
    this.build();
    this.theme = this.readTheme();
    this.makePlots();
    this.syncControls();
    this.update({ sweep: true });
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
      text: color('--rx-text'),
      muted: color('--rx-muted'),
      surface: color('--rx-surface'),
      grid: color('--rx-grid'),
      axis: color('--rx-axis'),
      accent: color('--rx-accent'),
      input: color('--rx-input'),
      hyst: color('--rx-hyst'),
      coupling: color('--rx-coupling'),
      eddy: color('--rx-eddy'),
      font: getComputedStyle(this).getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif',
    };
    probe.remove();
    return theme;
  }

  build() {
    const s = this.state;
    this.root = el('div', { class: 'rx' });

    // Header, with the choice between free exploration and the guided tour
    this.modeButtons = {};
    const modes = el('div', { class: 'rx-seg', role: 'group', 'aria-label': 'Mode' });
    for (const [key, label] of [['explore', 'Explore'], ['learn', 'Learn step by step']]) {
      const b = el('button', { type: 'button', text: label });
      b.addEventListener('click', () => this.setMode(key));
      modes.append(b);
      this.modeButtons[key] = b;
    }
    this.root.append(
      el('div', { class: 'rx-head' }, [
        el('div', { class: 'rx-head-row' }, [el('h2', { text: 'Try the model' }), modes]),
        el('p', { text: 'Pick a model and a field, and every plot updates instantly. Hover or tap a plot to inspect a moment in time. New to the model? Learn it step by step.' }),
      ]),
    );

    // Guided tour
    this.tour = {
      count: el('p', { class: 'rx-step-count' }),
      title: el('h3'),
      body: el('div', { class: 'rx-tour-body' }),
      details: el('div', { class: 'rx-tour-details' }),
      prev: el('button', { type: 'button', class: 'rx-button', text: '← Previous' }),
      next: el('button', { type: 'button', class: 'rx-button rx-button-primary', text: 'Next →' }),
    };
    this.tour.prev.addEventListener('click', () => this.setStep(s.step - 1));
    this.tour.next.addEventListener('click', () => this.setStep(s.step + 1));
    this.tourCard = el('section', { class: 'rx-tour', 'aria-label': 'Guided tour' }, [
      this.tour.count,
      this.tour.title,
      this.tour.body,
      el('details', { class: 'rx-details' }, [el('summary', { text: 'Full details' }), this.tour.details]),
      el('div', { class: 'rx-tour-nav' }, [this.tour.prev, this.tour.next]),
    ]);
    this.root.append(this.tourCard);

    // Controls
    this.rateCheck = el('input', { type: 'checkbox' });
    this.rateCheck.addEventListener('change', () => {
      s.family = this.rateCheck.checked ? 'CS' : 'S';
      this.syncControls();
      this.update({ sweep: true });
    });
    this.rateField = el('label', {
      class: 'rx-check',
      title: 'Ticked: the response depends on how fast the field changes (coupling and eddy currents). Unticked: filament hysteresis only.',
    }, [this.rateCheck, el('span', { text: 'Rate-dependent model' })]);

    this.presetSelect = el('select');
    this.presetSelect.addEventListener('change', () => {
      s.preset[s.family] = this.presetSelect.value;
      if (s.custom) this.customRows[s.family] = presetRows(this.currentPreset());
      this.syncControls();
      this.update({ sweep: true });
    });
    this.presetLabel = el('span', { text: 'Cells' });

    this.customCheck = el('input', { type: 'checkbox' });
    this.customCheck.addEventListener('change', () => {
      s.custom = this.customCheck.checked;
      this.syncControls();
      this.update({ sweep: true });
    });

    this.waveSelect = el('select', { 'aria-label': 'Field waveform' });
    for (const [key, w] of Object.entries(WAVES)) this.waveSelect.append(el('option', { value: key, text: w.label }));
    this.waveSelect.addEventListener('change', () => {
      s.wave = this.waveSelect.value;
      this.update();
    });

    const slider = (label, range, format, onInput) => {
      const input = el('input', { type: 'range', min: '0', max: String(SLIDER_MAX), 'aria-label': label });
      const out = el('output');
      input.addEventListener('input', () => {
        const v = toValue(+input.value, range);
        out.textContent = format(v);
        onInput(v);
      });
      const field = el('label', { class: 'rx-field rx-slider' }, [el('span', { text: label }), el('span', { class: 'rx-slider-row' }, [input, out])]);
      const setValue = (v) => {
        input.value = String(toPos(v, range));
        out.textContent = format(v);
      };
      return { input, out, field, setValue };
    };
    this.ampSlider = slider('Field amplitude μ₀hₘₐₓ', AMP_RANGE, formatT, (v) => {
      s.amp = v;
      this.schedule({ sweep: true });
    });
    this.freqSlider = slider('Frequency f', FREQ_RANGE, formatHz, (v) => {
      s.freq = v;
      this.schedule();
    });

    this.root.append(
      el('div', { class: 'rx-controls' }, [
        this.rateField,
        el('div', { class: 'rx-field' }, [
          this.presetLabel,
          el('span', { class: 'rx-inline' }, [
            this.presetSelect,
            el('label', { class: 'rx-check rx-check-small' }, [this.customCheck, el('span', { text: 'Custom values' })]),
          ]),
        ]),
        el('label', { class: 'rx-field' }, [el('span', { text: 'Field waveform' }), this.waveSelect]),
      ]),
    );
    this.presetSelect.setAttribute('aria-label', 'Cells');

    this.paramHost = el('div', { class: 'rx-params' });
    this.paramTable = new ParamTable(this.paramHost, (rows) => {
      this.customRows[s.family] = rows;
      this.schedule({ sweep: true });
    });
    this.root.append(this.paramHost);

    this.desc = el('p', { class: 'rx-desc' });
    this.root.append(this.desc);

    // Sliders and play bar stay visible while scrolling through the plots
    this.playButton = el('button', { type: 'button', 'aria-label': 'Play', text: '▶' });
    this.playButton.addEventListener('click', () => (this.raf ? this.stop() : this.play()));
    this.timeInput = el('input', { type: 'range', min: '0', max: '1', value: '1', 'aria-label': 'Time' });
    this.timeInput.addEventListener('input', () => {
      this.stop();
      this.setIndex(+this.timeInput.value);
    });
    this.timeOut = el('output');
    const play = el('div', { class: 'rx-field rx-play' }, [
      el('span', { text: 'Time' }),
      el('span', { class: 'rx-slider-row' }, [this.playButton, this.timeInput, this.timeOut]),
    ]);
    this.root.append(el('div', { class: 'rx-sticky' }, [this.ampSlider.field, this.freqSlider.field, play]));

    // Plots
    const figure = (title, sub, wide = false) => {
      const canvas = el('div', { class: 'rx-canvas' });
      const readout = el('ul', { class: 'rx-readout' });
      const subEl = el('p', { class: 'rx-sub', text: sub });
      const fig = el('figure', { class: 'rx-plot' + (wide ? ' is-wide' : '') }, [el('h3', { text: title }), subEl, canvas, readout]);
      return { fig, canvas, readout, sub: subEl };
    };
    this.figs = {
      loop: figure('Magnetization loop', 'Magnetization of the strand as the field goes up and down. The area of the loop is the energy lost per cycle.'),
      time: figure('Field and magnetization over time', 'The field is the input, the magnetization is the response of the model.'),
      cells: figure('Cell view: inside the model', '', true),
      power: figure('Dissipated power', 'How fast energy turns into heat, for each loss mechanism.'),
      loss: figure('Loss per cycle vs frequency', ''),
    };
    this.root.append(el('div', { class: 'rx-grid' }, Object.values(this.figs).map((f) => f.fig)));

    // Internal vs applied field
    const note = el('details', { class: 'rx-note' }, [
      el('summary', { text: 'Note: h is the field inside the strand, not the applied field' }),
    ]);
    const p1 = el('p');
    p1.append(
      'The model is driven by the magnetic field h inside the strand. The magnetized strand modifies the field it sees ' +
        '(demagnetization): for a round strand in a transverse field, h = h',
      el('sub', { text: 'app' }),
      ' − m/2, with h',
      el('sub', { text: 'app' }),
      ' the applied field. ' +
        'Feeding the applied field directly to the model, or comparing its curves with measurements plotted against the applied field, ' +
        'is a common mistake. See Section 3.1 of the ',
      el('a', { href: PAPER_URL, target: '_blank', rel: 'noopener noreferrer', text: 'paper' }),
      '.',
    );
    note.append(p1);
    note.open = true;
    this.root.append(note);

    const foot = el('p', { class: 'rx-foot' });
    foot.append(
      'ROHM model: J. Dular, A. Verweij, M. Wozniak, ',
      el('a', { href: PAPER_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Supercond. Sci. Technol. 38 035017 (2025)' }),
      ', also on ',
      el('a', { href: ARXIV_URL, target: '_blank', rel: 'noopener noreferrer', text: 'arXiv' }),
      '. Powers and energies are per unit volume of strand.',
    );
    this.root.append(foot);
    this.root.append(
      el('p', {
        class: 'rx-ai',
        text:
          'The development of this application was assisted by Claude Opus 5.5, outputs and results were carefully checked but errors may remain. ' +
          'Please contact me if you find any, or if you have any question or suggestion for improvement. Thank you!',
      }),
    );

    this.shadowRoot.append(this.root);
  }

  makePlots() {
    const t = this.theme;
    const hover = (i) => this.setHover(i);
    const click = (i) => {
      this.stop();
      this.setIndex(i);
    };
    this.plots = {
      loop: new LinePlot(this.figs.loop.canvas, { theme: t, hover: 'nearest', onHover: hover, onClick: click, ariaLabel: 'Magnetization loop', height: 260 }),
      time: new LinePlot(this.figs.time.canvas, { theme: t, hover: 'x', onHover: hover, onClick: click, ariaLabel: 'Field and magnetization over time', height: 260 }),
      power: new LinePlot(this.figs.power.canvas, { theme: t, hover: 'x', onHover: hover, onClick: click, ariaLabel: 'Dissipated power over time', height: 260 }),
      loss: new LinePlot(this.figs.loss.canvas, {
        theme: t,
        xLog: true,
        yLog: true,
        hover: 'x',
        onHover: (i) => this.renderLossReadout(i),
        onClick: (i) => this.setFrequency(SWEEP_FREQS[i]),
        ariaLabel: 'Energy loss per cycle as a function of frequency',
        height: 260,
      }),
    };
    this.cellView = new CellView(this.figs.cells.canvas, { theme: t, ariaLabel: 'Cells of the model at the current time' });
  }

  currentPreset() {
    const s = this.state;
    return this.presets[s.family].find((p) => p.id === s.preset[s.family]);
  }

  // Brings every control in line with the state.
  syncControls() {
    const s = this.state;
    for (const [key, b] of Object.entries(this.modeButtons)) b.setAttribute('aria-pressed', String(key === s.mode));
    this.tourCard.hidden = s.mode !== 'learn';

    this.rateCheck.checked = s.family === 'CS';
    const list = this.presets[s.family];
    this.presetSelect.replaceChildren(...list.map((p) => el('option', { value: p.id, text: p.label })));
    this.presetSelect.value = s.preset[s.family];
    this.customCheck.checked = s.custom;
    this.presetLabel.textContent = s.custom ? 'Cells (starting point)' : 'Cells';
    if (s.custom) {
      if (!this.customRows[s.family]) this.customRows[s.family] = presetRows(this.currentPreset());
      this.paramTable.set(this.customRows[s.family], s.family);
    }
    this.paramHost.hidden = !s.custom;
    this.desc.textContent = FAMILIES[s.family].title + ' ' + (s.custom ? 'Custom values.' : this.currentPreset().description);

    this.waveSelect.value = s.wave;
    this.ampSlider.setValue(s.amp);
    this.freqSlider.setValue(s.freq);
    const rateIndependent = s.family === 'S';
    this.freqSlider.input.disabled = rateIndependent;
    this.freqSlider.field.classList.toggle('is-disabled', rateIndependent);
    this.freqSlider.field.title = rateIndependent ? 'S cells do not depend on the speed of the field change: frequency has no effect.' : '';
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
  applySetup({ family, preset, wave, amp, freq, play = false }) {
    const s = this.state;
    this.stop();
    Object.assign(s, { family, wave, amp, freq, custom: false });
    s.preset[family] = preset;
    this.index = undefined;
    this.syncControls();
    this.update({ sweep: true });
    if (play && !matchMedia('(prefers-reduced-motion: reduce)').matches) this.play();
  }

  chain() {
    const s = this.state;
    const preset = s.custom ? rowsToPreset(this.customRows[s.family], s.family) : this.currentPreset();
    return makeChain(preset, this.scalings);
  }

  // Coalesces updates from continuous inputs (sliders, dragged values) to one per frame.
  schedule({ sweep = false } = {}) {
    this.pendingSweep = this.pendingSweep || sweep;
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      const sw = this.pendingSweep;
      this.pending = null;
      this.pendingSweep = false;
      this.update({ sweep: sw });
    });
  }

  // Recomputes the response (and the frequency sweep when the model or the amplitude changed).
  update({ sweep = false } = {}) {
    const s = this.state;
    const chain = this.chain();
    const hs = s.amp / MU0;
    const f = s.family === 'S' ? 1 : s.freq; // S cells: time is only a parameter
    const n = PERIODS * STEPS_PER_PERIOD + 1;
    const time = new Float64Array(n);
    const h = new Float64Array(n);
    const wave = WAVES[s.wave].h;
    for (let i = 0; i < n; i++) {
      time[i] = (i * PERIODS) / f / (n - 1);
      h[i] = hs * wave(time[i], f);
    }
    const r = s.family === 'S' ? computeS(chain, time, h) : computeCS(chain, time, h);
    const cycles = time.map((ti) => ti * f);
    const mu0h = h.map((v) => MU0 * v);
    const m = r.b.map((b, i) => b - mu0h[i]);
    // Powers are given between steps: plot them at the end of each step
    const pHyst = r.pIrrC ? r.pIrr.map((v, i) => v + r.pIrrC[i]) : r.pIrr;
    this.data = { n, cycles, mu0h, m, pt: cycles.subarray(1), pHyst, pCoupling: r.pCoupling, pEddy: r.pEddy };

    // Cells, in T (mu0 times the fields)
    const toT = (arr) => arr.map((v) => MU0 * v);
    const fk = r.b.map((b) => kappaScale(chain, b));
    const hmax = Math.max(...mu0h.map(Math.abs), 1e-6) * 1.12;
    this.cellData = {
      N: chain.N,
      alphas: chain.alphas,
      mu0h,
      range: [-hmax, hmax],
      cells: r.hrev.map((_, k) => ({
        hrev: toT(r.hrev[k]),
        hirr: toT(r.hirr[k]),
        heddy: r.heddy ? toT(r.heddy[k]) : null,
        hcoupling: r.hcoupling ? toT(r.hcoupling[k]) : null,
      })),
      kappa: chain.kappas.map((kap) => fk.map((x) => MU0 * kap * x)),
    };

    if (sweep || !this.sweep) {
      if (s.family === 'S') {
        const q = lossPerCycle(chain, 1, hs);
        this.sweep = SWEEP_FREQS.map(() => q);
      } else {
        this.sweep = frequencySpan(chain, SWEEP_FREQS, hs);
      }
    }
    this.current = s.family === 'S' ? this.sweep[0] : lossPerCycle(chain, s.freq, hs);

    this.timeInput.max = String(n - 1);
    if (this.index === undefined || this.index > n - 1) this.index = n - 1;
    this.timeInput.value = String(this.index);
    this.renderPlots();
    this.renderIndex(this.index);
  }

  renderPlots() {
    const t = this.theme;
    const d = this.data;
    const s = this.state;
    const bmax = Math.max(...d.mu0h.map(Math.abs), ...d.m.map(Math.abs)) * 1.08;

    this.plots.loop.setData(
      [{ x: d.mu0h, y: d.m, color: t.accent, progressive: true }],
      {},
      { xLabel: 'Field inside the strand μ₀h (T)', yLabel: 'Magnetization μ₀m (T)' },
    );
    this.plots.time.setData(
      [
        { x: d.cycles, y: d.mu0h, color: t.input, progressive: true },
        { x: d.cycles, y: d.m, color: t.accent, progressive: true },
      ],
      { x: [0, PERIODS], y: [-bmax, bmax] },
      { xLabel: s.family === 'S' ? 'Time (cycles of the field)' : 'Time (cycles, t·f)', yLabel: 'Field or magnetization (T)' },
    );

    // Cell view and its legend
    this.cellView.setData(this.cellData);
    this.figs.cells.sub.textContent =
      'Each row is one cell. The field h (vertical line) moves freely inside each box and pushes it when it reaches an edge: ' +
      'this lag is the hysteresis, and energy is lost while a box is pushed (darker fill). The dots set the flux density; the ' +
      'magnetization is the weighted average of their gaps to the field line.' +
      (s.family === 'CS' ? ' Eddy and coupling currents make the dots lag further behind when the field changes quickly.' : '');
    const sub = (text) => el('sub', { text });
    const legend = [
      this.legendItem('line', t.text, 'Field h'),
      this.legendItem('dot', t.accent, 'Reversible field h', sub('rev,k')),
      this.legendItem('box', t.hyst, 'Hysteresis box, half-width κ', sub('k'), '(b)'),
    ];
    if (s.family === 'CS') legend.push(this.legendItem('line', t.eddy, 'Eddy field'), this.legendItem('line', t.coupling, 'Coupling field'));
    legend.push(el('li', {}, ['Right: weight α', sub('k'), ' of each cell']));
    this.figs.cells.readout.replaceChildren(...legend);

    const powerSeries = [{ key: 'hyst', label: 'Hysteresis', y: d.pHyst, color: t.hyst }];
    if (s.family === 'CS') {
      powerSeries.push({ key: 'coupling', label: 'Coupling', y: d.pCoupling, color: t.coupling });
      powerSeries.push({ key: 'eddy', label: 'Eddy', y: d.pEddy, color: t.eddy });
    }
    let pmax = 0;
    for (const ps of powerSeries) for (const v of ps.y) pmax = Math.max(pmax, Math.abs(v));
    this.powerUnit = siScale(pmax, 'W/m³');
    this.powerSeries = powerSeries;
    this.plots.power.setData(
      powerSeries.map((ps) => ({ x: d.pt, y: ps.y.map((v) => v / this.powerUnit.scale), color: ps.color, progressive: true })),
      { x: [0, PERIODS] },
      { xLabel: 'Time (cycles)', yLabel: `Power (${this.powerUnit.unit})` },
    );

    // Loss per cycle vs frequency
    const q = this.sweep;
    const lossSeries = [{ key: 'total', label: 'Total', color: t.text, get: (r) => r.qIrr + r.qIrrC + r.qCoupling + r.qEddy }];
    lossSeries.push({ key: 'hyst', label: 'Hysteresis', color: t.hyst, get: (r) => r.qIrr + r.qIrrC });
    if (s.family === 'CS') {
      lossSeries.push({ key: 'coupling', label: 'Coupling', color: t.coupling, get: (r) => r.qCoupling });
      lossSeries.push({ key: 'eddy', label: 'Eddy', color: t.eddy, get: (r) => r.qEddy });
    }
    this.lossSeries = lossSeries;
    const totals = q.map(lossSeries[0].get);
    const top = 10 ** Math.ceil(Math.log10(Math.max(...totals)));
    this.plots.loss.setData(
      lossSeries.map((ls) => ({ x: SWEEP_FREQS, y: q.map(ls.get), color: ls.color, width: ls.key === 'total' ? 2.5 : 2 })),
      { x: FREQ_RANGE, y: [top / 1e4, top] },
      { xLabel: 'Frequency (Hz)', yLabel: 'Energy per cycle (J/m³)' },
    );
    this.plots.loss.setVLine(s.family === 'S' ? null : s.freq);
    this.figs.loss.sub.textContent =
      s.family === 'S'
        ? `For a sine of amplitude ${formatT(s.amp)}. Filaments alone lose the same energy per cycle at any frequency.`
        : `For a sine of amplitude ${formatT(s.amp)}. The vertical line is the current frequency; click to change it.`;
    this.renderLossReadout(null);
  }

  legendItem(kind, color, ...label) {
    const key = el('span', { class: 'key key-' + kind });
    key.style.setProperty('--c', color);
    return el('li', {}, [key, ...label]);
  }

  setFrequency(f) {
    if (this.state.family === 'S') return;
    this.state.freq = f;
    this.freqSlider.setValue(f);
    this.update();
  }

  setHover(i) {
    this.hoverIndex = i;
    this.renderIndex(i === null ? this.index : i);
  }

  setIndex(i) {
    this.index = i;
    this.timeInput.value = String(i);
    this.renderIndex(i);
  }

  // Marker and readouts at step i
  renderIndex(i) {
    const d = this.data;
    const t = this.theme;
    for (const key of ['loop', 'time']) this.plots[key].setMarker(i);
    this.plots.power.setMarker(Math.max(0, i - 1));
    this.cellView.setIndex(i);
    this.timeOut.textContent = `t = ${d.cycles[i].toFixed(2)} cycles`;

    const item = (color, label, value) => {
      const li = el('li');
      if (color) {
        const key = el('span', { class: 'key key-line' });
        key.style.setProperty('--c', color);
        li.append(key);
      }
      li.append(label + ' ', el('strong', { text: value }));
      return li;
    };
    this.figs.loop.readout.replaceChildren(item(null, 'μ₀h', formatT(d.mu0h[i])), item(null, 'μ₀m', formatT(d.m[i])));
    this.figs.time.readout.replaceChildren(item(t.input, 'Field μ₀h', formatT(d.mu0h[i])), item(t.accent, 'Magnetization μ₀m', formatT(d.m[i])));
    const j = Math.max(0, i - 1);
    this.figs.power.readout.replaceChildren(
      ...this.powerSeries.map((ps) => item(ps.color, ps.label, formatCompact(ps.y[j] / this.powerUnit.scale) + ' ' + this.powerUnit.unit)),
    );
  }

  renderLossReadout(i) {
    const s = this.state;
    const r = i === null ? this.current : this.sweep[i];
    const f = i === null ? s.freq : SWEEP_FREQS[i];
    this.plots.loss.setMarker(i);
    const items = this.lossSeries.map((ls) => {
      const key = el('span', { class: 'key key-line' });
      key.style.setProperty('--c', ls.color);
      return el('li', {}, [key, ls.label + ' ', el('strong', { text: formatCompact(ls.get(r)) + ' J/m³' })]);
    });
    if (s.family === 'CS') items.unshift(el('li', { text: `At ${formatHz(f)}:` }));
    this.figs.loss.readout.replaceChildren(...items);
  }

  play() {
    const n = this.data.n;
    if (this.index >= n - 1) this.setIndex(0);
    this.playButton.textContent = '❚❚';
    this.playButton.setAttribute('aria-label', 'Pause');
    const stepsPerSecond = STEPS_PER_PERIOD / 3; // one cycle in 3 s
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      // The first frame's timestamp can precede the click: never step backwards
      acc += (Math.max(0, now - last) / 1000) * stepsPerSecond;
      last = Math.max(last, now);
      const adv = Math.floor(acc);
      acc -= adv;
      const next = Math.min(this.index + adv, n - 1);
      if (next !== this.index) this.setIndex(next);
      if (next >= n - 1) {
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
      this.playButton.setAttribute('aria-label', 'Play');
    }
  }
}

if (!customElements.get('rohm-explorer')) customElements.define('rohm-explorer', RohmExplorer);
