// Shared helpers: paths, seeded RNG, stats, small fs/process utilities.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(TB, '..');
export const RESULTS = process.env.TRACKB_RESULTS || path.join(ROOT, 'results', 'track-b');

export const BIN = {
  kronicle: path.join(TB, 'node_modules', 'kronicle-lite', 'dist', 'cli.js'),
  sea: path.join(TB, 'vendor', 'sea-lite', 'dist', 'cli.js'),
  ccAnchor: path.join(TB, 'vendor', 'cc-anchor'),
  bd: path.join(TB, 'node_modules', '.bin', 'bd'),
  bm: path.join(TB, '.venv', 'bin', 'basic-memory'),
  fastembedCache: path.join(TB, 'vendor', 'fastembed_cache'),
  stub: path.join(TB, 'lib', 'stub.mjs'),
};

// mulberry32 — same PRNG IsoKron's eval harness uses (apps/isokron-cli/src/eval/rng.ts).
export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    pickDistinct(arr, k) {
      const pool = [...arr]; const out = [];
      while (out.length < k) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
      return out;
    },
  };
}

// Wilson score interval (95%).
export function wilson(k, n, z = 1.959964) {
  if (!n) return [NaN, NaN];
  const p = k / n, z2 = z * z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// log-gamma / regularized incomplete beta for Clopper-Pearson exact interval.
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m; let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function ibeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function betaInv(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (ibeta(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export function clopperPearson(k, n, alpha = 0.05) {
  if (!n) return [NaN, NaN];
  const lo = k === 0 ? 0 : betaInv(alpha / 2, k, n - k + 1);
  const hi = k === n ? 1 : betaInv(1 - alpha / 2, k + 1, n - k);
  return [lo, hi];
}

// Fisher exact two-sided p for a 2x2 table [[a,b],[c,d]].
export function fisher(a, b, c, d) {
  const n = a + b + c + d, r1 = a + b, c1 = a + c;
  const lf = (x) => lgamma(x + 1);
  const p = (x) => Math.exp(lf(r1) + lf(n - r1) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(n - r1 - c1 + x));
  const p0 = p(a); let s = 0;
  for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x++) { const px = p(x); if (px <= p0 * (1 + 1e-7)) s += px; }
  return Math.min(1, s);
}

export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
export function shTry(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
export function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}
export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
export function copyDir(src, dst) { fs.cpSync(src, dst, { recursive: true }); }
