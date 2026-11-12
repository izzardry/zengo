/**
 * Move pickers on a network policy, the engine side of the level methods of DESIGN 10.2:
 * - `rankPick`: KaTrain's calibrated-rank strategy (`ai:p:rank`), ported from Web KaTrain's
 *   `store/gameStore.ts` (MIT, see ./LICENSE), which transcribes KaTrain's `katrain/core/ai.py`;
 * - `temperaturePick`: policy sampled at a temperature (level 1 high, level 9 low; 0 = the top move).
 *
 * Policies are size² + 1 long (index size² = pass), 0 for illegal points. Pure; randomness comes from
 * the `rng` passed in.
 */

export interface PolicyMove {
  readonly index: number;
  readonly prob: number;
}

/** The legal moves of a policy (prob > 0), best first; `exclude[i]` = 1 removes point `i` (never pass). */
export function rankedMoves(policy: ArrayLike<number>, area: number, exclude?: Uint8Array | null): PolicyMove[] {
  const out: PolicyMove[] = [];
  for (let i = 0; i <= area; i++) {
    const p = policy[i];
    if (!(p > 0)) continue;
    if (i < area && exclude && exclude[i]) continue;
    out.push({ index: i, prob: p });
  }
  out.sort((a, b) => b.prob - a.prob || a.index - b.index);
  return out;
}

/** Uniform random subset of `n` items (KaTrain's weighted sample without replacement, all weights 1). */
function sampleWithoutReplacement<T>(items: readonly T[], n: number, rng: () => number): T[] {
  const keyed = items.map((item) => ({ key: Math.log(Math.max(1e-18, rng())), item }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.min(Math.max(0, n), keyed.length)).map((k) => k.item);
}

/** How many moves KaTrain's rank strategy samples for `kyuRank` with `legalCount` legal moves on `area` points. */
export function rankSampleSize(kyuRank: number, legalCount: number, area: number): number {
  const normLegMoves = legalCount / area;
  const origCalibAveModRank = 0.063015 + (0.7624 * area) / Math.pow(10, -0.05737 * kyuRank + 1.9482);
  const exponentTerm = 3.002 * normLegMoves * normLegMoves - normLegMoves - 0.034889 * kyuRank - 0.5097;
  const modifiedCalibAveModRank =
    (0.3931 + 0.6559 * normLegMoves * Math.exp(-1 * exponentTerm * exponentTerm) - 0.01093 * kyuRank) * origCalibAveModRank;
  const denominator = 1.31165 * (modifiedCalibAveModRank + 1) - 0.082653;
  return Math.max(1, Math.round((area * normLegMoves) / denominator));
}

/**
 * KaTrain's calibrated-rank pick: play the top policy move when pass is among the top five or the
 * top move (or the top two) dominate; otherwise sample `rankSampleSize` legal moves uniformly and play
 * the one with the highest policy, unless pass outweighs it. Returns a policy index (size² = pass).
 */
export function rankPick(policy: ArrayLike<number>, area: number, kyuRank: number, rng: () => number, exclude?: Uint8Array | null): number {
  const moves = rankedMoves(policy, area, exclude);
  if (moves.length === 0) return area;
  const top = moves[0];
  const passProb = policy[area] > 0 ? policy[area] : -1;
  if (moves.slice(0, 5).some((m) => m.index === area)) return top.index;

  const legal = moves.filter((m) => m.index !== area);
  if (legal.length === 0) return area;
  const ratio = (area - legal.length) / area;
  const override = 0.8 * (1 - 0.5 * ratio);
  const overridetwo = 0.85 + Math.max(0, 0.02 * (kyuRank - 8));
  if (top.prob > override) return top.index;
  if (moves[1] && top.prob + moves[1].prob > overridetwo) return top.index;

  const n = rankSampleSize(kyuRank, legal.length, area);
  const sampled = sampleWithoutReplacement(legal, n, rng);
  sampled.sort((a, b) => b.prob - a.prob);
  const picked = sampled[0];
  if (!picked) return top.index;
  if (passProb > picked.prob) return top.index;
  return picked.index;
}

/**
 * Samples a legal move with probability ∝ policy^(1/temperature). Temperature 0 plays the top move.
 * `exclude` removes points from the sample (never pass). When pass is the policy's top move, it is
 * played (`passWhenTop`, default true), so a sampled level still ends the game when nothing is left.
 */
export function temperaturePick(
  policy: ArrayLike<number>,
  area: number,
  temperature: number,
  rng: () => number,
  exclude?: Uint8Array | null,
  passWhenTop = true,
): number {
  const all = rankedMoves(policy, area, null);
  if (all.length === 0) return area;
  if (passWhenTop && all[0].index === area) return area;
  const moves = rankedMoves(policy, area, exclude).filter((m) => m.index !== area);
  if (moves.length === 0) return area;
  if (!(temperature > 0)) return moves[0].index;
  const inv = 1 / temperature;
  const top = moves[0].prob;
  let sum = 0;
  const w = moves.map((m) => {
    const v = Math.pow(m.prob / top, inv);
    sum += v;
    return v;
  });
  let r = rng() * sum;
  for (let i = 0; i < moves.length; i++) {
    if (r < w[i]) return moves[i].index;
    r -= w[i];
  }
  return moves[moves.length - 1].index;
}

/** Points where `color` (1 Black, 2 White) would fill its own one-point eye: every neighbour on the board is its stone. */
export function ownEyes(stones: Uint8Array, size: number, color: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (stones[i] !== 0) continue;
    const x = i % size;
    const y = (i - x) / size;
    if (
      (x === 0 || stones[i - 1] === color) &&
      (x === size - 1 || stones[i + 1] === color) &&
      (y === 0 || stones[i - size] === color) &&
      (y === size - 1 || stones[i + size] === color)
    )
      out[i] = 1;
  }
  return out;
}

/** Seeded generator (mulberry32), 0 ≤ x < 1. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
