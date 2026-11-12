import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEVEL,
  LARGE_NET_FROM,
  LEVELS,
  MAX_LEVEL,
  MIN_LEVEL,
  MIN_REPLY_MS,
  REASONABLE_PRIOR,
  RESIGN_MIN_TRAIL,
  avoidFor,
  bigSelfAtariPoints,
  captures,
  engineClock,
  fillsOwnEye,
  levelVisits,
  nextSeed,
  openDame,
  pickMove,
  resignDecision,
  seededRng,
  levelSpec,
  needsLargeNet,
  normalizeLevel,
  type EngineAnswer,
} from './levels';
import type { EngineCandidate, Game } from './types';
import { PASS, fromDiagram, isLegal, makeSettings, play, pointToIndex, replay } from './zigo';

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

/* ------------------------------------------------------------------------------------------------
 * Package 2C: level rules on top of the engine
 * --------------------------------------------------------------------------------------------- */


/**
 * Black to move. Black's three stones at c5–e5 have two liberties (d4, e4). Black d4 (`df`) makes a
 * four-stone chain with one liberty (e4) that White can take at once: a big self-atari.
 */
const SELF_ATARI = fromDiagram([
  '.........',
  '.........',
  '.........',
  '..ooo....',
  '.oxxxo...',
  '..o......',
  '...o.....',
  '.........',
  '.........',
]);

/** Black to move; the white stone at e5 (`ee`) is in atari: Black e4 (`ef`) captures it. */
const CAPTURE = fromDiagram([
  '.........',
  '.........',
  '.........',
  '....x....',
  '...xox...',
  '.........',
  '.........',
  '.........',
  '.........',
]);

/** Black to move; a1 corner eye (`ai`) is Black's own one-point eye. */
const EYE = fromDiagram([
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  'x........',
  '.x.......',
]);

const cand = (move: string, prior: number): EngineCandidate => ({ move, prior, visits: 0 });

/** A scripted rng: returns the values in order, then 0.99. */
function script(...values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.99);
}

describe('board facts for the level rules', () => {
  it('finds own one-point eyes', () => {
    expect(fillsOwnEye(EYE, 'ai')).toBe(true);
    expect(fillsOwnEye(EYE, 'aa')).toBe(false);
    expect(fillsOwnEye(EYE, PASS)).toBe(false);
  });

  it('knows which points capture', () => {
    expect(captures(CAPTURE, 'ef')).toBe(true);
    expect(captures(CAPTURE, 'aa')).toBe(false);
    expect(captures(CAPTURE, PASS)).toBe(false);
  });

  it('lists the big self-ataris (4+ stones) only', () => {
    expect(bigSelfAtariPoints(SELF_ATARI, 4)).toEqual(['df']);
    expect(bigSelfAtariPoints(CAPTURE, 4)).toEqual([]);
  });

  it('avoids big self-ataris from level 3 on', () => {
    expect(avoidFor(SELF_ATARI, 1)).toEqual([]);
    expect(avoidFor(SELF_ATARI, 2)).toEqual([]);
    for (const l of [3, 5, 8, 12]) expect(avoidFor(SELF_ATARI, l)).toEqual(['df']);
  });

  it('scales the search levels\' visits by board area', () => {
    expect(levelVisits(10, 19)).toEqual([16, 32]);
    expect(levelVisits(10, 9)).toEqual([4, 7]);
    expect(levelVisits(11, 13)).toEqual([30, 94]);
    expect(levelVisits(5, 19)).toBeNull();
    expect(levelVisits(12, 9)).toBeNull();
  });
});

describe('pickMove', () => {
  const answer = (move: string, candidates: EngineCandidate[] = []): EngineAnswer => ({ move, candidates });

  it('plays the engine move when no level rule applies', () => {
    const g = SELF_ATARI;
    expect(pickMove(g, 5, answer('aa', [cand('aa', 0.5)]), script())).toEqual({ move: 'aa', reason: 'engine' });
  });

  it('keeps a pass', () => {
    expect(pickMove(SELF_ATARI, 1, answer(PASS, [cand('aa', 0.5)]), script(0))).toEqual({ move: PASS, reason: 'engine' });
    expect(pickMove(SELF_ATARI, 12, answer(PASS), script())).toEqual({ move: PASS, reason: 'engine' });
  });

  it('never self-ataris four stones from level 3, but levels 1 and 2 may', () => {
    const a = answer('df', [cand('df', 0.6), cand('ef', 0.2), cand('aa', 0.1)]);
    expect(pickMove(SELF_ATARI, 3, a, script())).toEqual({ move: 'ef', reason: 'no-self-atari' });
    expect(pickMove(SELF_ATARI, 12, a, script())).toEqual({ move: 'ef', reason: 'no-self-atari' });
    expect(pickMove(SELF_ATARI, 2, a, script()).move).toBe('df');
    expect(pickMove(SELF_ATARI, 1, a, script(0.9)).move).toBe('df');
  });

  it('replaces an illegal answer by the best legal candidate, else pass', () => {
    // c6 (`cd`) holds a white stone.
    expect(isLegal(SELF_ATARI, 'cd')).toBe(false);
    expect(pickMove(SELF_ATARI, 5, answer('cd', [cand('cd', 0.9), cand('aa', 0.1)]), script())).toEqual({
      move: 'aa',
      reason: 'legal-fallback',
    });
    expect(pickMove(SELF_ATARI, 5, answer('cd', [cand('cd', 0.9)]), script()).move).toBe(PASS);
  });

  it('level 1 plays a random reasonable move 30 % of the time, never an own eye or an unreasonable move', () => {
    const g = EYE;
    const cands = [cand('ee', 0.5), cand('ai', 0.2), cand('aa', REASONABLE_PRIOR / 2), ...'bcdfgh'.split('').map((c) => cand(`${c}e`, 0.05))];
    const rng = seededRng(7);
    let random = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const p = pickMove(g, 1, answer('ee', cands), rng);
      expect(p.move).not.toBe('ai');
      expect(p.move).not.toBe('aa');
      if (p.move !== 'ee') random++;
    }
    // 7 reasonable candidates; a random pick hits another one 6/7 of the time: 0.3 × 6/7 ≈ 0.257.
    expect(random / n).toBeGreaterThan(0.22);
    expect(random / n).toBeLessThan(0.3);
  });

  it('level 1 captures a group in atari only half the time', () => {
    const cands = [cand('ef', 0.7), cand('aa', 0.1), cand('ii', 0.1)];
    // No random move (0.9 ≥ 0.3); the capture is kept (0.2 < 0.5).
    expect(pickMove(CAPTURE, 1, answer('ef', cands), script(0.9, 0.2))).toEqual({ move: 'ef', reason: 'engine' });
    // No random move; the capture is spared (0.7 ≥ 0.5) for a quiet move drawn by policy.
    const spared = pickMove(CAPTURE, 1, answer('ef', cands), script(0.9, 0.7, 0.1));
    expect(spared.reason).toBe('spared-capture');
    expect(['aa', 'ii']).toContain(spared.move);
    // Statistically, with the engine always choosing the capture: about half.
    const rng = seededRng(3);
    let took = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (pickMove(CAPTURE, 1, answer('ef', cands), rng).move === 'ef') took++;
    expect(took / n).toBeGreaterThan(0.38);
    expect(took / n).toBeLessThan(0.5);
  });

  it('levels 2–12 always take a capture the engine chose', () => {
    for (const l of [2, 5, 9, 12]) expect(pickMove(CAPTURE, l, answer('ef', [cand('ef', 0.9)]), script(0.9, 0.9)).move).toBe('ef');
  });

  it('is reproducible with a seeded rng', () => {
    const cands = 'abcdefghi'.split('').map((c, i) => cand(`${c}a`, 0.02 + i / 100));
    const run = (seed: number) => {
      const rng = seededRng(seed);
      return Array.from({ length: 50 }, () => pickMove(CAPTURE, 1, answer('ia', cands), rng).move);
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
    const r = seededRng(1);
    const s = nextSeed(r);
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
  });
});

describe('open dame before a pass (area rules)', () => {
  /** A settled 9×9 board with one open dame at e5 (`ee`) between the two walls; both sides have eyes. */
  const ROWS = [
    '.xxxxooo.',
    'xxxxxoooo',
    '.xxxxooo.',
    'xxxxxoooo',
    '.xxx.ooo.',
    'xxxxooooo',
    '.xxxoooo.',
    'xxxxooooo',
    '.xxxoooo.',
  ];
  /** Ownership as a settled count would see it, with every empty point neutral (0). */
  const own = (g: Game) => {
    const o = new Float32Array(81);
    for (let i = 0; i < 81; i++) o[i] = g.board[i] === 1 ? 1 : g.board[i] === 2 ? -1 : 0;
    return o;
  };

  it('finds the dame under area rules and nothing under territory rules', () => {
    const area = fromDiagram(ROWS, 'B', { rules: 'area' });
    expect(openDame(area, own(area))).toEqual(['ee']);
    const white = fromDiagram(ROWS, 'W', { rules: 'area' });
    expect(openDame(white, own(white))).toEqual(['ee']);
    const territory = fromDiagram(ROWS, 'B', { rules: 'territory' });
    expect(openDame(territory, own(territory))).toEqual([]);
  });

  it('ignores points the engine sees as owned, and positions without ownership', () => {
    const g = fromDiagram(ROWS, 'B', { rules: 'area' });
    const o = own(g);
    o[pointToIndex('ee', 9)] = 0.9;
    expect(openDame(g, o)).toEqual([]);
    expect(openDame(g, null)).toEqual([]);
  });

  it('never fills a dame that would put its own stones into atari', () => {
    // Without eyes Black's whole wall would have one liberty left after filling e5.
    const g = fromDiagram(ROWS.map((r, y) => (y % 2 === 0 ? 'x' + r.slice(1) : r)), 'B', { rules: 'area' });
    expect(openDame(g, own(g))).toEqual([]);
  });
});

describe('engine clock', () => {
  it('tells the engine its own clock, or nothing without a clock', () => {
    const g = replay(makeSettings(9), ['ee', 'cc', 'gg']);
    const withMs = play(play(play(play(g, 'cg', 4000), 'gc', 6000), 'dd', 1000), 'ff', 1000);
    const fischer = { kind: 'fischer' as const, baseMs: 120_000, incMs: 7000 };
    expect(engineClock(withMs, null, 'W')).toBeUndefined();
    const c = engineClock(withMs, fischer, 'W');
    expect(c?.tc).toEqual(fischer);
    expect(c?.left.mainMs).toBeGreaterThan(0);
    const byo = { kind: 'byoyomi' as const, baseMs: 60_000, periods: 3, periodMs: 10_000 };
    expect(engineClock(withMs, byo, 'B')?.left.periods).toBe(3);
  });
});

describe('resignDecision (DESIGN 10.4)', () => {
  const low = { winrate: 0.02, scoreLead: -20 };
  const area9 = 81;
  const late = Math.ceil(0.4 * area9);

  it('resigns at levels 5–12 after three low turns past the opening, trailing clearly', () => {
    for (const l of [5, 8, 12]) expect(resignDecision(l, 9, late, [low, low, low])).toBe(true);
  });

  it('never resigns at levels 1–4', () => {
    for (const l of [1, 2, 3, 4]) expect(resignDecision(l, 9, 200, [low, low, low, low])).toBe(false);
  });

  it('needs three turns in a row below 5 %', () => {
    expect(resignDecision(5, 9, late, [low, low])).toBe(false);
    expect(resignDecision(5, 9, late, [low, { winrate: 0.06, scoreLead: -20 }, low])).toBe(false);
    expect(resignDecision(5, 9, late, [{ winrate: 0.5, scoreLead: 0 }, low, low, low])).toBe(true);
  });

  it('waits until 0.4 moves per board point have been played', () => {
    expect(resignDecision(5, 9, late - 1, [low, low, low])).toBe(false);
    expect(resignDecision(5, 19, Math.ceil(0.4 * 361) - 1, [low, low, low])).toBe(false);
    expect(resignDecision(5, 19, Math.ceil(0.4 * 361), [low, low, low])).toBe(true);
  });

  it('only resigns when trailing by more than a few points', () => {
    const close = { winrate: 0.02, scoreLead: -RESIGN_MIN_TRAIL[9] };
    expect(resignDecision(5, 9, late, [low, low, close])).toBe(false);
    expect(resignDecision(5, 9, late, [low, low, { winrate: 0.02 }])).toBe(false);
    expect(resignDecision(5, 9, late, [low, low, {}])).toBe(false);
  });
});
