import { describe, expect, it } from 'vitest';
import {
  CONFIRM_WINDOW_MS,
  GUARD_BUDGET_MS,
  SCORE_DROP,
  SELF_ATARI_STONES,
  WINRATE_DROP,
  guardKey,
  isConfirmation,
  judgeEvals,
  scoreDropFor,
  selfAtariVerdict,
} from './blunder';
import { PASS, fromDiagram, makeSettings, replay } from './zigo';

/**
 * Prepared positions (DESIGN 15.4), Black to move.
 * - SELF3: Black's two stones c5–d5 have two liberties (e5, d4); Black d4 (`df`) makes a
 *   three-stone chain whose only liberty (e5) White can take: a self-atari of 3 → flagged.
 * - SELF2: Black's single stone at d5 with two liberties; Black c5 (`ce`) makes two stones in
 *   capturable atari → not flagged (fewer than 3).
 * - THROW: Black's throw-in at a single point → never flagged.
 */
const SELF3 = fromDiagram([
  '.........',
  '.........',
  '.........',
  '..ooo....',
  '.oxx.o...',
  '..o.o....',
  '...o.....',
  '.........',
  '.........',
]);

const SELF2 = fromDiagram([
  '.........',
  '.........',
  '.........',
  '..ooo....',
  '.o.x.o...',
  '..ooo....',
  '.........',
  '.........',
  '.........',
]);

/** White's eye at e5 (`ee`): a black stone there is a one-stone self-atari (a throw-in). */
const THROW = fromDiagram([
  '.........',
  '.........',
  '.........',
  '...ooo...',
  '...o.o...',
  '...ooo...',
  '.........',
  '.........',
  '.........',
]);

describe('constants (DESIGN 7.2)', () => {
  it('uses the design thresholds', () => {
    expect(SCORE_DROP).toEqual({ 9: 6, 13: 8, 19: 12 });
    expect(WINRATE_DROP).toBe(0.15);
    expect(SELF_ATARI_STONES).toBe(3);
    expect(GUARD_BUDGET_MS).toBe(150);
    expect(CONFIRM_WINDOW_MS).toBe(5000);
    expect(scoreDropFor(9)).toBe(6);
    expect(scoreDropFor(13)).toBe(8);
    expect(scoreDropFor(19)).toBe(12);
  });
});

describe('judgeEvals', () => {
  /** The "after" evaluation is from the opponent's side: a player lead of L after is −L for them. */
  const after = (playerLead: number, playerWin: number) => ({ scoreLead: -playerLead, winrate: 1 - playerWin });

  it.each([
    [9, 6],
    [13, 8],
    [19, 12],
  ])('on size %i flags a drop of %i points together with 15 win-rate points', (size, drop) => {
    const before = { scoreLead: 2, winrate: 0.6 };
    expect(judgeEvals(size, before, after(2 - drop, 0.45))).toMatchObject({ flag: true, reason: 'drop', scoreDrop: drop });
    expect(judgeEvals(size, before, after(2 - drop + 0.1, 0.3)).flag).toBe(false);
  });

  it('needs the win rate to drop by 15 points as well', () => {
    const before = { scoreLead: 30, winrate: 0.99 };
    // Winning by 30, still winning by 10 after: the win rate barely moves.
    expect(judgeEvals(9, before, after(10, 0.97))).toMatchObject({ flag: false });
    expect(judgeEvals(9, before, after(10, 0.85)).flag).toBe(false);
    expect(judgeEvals(9, before, after(10, 0.84)).flag).toBe(true);
  });

  it('never flags without both evaluations or with broken numbers', () => {
    const before = { scoreLead: 2, winrate: 0.6 };
    expect(judgeEvals(9, null, after(-20, 0.05)).flag).toBe(false);
    expect(judgeEvals(9, before, null).flag).toBe(false);
    expect(judgeEvals(9, before, { scoreLead: Number.NaN, winrate: 0.9 }).flag).toBe(false);
  });

  it('never flags a move that keeps or improves the position', () => {
    expect(judgeEvals(9, { scoreLead: 2, winrate: 0.6 }, after(5, 0.8)).flag).toBe(false);
  });
});

describe('selfAtariVerdict (rules only)', () => {
  it('flags a self-atari of three stones', () => {
    expect(selfAtariVerdict(SELF3, 'df')).toEqual({ flag: true, reason: 'self-atari', stones: 3 });
  });

  it('leaves two-stone and single-stone self-ataris alone', () => {
    expect(selfAtariVerdict(SELF2, 'ce').flag).toBe(false);
    expect(selfAtariVerdict(THROW, 'ee').flag).toBe(false);
  });

  it('ignores passes, safe and illegal points', () => {
    expect(selfAtariVerdict(SELF3, PASS).flag).toBe(false);
    expect(selfAtariVerdict(SELF3, 'aa').flag).toBe(false);
    expect(selfAtariVerdict(SELF3, 'cd').flag).toBe(false);
  });
});

describe('confirm window', () => {
  const r = { key: 'k', point: 'ee', at: 1000 };

  it('commits the same stone in the same position within 5 s', () => {
    expect(isConfirmation(r, 'k', 'ee', 1000)).toBe(true);
    expect(isConfirmation(r, 'k', 'ee', 6000)).toBe(true);
    expect(isConfirmation(r, 'k', 'ee', 6001)).toBe(false);
  });

  it('not another stone, another position, or no refusal', () => {
    expect(isConfirmation(r, 'k', 'ef', 2000)).toBe(false);
    expect(isConfirmation(r, 'j', 'ee', 2000)).toBe(false);
    expect(isConfirmation(null, 'k', 'ee', 2000)).toBe(false);
    expect(isConfirmation(r, 'k', 'ee', 999)).toBe(false);
  });

  it('keys positions by cursor and plies', () => {
    const g = replay(makeSettings(9), ['ee', 'cc']);
    expect(guardKey(g)).toBe('2:eecc');
    expect(guardKey(replay(makeSettings(9), []))).toBe('0:');
  });
});
