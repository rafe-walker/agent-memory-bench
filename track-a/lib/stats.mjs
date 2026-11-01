// Interval estimates for binomial rates and latency percentiles. No dependencies.
// Wilson score interval (95%) and exact Clopper-Pearson (95%) via the beta quantile.

export function wilson(k, n, z = 1.959963984540054) {
  if (n === 0) return { lo: null, hi: null };
  const p = k / n, z2 = z * z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

// Regularized incomplete beta via continued fraction (Numerical Recipes betacf).
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const tmp0 = x + 5.5; const tmp = tmp0 - (x + 0.5) * Math.log(tmp0); let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
export function ibeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (ibeta(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export function clopperPearson(k, n, alpha = 0.05) {
  if (n === 0) return { lo: null, hi: null };
  const lo = k === 0 ? 0 : betaQuantile(alpha / 2, k, n - k + 1);
  const hi = k === n ? 1 : betaQuantile(1 - alpha / 2, k + 1, n - k);
  return { lo, hi };
}
export function rate(k, n) {
  return { k, n, p: n ? k / n : null, wilson: wilson(k, n), exact: clopperPearson(k, n) };
}
export function percentile(xs, q) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1));
  return a[i];
}
export function latency(xs) {
  return { n: xs.length, p50: percentile(xs, 0.5), p95: percentile(xs, 0.95), max: xs.length ? Math.max(...xs) : null };
}
// Token estimate: ceil(chars/4). Claude's tokenizer differs; this is a stated proxy, used identically for every arm.
export const tokens = (bytes) => (bytes == null ? null : Math.ceil(bytes / 4));
