import { describe, expect, it } from 'vitest';
import type { Game, Point, Rules, Settings } from './types';
import scoringApi, { DEAD_THRESHOLD, formatTotals } from './scoring';
import { finalAreaScore, finalTerritoryScore, type GoscorerColor } from './vendor/goscorer';
import { fromDiagram, pass, play, pointToIndex, replay, makeSettings } from './zigo';

const { score, territory, toggle, propose, result } = scoringApi;

const settings = (rules: Rules, extra: Partial<Settings> = {}): Partial<Settings> => ({
  rules,
  komi2: rules === 'area' ? 15 : 13,
  ...extra,
});

/**
 * 9×9: black wall on column C, white wall on column E, column D dame. A dead white stone at A5
 * inside Black's side and a dead black stone at G5 inside White's side.
 */
const SPLIT9 = [
  '..x.o....',
  '..x.o....',
  '..x.o....',
  '..x.o....',
  'o.x.o.x..',
  '..x.o....',
  '..x.o....',
  '..x.o....',
  '..x.o....',
];
const SPLIT9_DEAD: Point[] = ['ae', 'ge'];

/**
 * 13×13 corner seki: the black stone at B13 and the white chain A12–C12 share the two liberties
 * A13 and C13 and nothing else; Black owns the rest of the board.
 */
const SEKI13 = [
  '.x.x.........',
  'ooox.........',
  'xxxx.........',
  ...Array(10).fill('.............'),
];

/** 19×19: black wall on column K (index 9), white wall on column L (index 10), no dame. */
const SPLIT19 = Array(19).fill(`${'.'.repeat(9)}xo${'.'.repeat(8)}`);

/** goscorer's own totals, for cross-checking the wrapper. */
function goscorerTotals(g: Game, dead: readonly Point[]): { black: number; white: number } {
  const size = g.settings.size;
  const stones: GoscorerColor[][] = [];
  const marked: boolean[][] = [];
  const set = new Set(dead.map((p) => pointToIndex(p, size)));
  for (let y = 0; y < size; y++) {
    stones.push([]);
    marked.push([]);
    for (let x = 0; x < size; x++) {
      stones[y].push(g.board[y * size + x] as GoscorerColor);
      marked[y].push(set.has(y * size + x) && g.board[y * size + x] !== 0);
    }
  }
  return g.settings.rules === 'area'
    ? finalAreaScore(stones, marked, 0)
    : finalTerritoryScore(stones, marked, g.prisoners.B, g.prisoners.W, 0);
}

describe('area scoring (DESIGN 8.2)', () => {
  it('counts stones plus surrounded points; dame and dead stones on 9×9', () => {
    const g = fromDiagram(SPLIT9, 'B', settings('area'));
    const s = score(g, SPLIT9_DEAD);
    expect(s.rules).toBe('area');
    expect(s.B).toEqual({ territory: 18, stones: 9, prisoners: 1 });
    expect(s.W).toEqual({ territory: 36, stones: 9, prisoners: 1 });
    expect(s.komi2).toBe(15);
    expect(s.compensation2).toBe(0);
    expect(s.total2).toEqual({ B: 54, W: 105 });
    expect(s.margin2).toBe(-51);
    expect(result(g, s)).toEqual({ winner: 'W', by: 'score', margin: 51 });
    expect(formatTotals(s)).toEqual({ B: '27', W: '52.5' });
  });

  it('without marks a stray stone makes the region around it neutral', () => {
    const g = fromDiagram(SPLIT9, 'B', settings('area'));
    const s = score(g, []);
    expect(s.B).toEqual({ territory: 0, stones: 10, prisoners: 0 });
    expect(s.W).toEqual({ territory: 0, stones: 10, prisoners: 0 });
    expect(s.margin2).toBe(20 - 35);
  });

  it('counts seki stones but not the shared liberties on 13×13', () => {
    const g = fromDiagram(SEKI13, 'B', settings('area'));
    const s = score(g, []);
    // Black: 7 stones + 157 empty points (169 − 7 black − 3 white − 2 shared liberties).
    expect(s.B).toEqual({ territory: 157, stones: 7, prisoners: 0 });
    expect(s.W).toEqual({ territory: 0, stones: 3, prisoners: 0 });
    expect(s.total2).toEqual({ B: 328, W: 6 + 15 });
    const t = territory(g, []);
    expect(t.aa).toBeNull();
    expect(t.ca).toBeNull();
    expect(t.mm).toBe('B');
  });

  it('counts a 19×19 board without dame', () => {
    const g = fromDiagram(SPLIT19, 'B', settings('area'));
    const s = score(g, []);
    expect(s.B).toEqual({ territory: 171, stones: 19, prisoners: 0 });
    expect(s.W).toEqual({ territory: 152, stones: 19, prisoners: 0 });
    expect(s.margin2).toBe(380 - (342 + 15));
    expect(result(g, s)).toEqual({ winner: 'B', by: 'score', margin: 23 });
  });

  it('gives White 1 point per handicap stone, with 0.5 komi', () => {
    const g = fromDiagram(SPLIT9, 'B', { rules: 'area', handicap: 3, komi2: 1 });
    const s = score(g, SPLIT9_DEAD);
    expect(s.komi2).toBe(1);
    expect(s.compensation2).toBe(6);
    expect(s.total2).toEqual({ B: 54, W: 90 + 1 + 6 });
    expect(result(g, s)).toEqual({ winner: 'W', by: 'score', margin: 43 });
  });
});

describe('territory scoring (DESIGN 8.2)', () => {
  it('counts surrounded points plus prisoners; dead stones are prisoners', () => {
    const g = fromDiagram(SPLIT9, 'B', settings('territory'));
    const s = score(g, SPLIT9_DEAD);
    expect(s.B).toEqual({ territory: 18, stones: 9, prisoners: 1 });
    expect(s.W).toEqual({ territory: 36, stones: 9, prisoners: 1 });
    expect(s.total2).toEqual({ B: 38, W: 74 + 13 });
    expect(result(g, s)).toEqual({ winner: 'W', by: 'score', margin: 49 });
  });

  it('adds stones captured during play', () => {
    const rows = [...SPLIT9];
    rows[0] = 'oxx.o....';
    let g = fromDiagram(rows, 'B', settings('territory'));
    g = play(g, 'ab', 1);
    expect(g.prisoners).toEqual({ B: 1, W: 0 });
    const s = score(g, SPLIT9_DEAD);
    expect(s.B).toEqual({ territory: 16, stones: 11, prisoners: 2 });
    expect(s.total2.B).toBe(36);
    expect(s.margin2).toBe(36 - 87);
    // Area ignores prisoners: the same as without the capture.
    const a = score(fromDiagram(rows, 'B', settings('area')), []);
    expect(a.B.prisoners).toBe(0);
    expect(score(play(fromDiagram(rows, 'B', settings('area')), 'ab', 1), SPLIT9_DEAD).total2).toEqual({ B: 54, W: 105 });
  });

  it('gives no territory in seki on 13×13', () => {
    const g = fromDiagram(SEKI13, 'B', settings('territory'));
    const s = score(g, []);
    expect(s.B.territory).toBe(157);
    expect(s.W.territory).toBe(0);
    expect(s.total2).toEqual({ B: 314, W: 13 });
  });

  it('counts a 19×19 board', () => {
    const g = fromDiagram(SPLIT19, 'B', settings('territory'));
    const s = score(g, []);
    expect(s.total2).toEqual({ B: 342, W: 304 + 13 });
    expect(result(g, s)).toEqual({ winner: 'B', by: 'score', margin: 25 });
  });

  it('has no handicap compensation, only the 0.5 komi', () => {
    const g = fromDiagram(SPLIT9, 'B', { rules: 'territory', handicap: 3, komi2: 1 });
    const s = score(g, SPLIT9_DEAD);
    expect(s.compensation2).toBe(0);
    expect(s.total2).toEqual({ B: 38, W: 75 });
  });
});

describe('goscorer agreement and determinism', () => {
  const cases: [string, string[], Point[]][] = [
    ['split 9', SPLIT9, SPLIT9_DEAD],
    ['split 9 unmarked', SPLIT9, []],
    ['seki 13', SEKI13, []],
    ['split 19', SPLIT19, []],
  ];

  it('matches goscorer’s own totals under both rule sets', () => {
    for (const rules of ['area', 'territory'] as Rules[]) {
      for (const [, rows, dead] of cases) {
        const g = fromDiagram(rows, 'B', settings(rules));
        const s = score(g, dead);
        const ref = goscorerTotals(g, dead);
        expect(s.total2.B).toBe(2 * ref.black);
        expect(s.total2.W - s.komi2).toBe(2 * ref.white);
      }
    }
  });

  it('gives identical results for identical inputs, whatever the order of the dead set', () => {
    const g = fromDiagram(SPLIT9, 'B', settings('area'));
    const a = score(g, ['ae', 'ge']);
    const b = score(g, ['ge', 'ae', 'ge', 'zz', 'tt', 'aa']); // duplicates, junk and empty points are ignored
    expect(b).toEqual(a);
    expect(result(g, a)).toEqual(result(g, b));
    expect(score(g, SPLIT9_DEAD)).toEqual(a);
  });

  it('never ties with half-point komi', () => {
    for (const [, rows, dead] of cases) {
      for (const rules of ['area', 'territory'] as Rules[]) {
        const s = score(fromDiagram(rows, 'B', settings(rules)), dead);
        expect(Math.abs(s.margin2) % 2).toBe(1);
      }
    }
  });

  it('scores a played game in scoring through the public flow', () => {
    // Both pass at once on an empty board: only komi counts.
    const g = pass(pass(replay(makeSettings(9), []), 1), 1);
    expect(g.scoring?.round).toBe(1);
    const s = score(g, g.scoring?.dead ?? []);
    expect(s.total2).toEqual({ B: 0, W: 15 });
    expect(result(g, s)).toEqual({ winner: 'W', by: 'score', margin: 15 });
  });
});

describe('territory map', () => {
  it('names the owner of every empty or dead point; living stones are absent', () => {
    const g = fromDiagram(SPLIT9, 'B', settings('area'));
    const t = territory(g, SPLIT9_DEAD);
    expect(t.aa).toBe('B');
    expect(t.ae).toBe('B'); // dead white stone
    expect(t.ge).toBe('W'); // dead black stone
    expect(t.da).toBeNull(); // dame
    expect(t.ia).toBe('W');
    expect('ca' in t).toBe(false);
    expect(Object.keys(t)).toHaveLength(81 - 18 + 0);
    const tt = territory(fromDiagram(SPLIT9, 'B', settings('territory')), SPLIT9_DEAD);
    expect(tt.aa).toBe('B');
    expect(tt.da).toBeNull();
  });
});

describe('toggle', () => {
  const g = fromDiagram(SPLIT9, 'B', settings('area'));

  it('toggles the whole chain and keeps the set sorted', () => {
    const col = ['ca', 'cb', 'cc', 'cd', 'ce', 'cf', 'cg', 'ch', 'ci'];
    const on = toggle(g, ['ge'], 'ce');
    expect(on).toEqual([...col, 'ge']);
    expect(toggle(g, on, 'ca')).toEqual(['ge']);
    // A partly marked chain becomes fully dead.
    expect(toggle(g, ['cc'], 'ci')).toEqual(col);
  });

  it('ignores empty points and returns a cleaned set', () => {
    expect(toggle(g, ['ge', 'ae', 'ge', 'bb'], 'bb')).toEqual(['ae', 'ge']);
    expect(toggle(g, [], 'tt')).toEqual([]);
  });
});

describe('propose', () => {
  const g = fromDiagram(SPLIT9, 'B', settings('area'));
  const own = (f: (i: number) => number) => Float32Array.from({ length: 81 }, (_, i) => f(i));

  it('marks stones with ownership ≥ 0.7 toward the opponent dead', () => {
    // Left of column D is Black's, the rest White's.
    const map = own((i) => (i % 9 < 3 ? 0.95 : i % 9 === 3 ? 0 : -0.95));
    expect(propose(g, map)).toEqual(['ae', 'ge']);
  });

  it('uses the threshold inclusively and ignores empty points and NaN', () => {
    const ae = pointToIndex('ae', 9);
    const ge = pointToIndex('ge', 9);
    expect(DEAD_THRESHOLD).toBe(0.7);
    const atThreshold = own((i) => (i === ae ? 0.7 : i === ge ? -0.7 : 0));
    expect(propose(g, atThreshold)).toEqual(['ae', 'ge']);
    const below = own((i) => (i === ae ? 0.69 : i === ge ? Number.NaN : -1));
    // Every black stone sits at −1 (toward White): the whole black wall and G5 except the NaN one.
    expect(propose(g, below)).toEqual(['ca', 'cb', 'cc', 'cd', 'ce', 'cf', 'cg', 'ch', 'ci']);
  });

  it('proposes nothing without an ownership map', () => {
    expect(propose(g, null)).toEqual([]);
  });
});

describe('result', () => {
  it('turns a margin into a result; a tie goes to White', () => {
    const g = fromDiagram(SPLIT9, 'B', settings('area'));
    const s = score(g, SPLIT9_DEAD);
    expect(result(g, { ...s, margin2: 9 })).toEqual({ winner: 'B', by: 'score', margin: 9 });
    expect(result(g, { ...s, margin2: 0 })).toEqual({ winner: 'W', by: 'score', margin: 0 });
  });
});
