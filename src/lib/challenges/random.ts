/**
 * Deterministic pseudo-random selection.
 *
 * The day's challenge must not re-roll on a page refresh. It is persisted the
 * moment it is chosen, so the database is the real guarantee — but seeding the
 * RNG from the user and date means the *same* answer comes out even if the
 * write races or is replayed, and it makes the selector testable without a
 * database.
 *
 * cyrb128 + mulberry32: small, fast, well-distributed, no dependency. Not
 * cryptographic, and does not need to be — the worst case for a predictable
 * outcome here is that someone works out tomorrow's act of kindness early.
 */

/** Hash a string to four 32-bit seeds. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** Seeded generator returning floats in [0, 1). */
export function createRng(seed: string): () => number {
  const [a] = cyrb128(seed);
  let t = a;

  return function next(): number {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted pick from a list, using a supplied RNG.
 *
 * Items with weight <= 0 are treated as weight 1 rather than silently dropped —
 * a zero weight in the database is far more likely to be a mistake than an
 * intent to disable, and `active` already exists for disabling.
 */
export function weightedPick<T extends { weight: number }>(
  items: T[],
  rng: () => number,
): T | null {
  if (items.length === 0) return null;

  const weights = items.map((item) =>
    Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1,
  );
  const total = weights.reduce((sum, w) => sum + w, 0);

  let threshold = rng() * total;
  for (let i = 0; i < items.length; i++) {
    threshold -= weights[i];
    if (threshold < 0) return items[i];
  }

  // Floating-point drift can leave threshold marginally >= 0 on the last item.
  return items[items.length - 1];
}
