// Content of the "Learn" panel: a guided tour in steps. Each step sets up the explorer (setup) and explains
// what to look at; "details" holds the equations of the paper (MathML, notation of the paper).
// All strings are static and authored here (they are inserted as HTML).

const PAPER = 'Dular, Verweij, Wozniak, Supercond. Sci. Technol. 38 035017 (2025)';

// MathML helpers
const mi = (s) => `<mi>${s}</mi>`;
const mo = (s) => `<mo>${s}</mo>`;
const mn = (s) => `<mn>${s}</mn>`;
const tx = (s) => `<mtext>${s}</mtext>`;
const row = (...xs) => `<mrow>${xs.join('')}</mrow>`;
const sub = (base, s) => `<msub>${base}${s}</msub>`;
const dot = (base) => `<mover accent="true">${base}<mo>&#x2D9;</mo></mover>`;
const bar = (base) => `<mover accent="true">${base}<mo>&#xAF;</mo></mover>`;
const frac = (a, b) => `<mfrac>${a}${b}</mfrac>`;
const abs = (x) => row(mo('|'), x, mo('|'));
const sq = (x) => `<msup>${x}${mn('2')}</msup>`;
const cases = (...lines) =>
  row(mo('{'), `<mtable columnalign="left">${lines.map(([a, c]) => `<mtr><mtd>${a}</mtd><mtd>${c}</mtd></mtr>`).join('')}</mtable>`);
const sp = '<mspace width="1em"/>';
const block = (...xs) => `<math display="block">${xs.join('')}</math>`;
const inline = (...xs) => `<math>${xs.join('')}</math>`;

const h = mi('h');
const b = mi('b');
const m = mi('m');
const mu0 = sub(mi('&#x3BC;'), mn('0'));
const kappa = mi('&#x3BA;');
const chi = mi('&#x3C7;');
const hrev = sub(h, tx('rev'));
const hirr = sub(h, tx('irr'));
const heddy = sub(h, tx('eddy'));
const hcoupling = sub(h, tx('coupling'));
const hrevDot = sub(dot(h), tx('rev'));
const bDot = dot(b);
const taue = sub(mi('&#x3C4;'), tx('e'));
const tauc = sub(mi('&#x3C4;'), tx('c'));
const g = mi('g');
const p = (name) => sub(mi('p'), tx(name));
const f = (name) => sub(mi('f'), mi(name));
const alphak = sub(mi('&#x3B1;'), mi('k'));
const hrevk = sub(h, row(tx('rev'), mo(','), mi('k')));
const sumk = `<munderover><mo>&#x2211;</mo>${row(mi('k'), mo('='), mn('1'))}${mi('N')}</munderover>`;

const ref = (section) => `<p class="rx-ref">Paper: ${section} of ${PAPER}.</p>`;

export const STEPS = [
  {
    title: 'Magnetization and loss',
    setup: { family: 'S', preset: 's6', wave: 'sine', amp: 1, freq: 1 },
    body: `
      <p>Superconducting magnets, like those of particle accelerators, are wound from strands made of many fine
      superconducting filaments embedded in copper. When the magnetic field changes, currents are induced inside the
      strand. These currents magnetize the strand, and they dissipate energy as heat: the <em>AC loss</em>, which the
      cryogenic system has to remove.</p>
      <p>Computing these currents in detail, filament by filament, is expensive. The ROHM model (Reduced Order Hysteretic
      Magnetization) replaces the strand by a simple material law that gives the same magnetization and the same loss,
      at a fraction of the cost.</p>
      <p>Look at the <strong>magnetization loop</strong>: the magnetization lags behind the field, so the curve going up
      is not the curve going down. This is <em>hysteresis</em>. The area inside the loop is the energy lost in each
      cycle.</p>`,
    details: `
      <p>The magnetization ${inline(m)} relates the magnetic flux density ${inline(b)} and the magnetic field ${inline(h)}:</p>
      ${block(b, mo('='), mu0, row(mo('('), h, mo('+'), m, mo(')')))}
      <p>The power density received by the material, and the energy per cycle and per unit volume, are</p>
      ${block(p('tot'), mo('='), h, mo('&#x2062;'), bDot, mo(','), sp, mi('q'), mo('='), `<msubsup><mo>&#x222B;</mo>${frac(mn('1'), mi('f'))}${frac(mn('2'), mi('f'))}</msubsup>`, p('tot'), mo('&#x2062;'), row(mo('('), mi('t'), mo(')')), mo('&#x2009;'), mi('d'), mi('t'))}
      <p>where the dot denotes the time derivative. The model gives access to the part of ${inline(p('tot'))} that is stored (reversible) and to the part that is dissipated (the loss).</p>
      ${ref('Sections 2 and 3.1')}`,
  },
  {
    title: 'One cell: a field with some slack',
    setup: { family: 'S', preset: 's1', wave: 'sine', amp: 1, freq: 1, play: true },
    body: `
      <p>The basic building block is the <em>superconductor cell</em> (S cell). In the <strong>cell view</strong>,
      picture a box of width ${inline(mn('2'), kappa)} that can slide along the field axis. The field ${inline(h)}
      (vertical line) moves freely inside the box. When it reaches an edge, it pushes the box along.</p>
      <p>The dot at the centre of the box is the <em>reversible field</em> ${inline(hrev)}, and it alone sets the flux
      density. While the field turns around inside the box, nothing changes: this delay is what opens the loop. The
      width ${inline(kappa)}, called the irreversibility parameter, sets the width of the loop.</p>
      <p>Energy is dissipated only while the box is pushed (it is then highlighted). Press play and follow the cell view
      and the loop together.</p>`,
    details: `
      <p>The field is split into a reversible and an irreversible part, and only the reversible part sets ${inline(b)}:</p>
      ${block(h, mo('='), hrev, mo('+'), hirr, mo(','), sp, b, mo('='), mu0, hrev)}
      <p>The irreversible field is bounded by ${inline(kappa)}:</p>
      ${block(hirr, mo('='), cases([row(h, mo('&#x2212;'), hrev, mo(',')), row(tx('if&#xA0;'), abs(row(h, mo('&#x2212;'), hrev)), mo('&lt;'), kappa)], [row(kappa, frac(bDot, abs(bDot)), mo(',')), row(tx('if&#xA0;'), abs(row(h, mo('&#x2212;'), hrev)), mo('='), kappa)]))}
      <p>The power splits into a stored part and a dissipated part, which is never negative:</p>
      ${block(p('rev'), mo('='), hrev, mo('&#x2062;'), bDot, mo(','), sp, p('irr'), mo('='), hirr, mo('&#x2062;'), bDot, mo('='), kappa, abs(bDot))}
      <p>In the mechanical analogy of the paper, the cell is a dry friction element in parallel with a spring.</p>
      ${ref('Section 3.2')}`,
  },
  {
    title: 'Stronger fields, narrower loops',
    setup: { family: 'S', preset: 's1', wave: 'sine', amp: 3, freq: 1 },
    body: `
      <p>Superconductors carry less current at high field, so they magnetize less. The model reproduces this by letting
      ${inline(kappa)} decrease as the flux density grows.</p>
      <p>In the <strong>cell view</strong>, the box shrinks when the field is high. Move the <strong>amplitude</strong>
      slider: the loop becomes narrower at high field.</p>`,
    details: `
      ${block(kappa, row(mo('('), b, mo(')')), mo('='), f('&#x3BA;'), row(mo('('), b, mo(')')), mo('&#x2062;'), bar(kappa))}
      <p>with ${inline(bar(kappa))} a constant and ${inline(f('&#x3BA;'))} a scaling function going from 1 at zero field to 0 at large fields. It is determined when identifying the parameters.</p>
      ${ref('Section 3.2')}`,
  },
  {
    title: 'A chain of cells',
    setup: { family: 'S', preset: 's4', wave: 'ripple', amp: 1, freq: 1 },
    body: `
      <p>A single cell switches abruptly from “at rest” to “pushed”, which gives a loop with sharp corners. Real strands
      change more progressively. The model therefore combines several cells with different widths
      ${inline(sub(kappa, mi('k')))}, all driven by the same field. Each cell contributes a fraction ${inline(alphak)}
      of the flux density (its weight, shown on the right of the cell view).</p>
      <p>With the <strong>ripple</strong> waveform, small back-and-forth changes of the field only move the narrow
      boxes: the wide ones stay put. This produces the small inner loops (<em>minor loops</em>) that real strands show.
      Choose 6 cells in the <strong>Cells</strong> menu: more cells, smoother curves.</p>
      <p>In the cell view, the magnetization is the weighted average of the gaps between the dots and the field line.</p>`,
    details: `
      ${block(b, mo('='), sumk, alphak, mu0, hrevk, mo(','), sp, sumk, alphak, mo('='), mn('1'))}
      <p>Each cell follows the rules of the previous steps and can be solved on its own, since all cells see the same field ${inline(h)}. A few fixed-point iterations handle ${inline(sub(kappa, mi('k')), row(mo('('), b, mo(')')))}, which depends on the total flux density. The power is the sum of the contributions of the cells.</p>
      ${ref('Section 3.4')}`,
  },
  {
    title: 'When speed matters: coupling and eddy currents',
    setup: { family: 'CS', preset: 'cs1', wave: 'sine', amp: 1, freq: 10 },
    body: `
      <p>In a real strand, the filaments are embedded in a copper matrix. When the field changes sufficiently fast, currents also
      flow through the copper: <em>coupling currents</em>, which loop from filament to filament, and <em>eddy
      currents</em>. Both affect magnetization and loss, and depend on the speed of the field change.</p>
      <p>The <em>composite superconductor cell</em> (CS cell) adds two fields to the S cell: an eddy field (orange in
      the cell view) and a coupling field (aqua), which grow with the rate of change, with time constants
      ${inline(taue)} and ${inline(tauc)}. The coupling field saturates at ${inline(chi)}: coupling currents cannot exceed
      what the filaments can carry.</p>
      <p>Move the <strong>frequency</strong> slider: at low frequency the cell behaves like an S cell; at higher frequency
      the box lags behind and the loop widens. In the loss-per-cycle plot, the coupling loss peaks, then the eddy loss
      takes over. Unticking <strong>Rate-dependent model</strong> sets both time constants to zero and gives back the
      S cell.</p>`,
    details: `
      ${block(h, mo('='), hrev, mo('+'), hirr, mo('+'), heddy, mo('+'), hcoupling)}
      <p>The rule for ${inline(hirr)} is the same as for the S cell, with ${inline(g, mo('='), hrev, mo('+'), heddy, mo('+'), hcoupling)} in place of ${inline(hrev)}. The two new fields are</p>
      ${block(heddy, mo('='), taue, hrevDot, mo(','), sp, hcoupling, mo('='), cases([row(tauc, hrevDot, mo(',')), row(tx('if&#xA0;'), abs(row(tauc, hrevDot)), mo('&lt;'), chi)], [row(chi, frac(hrevDot, abs(hrevDot)), mo(',')), row(tx('otherwise'))]))}
      ${block(chi, row(mo('('), b, mo(')')), mo('='), f('&#x3C7;'), row(mo('('), b, mo(')')), mo('&#x2062;'), bar(chi))}
      <p>They bring new loss contributions:</p>
      ${block(p('eddy'), mo('='), frac(taue, mu0), sq(bDot), mo(','), sp, p('coupling'), mo('='), frac(mu0, tauc), sq(hcoupling), mo(','), sp, sub(mi('p'), tx('hyst')), mo('='), p('irr'), mo('+'), sub(mi('p'), tx('irr,c')))}
      <p>where ${inline(sub(mi('p'), tx('irr,c')))} is the hysteresis loss of coupled filaments, when the coupling field is saturated. In the mechanical analogy, eddy currents are a dashpot, and coupling currents a dashpot in series with a dry friction element.</p>
      ${ref('Section 3.3')}`,
  },
  {
    title: 'The full model',
    setup: { family: 'CS', preset: 'cs15', wave: 'sine', amp: 1, freq: 1 },
    body: `
      <p>The model of the paper chains 15 composite cells, with parameters identified from detailed finite element
      simulations of a strand. It reproduces magnetization and loss over wide ranges of amplitudes and frequencies, and is
      fast enough to be used inside large simulations of magnets, where it replaces each strand by a homogenized
      material.</p>
      <p>Explore the <strong>loss per cycle</strong> as a function of frequency: hysteresis dominates at low frequency,
      coupling currents at intermediate frequencies, and eddy currents at high frequency. Tick <strong>Custom
      values</strong> to change any parameter and see its effect.</p>
      <p>Keep in mind that the model is driven by the field inside the strand, not by the applied field (see the note
      below the plots).</p>`,
    details: `
      <p>The loss per cycle is computed over the second cycle of a sine, starting from the virgin state:</p>
      ${block(mi('q'), mo('='), `<msubsup><mo>&#x222B;</mo>${frac(mn('1'), mi('f'))}${frac(mn('2'), mi('f'))}</msubsup>`, row(mo('('), sub(mi('p'), tx('hyst')), mo('+'), p('coupling'), mo('+'), p('eddy'), mo(')')), mo('&#x2009;'), mi('d'), mi('t'))}
      <p>The 15-cell parameters are those of Table 1 of the paper, with ${inline(mu0, sub(bar(chi), mn('11')), mo('='), mn('0.75'), tx('&#xA0;T'))}. Their identification is described in Sections 5 and 7.</p>
      ${ref('Sections 5 and 7')}`,
  },
];
