// MathML helpers and the equations shown by the explorer (notation of the thesis, Section 2.7).
// All strings are static and authored here (they are inserted as HTML).

export const mi = (s) => `<mi>${s}</mi>`;
export const mo = (s) => `<mo>${s}</mo>`;
export const mn = (s) => `<mn>${s}</mn>`;
export const tx = (s) => `<mtext>${s}</mtext>`;
export const row = (...xs) => `<mrow>${xs.join('')}</mrow>`;
export const sub = (base, s) => `<msub>${base}${s}</msub>`;
export const sup = (base, s) => `<msup>${base}${s}</msup>`;
export const subsup = (base, s, p) => `<msubsup>${base}${s}${p}</msubsup>`;
export const frac = (a, b) => `<mfrac>${a}${b}</mfrac>`;
export const abs = (...x) => row(mo('|'), ...x, mo('|'));
export const par = (...x) => row(mo('('), ...x, mo(')'));
export const bar = (base) => `<mover accent="true">${base}<mo>&#xAF;</mo></mover>`;
export const tilde = (base) => `<mover accent="true">${base}<mo>~</mo></mover>`;
export const sp = '<mspace width="0.6em"/>';
export const block = (...xs) => `<math display="block">${xs.join('')}</math>`;
export const inline = (...xs) => `<math>${xs.join('')}</math>`;

export const x = mi('x');
export const xi = sub(x, mi('i'));
export const xi1 = sub(x, row(mi('i'), mo('+'), mn('1')));
export const xbar = bar(x);
export const n = mi('n');
export const lambda = mi('&#x3BB;');
export const eps = mi('&#x3B5;');
export const gamma = mi('&#x3B3;');
export const Phi = mi('&#x3A6;');
export const b = mi('b');
export const c = mi('c');
export const mur = sub(mi('&#x3BC;'), tx('r'));
export const nur = sub(mi('&#x3BD;'), tx('r'));
export const mur0 = sub(mi('&#x3BC;'), row(tx('r'), mo(','), mn('0')));
export const m0 = sub(mi('m'), mn('0'));
const nm1 = row(n, mo('&#x2212;'), mn('1'));

// Per problem: name of the function, its expression, the secant coefficient A(x) and the right-hand side
export const EQUATIONS = {
  'power-h': {
    fn: mi('f'),
    rhs: b,
    expr: row(sup(abs(x), nm1), x, mo('+'), lambda, x, mo('&#x2212;'), b),
    A: row(sup(abs(x), nm1), mo('+'), lambda),
  },
  'power-a': {
    fn: mi('g'),
    rhs: c,
    expr: row(frac(x, row(eps, mo('+'), sup(abs(x), row(par(nm1), mo('/'), n)))), mo('+'), frac(x, lambda), mo('&#x2212;'), c),
    A: row(frac(mn('1'), row(eps, mo('+'), sup(abs(x), row(par(nm1), mo('/'), n)))), mo('+'), frac(mn('1'), lambda)),
  },
  'ferro-h': {
    fn: bar(mi('g')),
    rhs: c,
    expr: row(mur, par(x), x, mo('&#x2212;'), c),
    A: row(mur, par(x), mo('='), mn('1'), mo('+'), sup(par(frac(mn('1'), row(mur0, mo('&#x2212;'), mn('1'))), mo('+'), frac(abs(x), m0)), row(mo('&#x2212;'), mn('1')))),
  },
  'ferro-a': {
    fn: bar(mi('f')),
    rhs: b,
    expr: row(nur, par(x), x, mo('&#x2212;'), b),
    A: row(nur, par(x), tx('&#x2003;(analytical inverse of the law of the h-formulation)')),
  },
};

// Iteration formulas, for a problem's function name fn, right-hand side rhs and coefficient name
export function iterationFormula(kind, eq) {
  const fx = (arg) => row(eq.fn, par(arg));
  const fpx = (arg) => row(eq.fn, mo('&#x2032;'), par(arg));
  if (kind === 'picard') return row(xi1, mo('='), frac(eq.rhs, row(mi('A'), par(xi))));
  if (kind === 'newton') return row(xi1, mo('='), xi, mo('&#x2212;'), frac(fx(xi), fpx(xi)));
  const xim1 = sub(x, row(mi('i'), mo('&#x2212;'), mn('1')));
  return row(xi1, mo('='), xi, mo('&#x2212;'), fx(xi), frac(row(xi, mo('&#x2212;'), xim1), row(fx(xi), mo('&#x2212;'), fx(xim1))));
}

export const relaxFormula = row(xi1, mo('='), xi, mo('+'), gamma, par(sub(tilde(x), row(mi('i'), mo('+'), mn('1'))), mo('&#x2212;'), xi));
