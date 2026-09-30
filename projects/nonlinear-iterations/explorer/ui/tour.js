// Content of the "Learn" panel: a guided tour in steps, following Section 2.7 of the thesis. Each step sets
// up the explorer (setup) and explains what to look at; "details" holds the equations (MathML).
// All strings are static and authored here (they are inserted as HTML).
import {
  mi, mo, mn, tx, row, sub, sup, frac, abs, par, bar, block, inline, x, xi, xi1, xbar, n, lambda, eps, gamma, Phi, b, c, mur, nur,
} from './math.js';

const THESIS =
  'J. Dular, <a href="https://hdl.handle.net/2268/298054" target="_blank" rel="noopener noreferrer">Standard and mixed finite element formulations for systems with type-II superconductors</a>, PhD thesis, University of Liège (2023)';
const ref = (section) => `<p class="fx-ref">Thesis: ${section} of ${THESIS}.</p>`;

const A = (arg) => row(mi('A'), par(arg));
const J = (arg) => row(mi('J'), par(arg));
const Phix = (arg) => row(Phi, par(arg));
const Phip = (arg) => row(Phi, mo('&#x2032;'), par(arg));
const nm1 = row(n, mo('&#x2212;'), mn('1'));

export const STEPS = [
  {
    title: 'Solving a nonlinear equation by iterations',
    setup: { problem: 'power-h', method: 'newton', rhs: 1.1, x0: 0.5 },
    body: `
      <p>In a finite element model with a nonlinear material, every time step requires solving a system of the form
      ${inline(A(x), x, mo('='), b)}, where the matrix ${inline(mi('A'))} depends on the unknowns
      ${inline(x)} through the material law. It cannot be solved directly: we start from a guess
      ${inline(sub(x, mn('0')))} and improve it, iteration after iteration.</p>
      <p>Here, ${inline(x)} is a single number, so everything can be drawn. The top-left plot shows the curve
      ${inline(A(x), x)} and the level ${inline(b)}: the solution ${inline(xbar)} is where they cross. The
      <strong>Newton–Raphson</strong> method follows the tangent of the curve at ${inline(xi)} down to the level
      ${inline(b)} to get ${inline(xi1)}. Press <strong>▶</strong> in the bar to replay the iterations one by one.</p>
      <p>Switch the method to <strong>Picard</strong>: it follows the line through the origin (the secant) instead
      of the tangent. For this value of ${inline(b)}, it never converges. We will see why.</p>`,
    details: `
      <p>Picard iteration: freeze the matrix at the previous iterate and solve the linear system,</p>
      ${block(A(xi), xi1, mo('='), b)}
      <p>Newton–Raphson iteration: linearize ${inline(A(x), x)} around the previous iterate,</p>
      ${block(A(xi), xi, mo('+'), J(xi), par(xi1, mo('&#x2212;'), xi), mo('='), b, mo(','), '<mspace width="1em"/>', J(x), mo('='), frac(row(mi('d')), row(mi('d'), x)), par(A(x), x))}
      <p>The iterations stop when the residual is small: ${inline(abs(A(xi), xi, mo('&#x2212;'), b), mo('&lt;'), sup(mn('10'), row(mo('&#x2212;'), mn('8'))))}
      <span class="fx-ref">(after at most 300 iterations, as in the thesis).</span></p>
      ${ref('Sections 2.6.1 and 2.6.2')}`,
  },
  {
    title: 'Iterations as a search for a fixed point',
    setup: { problem: 'power-h', method: 'newton', rhs: 1.1, x0: 0.5 },
    body: `
      <p>Each method is a function ${inline(Phi)} that maps an iterate to the next one:
      ${inline(xi1, mo('='), Phix(xi))}. The solution is a <em>fixed point</em>: ${inline(Phix(xbar), mo('='), xbar)},
      where the curve ${inline(mi('y'), mo('='), Phix(x))} crosses the diagonal ${inline(mi('y'), mo('='), x)}.</p>
      <p>The top-right plot draws the iterations as a <em>cobweb</em>: go up to the curve to get the next
      iterate, across to the diagonal to use it as the new input, and repeat. The slope of ${inline(Phi)} at the
      fixed point decides everything: if ${inline(abs(Phip(xbar)), mo('&lt;'), mn('1'))}, the iterates are
      attracted; if ${inline(abs(Phip(xbar)), mo('&gt;'), mn('1'))}, they are pushed away.</p>
      <p>For Newton–Raphson, ${inline(Phip(xbar), mo('='), mn('0'))} always: the curve is flat at the fixed point,
      which gives the famous quadratic convergence once the iterates are close enough (see the residual
      plot: the number of correct digits doubles at each iteration).</p>`,
    details: `
      ${block(sub(Phi, mi('Pi')), par(x), mo('='), frac(b, A(x)), mo(','), '<mspace width="1.5em"/>', sub(Phi, tx('NR')), par(x), mo('='), x, mo('&#x2212;'), frac(row(A(x), x, mo('&#x2212;'), b), J(x)))}
      <p>If ${inline(abs(Phip(x)), mo('&lt;'), mn('1'))} on an interval, ${inline(Phi)} is a contraction there and the
      iterations converge to the unique fixed point, at least linearly, with a convergence factor close to
      ${inline(abs(Phip(xbar)))} near the solution. For Newton–Raphson,
      ${inline(sub(Phi, tx('NR')), mo('&#x2032;'), par(xbar), mo('='), mn('0'))} because the residual vanishes at
      ${inline(xbar)}.</p>
      ${ref('Section 2.7.1')}`,
  },
  {
    title: 'When Picard iterations cycle',
    setup: { problem: 'power-h', method: 'picard', rhs: 1.1, x0: 0.5, compose: true },
    body: `
      <p>Same equation, now with <strong>Picard</strong>. The slope of ${inline(Phi)} at the solution is larger
      than 1 in magnitude (see below the cobweb): the solution is <em>repulsive</em>. The iterates do not diverge,
      though: they settle on a <strong>cycle of period 2</strong>, jumping forever between two wrong values.</p>
      <p>The green curve is ${inline(Phix(Phix(x)))}, two iterations at once. It crosses the diagonal at the
      solution, but also at the two points of the cycle, where its slope is smaller than 1: these points are
      attractive. Drag the dashed level ${inline(b)} below 1 in the left plot and watch the cycle disappear.</p>
      <p>This equation is the simplest analogue of the <strong>h-formulation</strong> for a superconductor
      described by the power law: the nonlinearity is a <em>resistivity</em>, ${inline(sup(abs(x), nm1))}, that
      grows steeply with the current.</p>`,
    details: `
      ${block(mi('f'), par(x), mo('='), sup(abs(x), nm1), x, mo('+'), lambda, x, mo('&#x2212;'), b, mo('='), mn('0'))}
      <p>It is the equation of a superconducting ring (nonlinear resistance in series with an inductance) after
      time discretization, solved for the current, with ${inline(n)} the exponent of the power law and
      ${inline(lambda)} a scaling parameter.</p>
      <p>A point ${inline(mi('x̃'))} with ${inline(Phix(Phix(mi('x̃'))), mo('='), mi('x̃'))} but
      ${inline(Phix(mi('x̃')), mo('&#x2260;'), mi('x̃'))} is a fixed point of period 2. It attracts the iterates
      if ${inline(abs(row(par(Phi, mo('&#x2218;'), Phi), mo('&#x2032;'), par(mi('x̃')))), mo('&lt;'), mn('1'))}.</p>
      ${ref('Section 2.7.3')}`,
  },
  {
    title: 'Mapping where a method converges',
    setup: { problem: 'power-h', method: 'picard', rhs: 1.1, x0: 0.5 },
    body: `
      <p>The <strong>convergence map</strong> repeats the experiment for many initial guesses
      ${inline(sub(x, mn('0')))} (horizontal) and right-hand sides ${inline(b)} (vertical), and colors each run by
      the number of iterations it needed. Hatched regions are failures. The black curve is the exact solution.
      Click or drag on the map to pick a run.</p>
      <p>With Picard, the method fails almost everywhere once ${inline(abs(b))} exceeds about 1, except for a few
      lucky starting points. Now switch to <strong>Newton–Raphson</strong>: it converges everywhere on this map,
      in a few iterations when ${inline(sub(x, mn('0')))} is close to the solution.</p>
      <p>Try the exponent ${inline(n)} in the bar: the larger it is, the steeper the law,
      and the more iterations Newton–Raphson needs from far away.</p>`,
    details: `
      <p>Each cell is one run, stopped when ${inline(abs(mi('f'), par(xi)), mo('&lt;'), sup(mn('10'), row(mo('&#x2212;'), mn('8'))))}
      or after 300 iterations. Failures are sorted into cycles of period 2, divergence, and other cases (slow
      convergence or longer cycles); hover the map to see which. The maps of the thesis are reproduced exactly
      by this JavaScript version.</p>
      ${ref('Section 2.7.3')}`,
  },
  {
    title: 'Change the formulation: the roles swap',
    setup: { problem: 'power-a', method: 'newton', rhs: 0.6, x0: 0.002, zoom: true },
    body: `
      <p>The same superconductor can be modelled with the <strong>a-formulation</strong>. The unknown is then
      like an electric field, and the nonlinearity becomes a <em>conductivity</em>: the inverse of the
      power law. Its curve is extremely steep around zero (top-left plot, zoomed on the iterates).</p>
      <p>Now Newton–Raphson fails: the tangent at a point near zero is almost vertical, the next iterate lands
      far away on the flat part, whose tangent sends it back across zero, and the iterates end up cycling.
      The map shows large failed regions for ${inline(abs(c))} below about 1.</p>
      <p>Switch to <strong>Picard</strong>: it converges everywhere on the map. The difficulty did not
      disappear, it moved from one method to the other.</p>`,
    details: `
      ${block(mi('g'), par(x), mo('='), frac(x, row(eps, mo('+'), sup(abs(x), row(par(nm1), mo('/'), n)))), mo('+'), frac(x, lambda), mo('&#x2212;'), c, mo('='), mn('0'))}
      <p>The slope of the unregularized law is infinite at ${inline(x, mo('='), mn('0'))}; the small parameter
      ${inline(eps)} (default ${inline(sup(mn('10'), row(mo('&#x2212;'), mn('5'))))}) keeps it finite, equal to
      ${inline(mn('1'), mo('/'), eps)}. In the finite element model, it corresponds to a small conductivity cap,
      needed for the same reason.</p>
      ${ref('Section 2.7.3')}`,
  },
  {
    title: 'Picard: robust, but slow',
    setup: { problem: 'power-a', method: 'picard', rhs: 0.9, x0: 0.1 },
    body: `
      <p>Picard converges from any starting point for this equation, but it needs a lot of iterations (150 here),
      almost independently of ${inline(sub(x, mn('0')))}: look at the vertical bands in the map. Most of them are
      spent close to the solution, where the slope ${inline(abs(Phip(xbar)))} is just below 1: each
      iteration only removes a small fraction of the error (see the straight line in the residual plot, the
      signature of linear convergence).</p>
      <p>Tick <strong>Aitken acceleration</strong>: extrapolating from the last three iterates roughly halves the
      number of iterations over the whole map.</p>`,
    details: `
      <p>Aitken's delta-squared process builds, from the Picard iterates, the sequence</p>
      ${block(sub(x, row(mi('A'), mo(','), mi('i'))), mo('='), sub(x, mi('i')), mo('&#x2212;'), frac(sup(par(sub(x, row(mi('i'), mo('+'), mn('1'))), mo('&#x2212;'), sub(x, mi('i'))), mn('2')), row(sub(x, row(mi('i'), mo('+'), mn('2'))), mo('&#x2212;'), mn('2'), sub(x, row(mi('i'), mo('+'), mn('1'))), mo('+'), sub(x, mi('i')))))}
      <p>which converges faster when the iterates approach the solution geometrically. The residual is checked on
      the extrapolated values (purple in the residual plot).</p>
      ${ref('Section 2.7.3')}`,
  },
  {
    title: 'Remedies for Newton–Raphson: hybrid and relaxation',
    setup: { problem: 'power-a', method: 'hybrid', iSwitch: 10, rhs: 0.9, x0: 0.2 },
    body: `
      <p>Two classical ideas. <strong>Hybrid</strong>: start with a few robust Picard iterations to approach the
      solution, then switch to Newton–Raphson for fast final convergence. Here, 10 Picard iterations and then 3
      Newton–Raphson ones. But on the map, cycles remain: the region where Newton–Raphson works is so thin around
      the solution that 10 Picard iterations are often not enough to reach it.</p>
      <p><strong>Relaxation</strong>: take only a fraction ${inline(gamma)} of each Newton–Raphson step. Choose the
      Newton–Raphson method and set ${inline(gamma, mo('='), mn('0.5'))}: the converged region grows, but many
      points still cycle, and runs that converged before now need many more iterations.</p>`,
    details: `
      ${block(xi1, mo('='), xi, mo('+'), gamma, par(sub(mi('x̃'), row(mi('i'), mo('+'), mn('1'))), mo('&#x2212;'), xi))}
      <p>with ${inline(sub(mi('x̃'), row(mi('i'), mo('+'), mn('1'))))} the unrelaxed iterate. In the explorer, the
      relaxation applies to every method, including Picard (try it on the first equation).</p>
      ${ref('Section 2.7.3')}`,
  },
  {
    title: 'Ferromagnetic materials: the dual picture',
    setup: { problem: 'ferro-h', method: 'newton', rhs: 0.5, x0: 0.1 },
    body: `
      <p>Change the law to the <strong>saturation law</strong> of a soft ferromagnetic material. In the
      <strong>h-formulation</strong>, the nonlinearity is the <em>permeability</em> ${inline(mur)}: steep for
      small fields (relative permeability 1600 here), then flat once the material saturates, the same shape as the
      conductivity of the superconductor. And the same problem appears: Newton–Raphson cycles for
      ${inline(abs(c))} below about 1.</p>
      <p>Switch to the <strong>a-formulation</strong>, where the nonlinearity is the <em>reluctivity</em>
      ${inline(nur)}, the inverse law: Newton–Raphson converges everywhere, in a few iterations, while Picard fails.
      Exactly the opposite of the superconductor.</p>`,
    details: `
      ${block(bar(mi('g')), par(x), mo('='), mur, par(x), x, mo('&#x2212;'), c, mo(','), '<mspace width="1.5em"/>', mur, par(x), mo('='), mn('1'), mo('+'), sup(par(frac(mn('1'), row(sub(mi('&#x3BC;'), row(mi('r'), mo(','), mn('0'))), mo('&#x2212;'), mn('1'))), mo('+'), frac(abs(x), sub(mi('m'), mn('0')))), row(mo('&#x2212;'), mn('1'))))}
      <p>with ${inline(x)} the field ${inline(sub(mi('&#x3BC;'), mn('0')), mi('h'))} in tesla, and
      ${inline(sub(mi('m'), mn('0')))} the saturation magnetization (1.31 T). The a-formulation analogue uses the
      analytical inverse of this law, ${inline(nur, par(x), x, mo('&#x2212;'), b)} with ${inline(x)} the flux density in tesla.</p>
      ${ref('Sections 2.7.2 and 2.7.4')}`,
  },
  {
    title: 'Hybrid iterations for the ferromagnet',
    setup: { problem: 'ferro-h', method: 'hybrid', iSwitch: 5, rhs: 0.5, x0: 0.1 },
    body: `
      <p>For the ferromagnet in the h-formulation, the hybrid method works much better than for the superconductor:
      5 Picard iterations are enough to bring most starting points into the region where Newton–Raphson converges.
      The initial slope of the law, ${inline(mn('1600'))}, is steep but far less than the
      ${inline(mn('1'), mo('/'), eps, mo('='), sup(mn('10'), mn('5')))} of the regularized power law, so that region is
      much wider.</p>
      <p>Compare with ${inline(sub(mi('i'), tx('switch')), mo('='), mn('10'))} and with the plain methods. Changing
      the initial permeability ${inline(sub(mi('&#x3BC;'), row(mi('r'), mo(','), mn('0'))))} in the bar
      also shows how the difficulty grows with the steepness of the law.</p>`,
    details: `
      <p>Choosing ${inline(sub(mi('i'), tx('switch')))} is a trade-off between robustness (more Picard iterations)
      and speed (earlier switch to Newton–Raphson). In a time-stepping simulation, a good initial guess from the
      previous time step makes the hybrid approach worth it.</p>
      ${ref('Section 2.7.4')}`,
  },
  {
    title: 'Takeaway: pick the formulation that suits the material',
    setup: { problem: 'ferro-a', method: 'newton', rhs: 0.1, x0: 0.5 },
    body: `
      <p>A nonlinear law that is <strong>steep then flat</strong> (conductivity of a superconductor, permeability of
      a ferromagnet) is hard for Newton–Raphson, and Picard is robust but slow. Written the other way round,
      <strong>flat then steep</strong> (resistivity, reluctivity), Newton–Raphson is fast and robust. These
      single-number equations behave like full 1D, 2D and 3D finite element models.</p>
      <p>Hence the recommendation: the h-formulation for superconductors, the a-formulation for ferromagnets. When
      both materials are in the same device, <em>mixed formulations</em> use each law in its best form, which is the
      subject of the next chapter of the thesis.</p>`,
    details: `
      <p>In finite element models, more difficulties appear with the number of unknowns: even Newton–Raphson on the
      h-formulation needs small enough time steps to follow the penetration of the magnetic flux, so that each
      initial guess stays close to the solution.</p>
      ${ref('Section 2.8')}`,
  },
];
