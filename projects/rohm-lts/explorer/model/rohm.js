// ROHM model: chains of S cells (rate-independent) and CS cells (rate-dependent).
// JavaScript port of ROHM_S_Chain.py and ROHM_CS_Chain.py. The Python code is the reference: the
// arithmetic follows it line by line, and web/check/ verifies that both give the same results.
// Reference: J. Dular, A. Verweij, M. Wozniak, Supercond. Sci. Technol. 38 035017 (2025).
//
// No DOM access here, so the module also runs in workers and in the command-line checks.

export const MU0 = 4e-7 * Math.PI;

const REL_TOL = 1e-5; // Iterations are needed because of the field-dependent parameters.
const ITER_MAX = 100; // Usually, it converges much faster than this.

// Same as numpy.interp: linear interpolation, constant extrapolation outside [xs[0], xs[n-1]].
export function interp(x, xs, ys) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const slope = (ys[lo + 1] - ys[lo]) / (xs[lo + 1] - xs[lo]);
  return slope * (x - xs[lo]) + ys[lo];
}

// Builds a chain from a preset of data/presets.json (fields in T and s) and the scalings of
// data/scalings.json. Parameters are converted to A/m, as in the Python classes.
export function makeChain(preset, scalings) {
  const chain = {
    N: preset.mu0_kappa.length,
    kappas: preset.mu0_kappa.map((k) => k / MU0),
    alphas: preset.alpha.slice(),
    bScaling: scalings.b,
    fkScaling: scalings.f_kappa,
    fcScaling: scalings.f_chi,
  };
  if (preset.tau_c) {
    chain.tausC = preset.tau_c.slice();
    chain.tausE = preset.tau_e.slice();
    chain.chis = preset.mu0_chi.map((c) => c / MU0);
  }
  return chain;
}

// An S chain seen as a CS chain without eddy and coupling currents (tau_c = tau_e = 0). Both give the
// same response (checked in web/check), which lets the loss-per-cycle functions handle S chains too.
export function asCS(chain) {
  if (chain.tausC) return chain;
  const zeros = new Array(chain.N).fill(0);
  return { ...chain, tausC: zeros, tausE: zeros, chis: zeros, fcScaling: chain.fkScaling };
}

function fkappaB(chain, b) {
  return interp(Math.abs(b), chain.bScaling, chain.fkScaling);
}

function fchiB(chain, b) {
  return interp(Math.abs(b), chain.bScaling, chain.fcScaling);
}

// Scaling functions f_kappa(b) and f_chi(b), e.g. to draw kappa_k(b) = f_kappa(b) * kappa_k at a given time.
export const kappaScale = (chain, b) => Math.max(fkappaB(chain, b), 0);
export const chiScale = (chain, b) => Math.max(fchiB(chain, b), 0);

function bMulticells(chain, hrev, i) {
  let b = 0;
  for (let k = 0; k < chain.N; k++) b += chain.alphas[k] * MU0 * hrev[k][i];
  return b;
}

function cells(N, nbSteps) {
  return Array.from({ length: N }, () => new Float64Array(nbSteps));
}

// Backward finite difference of mu0 * hrev_k, i.e. db_k/dt for each cell.
function dbdtCells(time, hrev) {
  const n = time.length;
  const dt = new Float64Array(n);
  dt[0] = time[0] + time[1]; // numpy.diff(time, prepend=-time[1])
  for (let i = 1; i < n; i++) dt[i] = time[i] - time[i - 1];
  return hrev.map((hk) => {
    const d = new Float64Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const cur = MU0 * hk[i];
      d[i] = (cur - prev) / dt[i];
      prev = cur;
    }
    return d;
  });
}

// Instantaneous power sum_k alpha_k * x_k * db_k/dt, averaged over consecutive steps
// (see Appendix B.2 of J. Dular's thesis). Returns an array of length nbSteps - 1.
function powerFrom(chain, x, dbdt) {
  const n = dbdt[0].length;
  const p = new Float64Array(n - 1);
  for (let k = 0; k < chain.N; k++) {
    const a = chain.alphas[k] * 0.5;
    const xk = x[k];
    const dk = dbdt[k];
    for (let i = 0; i < n - 1; i++) p[i] += a * (xk[i] * dk[i] + xk[i] * dk[i + 1]);
  }
  return p;
}

// Play operator: the heart of the model. hrev stays put while h is within kappa of it, and is
// dragged along otherwise.
function hrevVpm(h, hrevPrev, kappa) {
  if (Math.abs(h - hrevPrev) <= kappa) return hrevPrev;
  const dir = (h - hrevPrev) / Math.abs(h - hrevPrev);
  return h - kappa * dir;
}

// Chain of S cells, for an internal field h(t) (A/m). Returns b (T), the stored and dissipated
// powers (W/m^3, length nbSteps - 1) and the reversible field of each cell hrev[k][i] (A/m).
export function computeS(chain, time, h) {
  const nbSteps = h.length;
  const N = chain.N;
  const b = new Float64Array(nbSteps);
  const hrev = cells(N, nbSteps);
  const hirr = cells(N, nbSteps);
  let iterTot = 0;
  for (let i = 1; i < nbSteps; i++) {
    let fkappa = fkappaB(chain, b[i - 1]);
    b[i] = b[i - 1];
    let convCrit = 2;
    let iter = 0;
    while (convCrit > 1 && iter < ITER_MAX) {
      for (let k = 0; k < N; k++) {
        hrev[k][i] = hrevVpm(h[i], hrev[k][i - 1], fkappa * chain.kappas[k]);
        hirr[k][i] = h[i] - hrev[k][i];
      }
      const bNew = bMulticells(chain, hrev, i);
      convCrit = Math.abs((bNew - b[i]) / (b[i] + 1e-10)) / REL_TOL;
      b[i] = bNew;
      fkappa = fkappaB(chain, b[i]);
      iter++;
    }
    iterTot += iter;
  }
  const dbdt = dbdtCells(time, hrev);
  return {
    b,
    pRev: powerFrom(chain, hrev, dbdt),
    pIrr: powerFrom(chain, hirr, dbdt),
    hrev,
    hirr,
    iterPerStep: iterTot / nbSteps,
  };
}

// Chain of CS cells, for an internal field h(t) (A/m). Each cell splits h into
// h = hrev + heddy + hcoupling + hirr. Powers are in W/m^3 (length nbSteps - 1).
export function computeCS(chain, time, h) {
  const nbSteps = h.length;
  const N = chain.N;
  const b = new Float64Array(nbSteps);
  const hrev = cells(N, nbSteps);
  const hirr = cells(N, nbSteps);
  const hcoupling = cells(N, nbSteps);
  const heddy = cells(N, nbSteps);
  const g = cells(N, nbSteps); // g = hrev + heddy + hcoupling
  let iterTot = 0;
  for (let i = 1; i < nbSteps; i++) {
    const deltaT = time[i] - time[i - 1];
    let fkappa = Math.max(fkappaB(chain, Math.abs(b[i - 1])), 0);
    let fchi = Math.max(fchiB(chain, Math.abs(b[i - 1])), 0);
    b[i] = b[i - 1];
    let convCrit = 2;
    let iter = 0;
    // Iterations because of the field-dependent parameters which depend on the total flux density b
    while (convCrit > 1 && iter < ITER_MAX) {
      for (let k = 0; k < N; k++) {
        // Time constant ratios
        const aEc = (chain.tausE[k] + chain.tausC[k]) / deltaT;
        const aE = chain.tausE[k] / deltaT;
        const aC = chain.tausC[k] / deltaT;
        const hrevPrev = hrev[k][i - 1];
        const kappa = fkappa * chain.kappas[k];
        // Update of g = hrev + heddy + hcoupling
        const dir = h[i] - hrevPrev;
        const dirUnit = Math.abs(dir) !== 0 ? dir / Math.abs(dir) : 0;
        let gi;
        if (Math.abs(h[i] - g[k][i - 1]) >= kappa) gi = h[i] - kappa * dirUnit;
        else if (dir * (dir - kappa * dirUnit) > 0) gi = h[i] - kappa * dirUnit;
        else gi = hrevPrev;
        g[k][i] = gi;
        // Deduce hirr from g and h
        hirr[k][i] = h[i] - gi;
        // Check whether the coupling branch is saturated or not
        const chi = fchi * chain.chis[k];
        if (Math.abs((aC / (1 + aEc)) * (gi - hrevPrev)) < chi || Math.abs(chain.tausC[k]) < 1e-12) {
          hcoupling[k][i] = (aC / (1 + aEc)) * (gi - hrevPrev);
          heddy[k][i] = (aE / (1 + aEc)) * (gi - hrevPrev);
          hrev[k][i] = (gi + aEc * hrevPrev) / (1 + aEc);
        } else {
          const d = gi - hrevPrev;
          const dirC = d !== 0 ? d / Math.abs(d) : 0; // Python gives NaN for d = 0 (only possible if chi = 0)
          hcoupling[k][i] = chi * dirC;
          hrev[k][i] = (gi - hcoupling[k][i] + aE * hrevPrev) / (1 + aE);
          heddy[k][i] = (aE / (1 + aE)) * (gi - hcoupling[k][i] - hrevPrev);
        }
      }
      // Compute the magnetic flux density from hrev
      const bNew = bMulticells(chain, hrev, i);
      convCrit = Math.abs((bNew - b[i]) / (b[i] + 1e-10)) / REL_TOL;
      b[i] = bNew;
      fkappa = Math.max(fkappaB(chain, Math.abs(b[i])), 0);
      fchi = Math.max(fchiB(chain, Math.abs(b[i])), 0);
      iter++;
    }
    iterTot += iter;
  }
  // Power quantities
  const dbdt = dbdtCells(time, hrev);
  const n = nbSteps - 1;
  const pIrrC = new Float64Array(n);
  const pCoupling = new Float64Array(n);
  for (let k = 0; k < N; k++) {
    const tc = chain.tausC[k];
    if (!(Math.abs(tc) > 1e-12)) continue; // cells without coupling (tau_c = 0)
    const a = chain.alphas[k] * 0.5;
    const c = hcoupling[k];
    const dk = dbdt[k];
    for (let i = 0; i < n; i++) {
      pIrrC[i] += a * (c[i] * (dk[i] - (MU0 / tc) * c[i]) + c[i] * (dk[i + 1] - (MU0 / tc) * c[i + 1]));
      pCoupling[i] += a * (MU0 / tc) * (c[i] * c[i] + c[i] * c[i + 1]);
    }
  }
  return {
    b,
    pRev: powerFrom(chain, hrev, dbdt),
    pIrr: powerFrom(chain, hirr, dbdt), // hysteresis, uncoupled
    pIrrC, // hysteresis, coupled
    pCoupling,
    pEddy: powerFrom(chain, heddy, dbdt),
    hrev,
    hirr,
    hcoupling,
    heddy,
    iterPerStep: iterTot / nbSteps,
  };
}

function closestIndex(arr, val) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (Math.abs(arr[i] - val) < Math.abs(arr[best] - val)) best = i;
  }
  return best;
}

// Same as scipy.integrate.cumulative_trapezoid(y, x, initial=0).
function cumulativeTrapezoid(y, x) {
  const out = new Float64Array(y.length);
  for (let i = 1; i < y.length; i++) out[i] = out[i - 1] + ((x[i] - x[i - 1]) * (y[i] + y[i - 1])) / 2.0;
  return out;
}

// Energy per cycle (J/m^3) for a sine of frequency f (Hz) and amplitude hs (A/m). Two cycles are
// computed and the loss is integrated over the second one.
export function lossPerCycle(chain, f, hs, nbSteps = 600) {
  const time = new Float64Array(nbSteps);
  const h = new Float64Array(nbSteps);
  const tEnd = 2 / f;
  const step = tEnd / (nbSteps - 1);
  for (let i = 0; i < nbSteps; i++) {
    time[i] = i === nbSteps - 1 ? tEnd : i * step; // numpy.linspace
    h[i] = hs * Math.sin(2 * Math.PI * f * time[i]);
  }
  const r = computeCS(asCS(chain), time, h);
  const t1 = time.subarray(1);
  const xInit = closestIndex(time, 1 / f) - 1;
  const xStop = closestIndex(time, 2 / f) - 1;
  const q = (p) => {
    const cum = cumulativeTrapezoid(p, t1);
    return Math.max(1e-12, cum[xStop] - cum[xInit]);
  };
  return {
    qRev: q(r.pRev), // stored energy (should be around zero for a cycle)
    qIrr: q(r.pIrr), // hysteresis, uncoupled loss
    qIrrC: q(r.pIrrC), // hysteresis, coupled loss
    qCoupling: q(r.pCoupling),
    qEddy: q(r.pEddy),
  };
}

// Loss per cycle for a series of frequencies, for a given amplitude hs (A/m).
export function frequencySpan(chain, freqs, hs = 1 / MU0) {
  return freqs.map((f) => lossPerCycle(chain, f, hs));
}
