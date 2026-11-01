// mulberry32 seeded PRNG. Ported verbatim (algorithm) from IsoKron
// apps/isokron-cli/src/eval/rng.ts so a seed produces the same stream there and here.
export function mulberry32(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    pick(items) { if (!items.length) throw new Error('rng.pick: empty'); return items[Math.floor(next() * items.length)]; },
    shuffle(items) { const a = items.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    hex(n) { let o = ''; for (let i = 0; i < n; i++) o += '0123456789abcdef'[Math.floor(next() * 16)]; return o; },
    alnum(n, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') { let o = ''; for (let i = 0; i < n; i++) o += alphabet[Math.floor(next() * alphabet.length)]; return o; },
  };
}
