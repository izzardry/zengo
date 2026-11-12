import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVEL, LARGE_NET_FROM, LEVELS, MAX_LEVEL, MIN_LEVEL, MIN_REPLY_MS, levelSpec, needsLargeNet, normalizeLevel } from './levels';

describe('level table (DESIGN 10.2)', () => {
  it('has twelve levels with the design values', () => {
    expect(LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(LEVELS.map((l) => l.name)).toEqual([
      'Beginner', 'Novice', 'Easy', 'Casual', 'Medium', 'Moderate',
      'Tricky', 'Hard', 'Tough', 'Expert', 'Master', 'Insane',
    ]);
    expect(LEVELS.map((l) => l.target)).toEqual(['30k', '22k', '18k', '15k', '12k', '9k', '6k', '3k', '1k', '2d', '4d', '5d']);
    expect(LEVELS.map((l) => l.method)).toEqual([
      'humanized', 'rank', 'rank', 'rank', 'rank', 'rank', 'rank', 'rank', 'policy', 'search', 'search', 'search',
    ]);
    expect(LEVELS.filter((l) => l.method === 'rank').map((l) => l.rank)).toEqual([22, 18, 15, 12, 9, 6, 3]);
    expect(LEVELS[9].visits).toEqual([16, 32]);
    expect(LEVELS[10].visits).toEqual([64, 200]);
    expect(LEVELS[11].timeMs).toBe(3000);
    expect(LEVELS[11].clockFraction).toBeCloseTo(1 / 30);
    expect(DEFAULT_LEVEL).toBe(5);
    expect(MIN_REPLY_MS).toBe(400);
    expect([MIN_LEVEL, MAX_LEVEL]).toEqual([1, 12]);
  });

  it('levels 1–7 use the small net, 8–12 the large one', () => {
    expect(LARGE_NET_FROM).toBe(8);
    expect(LEVELS.map((l) => l.net)).toEqual([...Array(7).fill('small'), ...Array(5).fill('large')]);
    expect(needsLargeNet(7)).toBe(false);
    expect(needsLargeNet(8)).toBe(true);
    expect(needsLargeNet(99)).toBe(true);
  });

  it('normalizes levels', () => {
    expect(normalizeLevel(0)).toBe(1);
    expect(normalizeLevel(99)).toBe(12);
    expect(normalizeLevel(4.6)).toBe(5);
    expect(normalizeLevel(NaN)).toBe(DEFAULT_LEVEL);
    expect(levelSpec(-3).level).toBe(1);
  });
});
