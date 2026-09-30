// Single degree of freedom analogues of the nonlinear finite element problems of Section 2.7 of
// J. Dular, PhD thesis (University of Liège, 2023), and the iterative methods applied to them.
// JavaScript port of fixedPointNewton.m.
//
// Every problem has the form L(x) = A(x) x = r, with L increasing, A(x) the secant coefficient
// (resistivity-, conductivity-, permeability- or reluctivity-like) and r the right-hand side.
//   power law,  h-formulation:  f(x) = |x|^(n-1) x + λ x - b
//   power law,  a-formulation:  g(x) = x / (ε + |x|^((n-1)/n)) + x / λ - c
//   saturation, h-formulation:  ḡ(x) = μr(x) x - c      (x = μ0 h, in T)
//   saturation, a-formulation:  f̄(x) = νr(x) x - b      (x = b, in T)

const MU0 = 4e-7 * Math.PI;
export const M0_DEFAULT = 1.04e6 * MU0; // saturation magnetization of fixedPointNewton.m (≈ 1.307 T)

// Default parameters and the (x0, r) windows of the thesis maps
export const DEFAULTS = { n: 20, lambda: 1, eps: 1e-5, mur0: 1600 };

export const PROBLEMS = {
  'power-h': { law: 'power', form: 'h', fn: 'f', rhs: 'b', x0Range: [-2, 2], rhsRange: [-3, 3] },
  'power-a': { law: 'power', form: 'a', fn: 'g', rhs: 'c', x0Range: [-0.3, 0.3], rhsRange: [-2, 2] },
  'ferro-h': { law: 'ferro', form: 'h', fn: 'ḡ', rhs: 'c', x0Range: [-0.3, 0.3], rhsRange: [-2, 2] },
  'ferro-a': { law: 'ferro', form: 'a', fn: 'f̄', rhs: 'b', x0Range: [-2, 2], rhsRange: [-0.3, 0.3] },
};

// Returns { A, L, dL } for a problem key and parameters { n, lambda, eps, mur0, m0 }.
export function makeLaw(key, params = {}) {
  const { n, lambda, eps, mur0, m0 = M0_DEFAULT } = { ...DEFAULTS, ...params };
  switch (key) {
    case 'power-h': {
      const A = (x) => Math.abs(x) ** (n - 1) + lambda;
      return { A, L: (x) => A(x) * x, dL: (x) => n * Math.abs(x) ** (n - 1) + lambda };
    }
    case 'power-a': {
      const p = (n - 1) / n;
      const A = (x) => 1 / (eps + Math.abs(x) ** p) + 1 / lambda;
      const dL = (x) => {
        const ap = Math.abs(x) ** p;
        const d = eps + ap;
        return 1 / d - (p * ap) / (d * d) + 1 / lambda;
      };
      return { A, L: (x) => A(x) * x, dL };
    }
    case 'ferro-h': {
      const k = 1 / (mur0 - 1);
      const A = (x) => 1 + 1 / (k + Math.abs(x) / m0);
      const dL = (x) => {
        const u = k + Math.abs(x) / m0;
        return A(x) - Math.abs(x) / (m0 * u * u);
      };
      return { A, L: (x) => A(x) * x, dL };
    }
    case 'ferro-a': {
      // Analytical inverse of the law above: νr(b) = 1 / μr(h(b)). Written without cancellation on
      // both sides of |b| = K.
      const K = (mur0 * m0) / (mur0 - 1);
      const q = (4 * m0) / (mur0 - 1);
      const A = (x) => {
        const ab = Math.abs(x);
        const s = Math.sqrt((K - ab) ** 2 + q * ab);
        if (ab < K) return q / (2 * (s + K - ab));
        return (ab - K + s) / (2 * ab);
      };
      const k = 1 / (mur0 - 1);
      const dLh = (h) => {
        const u = k + Math.abs(h) / m0;
        return 1 + 1 / u - Math.abs(h) / (m0 * u * u);
      };
      const L = (x) => A(x) * x;
      return { A, L, dL: (x) => 1 / dLh(L(x)) };
    }
    default:
      throw new Error('Unknown problem ' + key);
  }
}

// Exact solution of L(x) = r by bisection (L is increasing).
export function solve(law, r) {
  if (r === 0) return 0;
  let lo = 0;
  let hi = Math.sign(r);
  while ((law.L(hi) - r) * Math.sign(r) < 0) hi *= 2;
  if (hi < lo) [lo, hi] = [hi, lo];
  for (let k = 0; k < 200; k++) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    if (law.L(mid) < r) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export const METHODS = {
  picard: 'Picard',
  newton: 'Newton–Raphson',
  hybrid: 'Hybrid (Picard, then Newton–Raphson)',
  secant: 'Secant (quasi-Newton)',
};

// One unrelaxed step of each basic method
export const picardStep = (law, x, r) => r / law.A(x);
export const newtonStep = (law, x, r) => x - (law.L(x) - r) / law.dL(x);
export const secantStep = (law, x, xPrev, r) => {
  const fx = law.L(x) - r;
  const fp = law.L(xPrev) - r;
  return fx === fp ? x : x - (fx * (x - xPrev)) / (fx - fp);
};

// Which basic method gives iterate i (1-based) of a method
export function stepKind(method, i, iSwitch) {
  if (method === 'hybrid') return i <= iSwitch ? 'picard' : 'newton';
  if (method === 'secant') return i === 1 ? 'newton' : 'secant';
  return method;
}

// opts: { method, gamma (relaxation), iSwitch (hybrid), aitken (Picard only), tol, iMax }
export const ITER_DEFAULTS = { method: 'newton', gamma: 1, iSwitch: 5, aitken: false, tol: 1e-8, iMax: 300 };

const DIVERGED = 1e12;

// Status of a run that did not converge, from its last iterates
function failureKind(x, xm1, xm2) {
  if (!Number.isFinite(x) || Math.abs(x) > DIVERGED) return 'diverged';
  const scale = Math.abs(x) + Math.abs(xm1) + 1e-300;
  if (Math.abs(x - xm2) < 1e-6 * scale && Math.abs(x - xm1) > 1e-4 * scale) return 'cycle';
  return 'stalled';
}

// Iterates from x0 until |L(x_i) - r| < tol (i >= 1) or i = iMax.
// Returns { iterations, status: 'converged' | 'cycle' | 'diverged' | 'stalled', x } and, with
// record = true, the arrays xs (x_0 ... x_i), res (|L(x_k) - r|), kinds and, with Aitken, xa and resA.
export function iterate(law, x0, r, options = {}, record = false) {
  const { method, gamma, iSwitch, aitken, tol, iMax } = { ...ITER_DEFAULTS, ...options };
  const useAitken = aitken && method === 'picard';
  let x = x0;
  let xm1 = NaN;
  let xm2 = NaN;
  const xs = record ? [x0] : null;
  const res = record ? [Math.abs(law.L(x0) - r)] : null;
  const kinds = record ? [null] : null;
  const xa = record && useAitken ? [NaN] : null;
  const resA = record && useAitken ? [NaN] : null;
  let xOut = x;
  for (let i = 1; i <= iMax; i++) {
    const kind = stepKind(method, i, iSwitch);
    const full = kind === 'picard' ? picardStep(law, x, r) : kind === 'newton' ? newtonStep(law, x, r) : secantStep(law, x, xm1, r);
    xm2 = xm1;
    xm1 = x;
    x = xm1 + gamma * (full - xm1);
    let err;
    xOut = x;
    if (useAitken && i >= 2) {
      const d2 = x - 2 * xm1 + xm2;
      const ax = d2 === 0 ? x : xm2 - ((xm1 - xm2) ** 2) / d2;
      err = Math.abs(law.L(ax) - r);
      xOut = ax;
      if (record) {
        xa.push(ax);
        resA.push(err);
      }
    } else {
      err = Math.abs(law.L(x) - r);
      if (record && useAitken) {
        xa.push(NaN);
        resA.push(NaN);
      }
    }
    if (record) {
      xs.push(x);
      res.push(Math.abs(law.L(x) - r));
      kinds.push(kind);
    }
    if (err < tol) return { iterations: i, status: 'converged', x: xOut, xs, res, kinds, xa, resA };
    if (!Number.isFinite(x)) return { iterations: i, status: 'diverged', x, xs, res, kinds, xa, resA };
  }
  return { iterations: iMax, status: failureKind(x, xm1, xm2), x: xOut, xs, res, kinds, xa, resA };
}

// Iteration count over a grid of initial iterates x0 (columns) and right-hand sides r (rows).
// Returns Int16Array counts (row-major, r index first), negative codes for failures:
// -1 cycle of period 2, -2 diverged, -3 other (no convergence within iMax).
export const FAIL = { cycle: -1, diverged: -2, stalled: -3 };

export function convergenceMap(law, x0s, rs, options = {}) {
  const out = new Int16Array(x0s.length * rs.length);
  for (let j = 0; j < rs.length; j++) {
    for (let i = 0; i < x0s.length; i++) {
      const run = iterate(law, x0s[i], rs[j], options);
      out[j * x0s.length + i] = run.status === 'converged' ? run.iterations : FAIL[run.status];
    }
  }
  return out;
}

// Centers of m equal cells over [a, b] (cells tile the map; with m even, x0 = 0 is not sampled)
export function grid(a, b, m) {
  const h = (b - a) / m;
  return Float64Array.from({ length: m }, (_, k) => a + (k + 0.5) * h);
}

// Iteration function Φ(x) of a basic method, relaxed
export function iterationFunction(law, kind, r, gamma = 1) {
  const step = kind === 'picard' ? (x) => picardStep(law, x, r) : (x) => newtonStep(law, x, r);
  return (x) => x + gamma * (step(x) - x);
}
