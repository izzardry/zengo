import { describe, expect, it } from 'vitest';
import { ownEyes, rankPick, rankSampleSize, rankedMoves, seededRng, temperaturePick } from './strategy';

const AREA = 81;

/** A 9×9 policy: `entries` as [index, prob]; the rest of the mass spread thinly over the other points. */
function policy(entries: [number, number][], pass = 0): Float32Array {
  const p = new Float32Array(AREA + 1);
  const used = entries.reduce((s, [, v]) => s + v, 0) + pass;
  const others = AREA - entries.length;
  for (let i = 0; i < AREA; i++) p[i] = (1 - used) / others;
  for (const [i, v] of entries) p[i] = v;
  p[AREA] = pass;
  return p;
}

describe('rankSampleSize (KaTrain calibrated rank)', () => {
  it('samples more moves for stronger ranks', () => {
    const weak = rankSampleSize(22, 361, 361);
    const mid = rankSampleSize(12, 361, 361);
    const strong = rankSampleSize(3, 361, 361);
    expect(weak).toBeGreaterThanOrEqual(1);
    expect(weak).toBeLessThan(mid);
    expect(mid).toBeLessThan(strong);
  });

  it('never samples fewer than one move', () => {
    expect(rankSampleSize(30, 2, 81)).toBe(1);
  });
});

describe('rankPick', () => {
  it('plays a dominating top move', () => {
    const p = policy([[40, 0.9]]);
    for (let s = 0; s < 20; s++) expect(rankPick(p, AREA, 18, seededRng(s))).toBe(40);
  });

  it('plays the top move when pass is among the top five', () => {
    const p = policy([[10, 0.3], [11, 0.2]], 0.15);
    expect(rankPick(p, AREA, 18, seededRng(1))).toBe(10);
  });

  it('is reproducible with a seed and stays within the legal moves', () => {
    const p = policy([[10, 0.2], [20, 0.15], [30, 0.1]]);
    p[5] = 0; // illegal
    const a = rankPick(p, AREA, 12, seededRng(9));
    expect(rankPick(p, AREA, 12, seededRng(9))).toBe(a);
    const seen = new Set<number>();
    for (let s = 0; s < 200; s++) seen.add(rankPick(p, AREA, 22, seededRng(s)));
    expect(seen.has(5)).toBe(false);
    expect(seen.size).toBeGreaterThan(3);
  });

  it('never picks an excluded point', () => {
    const p = policy([[10, 0.2], [20, 0.15], [30, 0.1]]);
    const ex = new Uint8Array(AREA);
    ex[10] = 1;
    ex[20] = 1;
    for (let s = 0; s < 100; s++) {
      const m = rankPick(p, AREA, 6, seededRng(s), ex);
      expect(m === 10 || m === 20).toBe(false);
    }
  });
});

describe('temperaturePick', () => {
  it('plays the top move at temperature 0', () => {
    const p = policy([[10, 0.3], [20, 0.2]]);
    expect(temperaturePick(p, AREA, 0, seededRng(1))).toBe(10);
  });

  it('passes when pass is the top move', () => {
    const p = policy([[10, 0.2]], 0.6);
    expect(temperaturePick(p, AREA, 2, seededRng(1))).toBe(AREA);
  });

  it('spreads the choice at a high temperature and respects exclusions', () => {
    const p = policy([[10, 0.3], [20, 0.2]]);
    const ex = new Uint8Array(AREA);
    ex[10] = 1;
    const seen = new Set<number>();
    for (let s = 0; s < 300; s++) seen.add(temperaturePick(p, AREA, 2, seededRng(s), ex));
    expect(seen.has(10)).toBe(false);
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('rankedMoves and ownEyes', () => {
  it('lists legal moves best first', () => {
    const p = policy([[3, 0.5]], 0.1);
    const r = rankedMoves(p, AREA);
    expect(r[0].index).toBe(3);
    expect(r.some((m) => m.index === AREA)).toBe(true);
  });

  it('finds one-point eyes of a color, edges included', () => {
    const size = 9;
    const stones = new Uint8Array(size * size);
    stones[1] = 1; // b1 ... a corner eye at index 0 needs (1,0) and (0,1)
    stones[size] = 1;
    stones[size * 4 + 3] = 2;
    const eyes = ownEyes(stones, size, 1);
    expect(eyes[0]).toBe(1);
    expect(eyes[2]).toBe(0);
    expect(ownEyes(stones, size, 2)[0]).toBe(0);
  });
});
