import { describe, expect, it } from 'vitest';
import zengo, { makeSettings } from '@/lib/zengo';
import type { Game, Point } from '@/lib/types';
import { COMPUTER_ENABLED } from '@/lib/flags';
import {
  PLAYABLE_MODES,
  RANKS,
  ROOMS_ENABLED,
  allMoves,
  engineStartBlocked,
  firstColor,
  nearColor,
  opponentPassed,
  other,
  passedBadges,
  rankLabel,
  reviewClockView,
  totalTime,
} from './stage';

/** Plays GTP moves (`pass` passes) on a 9×9 board, each ply taking `ms`. */
function playAll(moves: string[], ms = 1000, handicap = 0): Game {
  let g = zengo.newGame(makeSettings(9, 'area', handicap));
  for (const m of moves) {
    g = m === 'pass' ? zengo.pass(g, ms) : zengo.play(g, zengo.fromGtp(m, 9) as Point, ms);
  }
  return g;
}

describe('stage helpers', () => {
  it('milestone 1 plays pass-and-play; computer and rooms follow their milestone switches', () => {
    expect(PLAYABLE_MODES.local).toBe(true);
    expect(PLAYABLE_MODES.computer).toBe(COMPUTER_ENABLED);
    expect(PLAYABLE_MODES.room).toBe(ROOMS_ENABLED);
  });

  it('puts Black at the near edge in pass-and-play, else the player side', () => {
    expect(nearColor({ mode: 'local', color: 'B' })).toBe('B');
    expect(nearColor({ mode: 'computer', color: 'W' })).toBe('W');
    expect(nearColor({ mode: 'room', color: 'B' })).toBe('B');
    expect(other('B')).toBe('W');
    expect(other('W')).toBe('B');
  });

  it('lists every ply of the redo tail too, passes as tt', () => {
    const g = zengo.undo(playAll(['D4', 'pass', 'E5']), 2);
    expect(g.cursor).toBe(1);
    expect(allMoves(g)).toEqual([zengo.fromGtp('D4', 9), 'tt', zengo.fromGtp('E5', 9)]);
  });

  it('names White as the first mover in a handicap game', () => {
    expect(firstColor(playAll([]))).toBe('B');
    expect(firstColor(playAll([], 0, 3))).toBe('W');
  });

  it('shows the passed badge until the next stone (DESIGN 4.2)', () => {
    expect(passedBadges(playAll(['D4']))).toEqual({ B: false, W: false });
    expect(passedBadges(playAll(['D4', 'pass']))).toEqual({ B: false, W: true });
    // A stone by either side clears it.
    expect(passedBadges(playAll(['D4', 'pass', 'E5']))).toEqual({ B: false, W: false });
    expect(passedBadges(playAll(['pass', 'D4']))).toEqual({ B: false, W: false });
    // Two passes: both badges (the game is in scoring now).
    expect(passedBadges(playAll(['D4', 'pass', 'pass']))).toEqual({ B: true, W: true });
    // Handicap: White moves first, so a first pass is White's.
    expect(passedBadges(playAll(['pass'], 0, 2))).toEqual({ B: false, W: true });
  });

  it("marks the flag when the opponent's last ply was a pass (DESIGN 6.2)", () => {
    expect(opponentPassed(playAll([]))).toBe(false);
    expect(opponentPassed(playAll(['D4']))).toBe(false);
    expect(opponentPassed(playAll(['D4', 'pass']))).toBe(true);
    // In scoring there is nothing to pass.
    expect(opponentPassed(playAll(['D4', 'pass', 'pass']))).toBe(false);
  });

  it('sums the time used up to the cursor', () => {
    const g = playAll(['D4', 'E5', 'F6'], 1500);
    expect(totalTime(g)).toBe(4500);
    expect(totalTime(zengo.undo(g, 1))).toBe(3000);
  });

  it('counts the flagged turn of a game lost on time (DESIGN 8.5 summary)', () => {
    const g = playAll(['D4', 'E5', 'F6'], 1500);
    // White is to move and runs out: the time White had left counts too.
    const lost = zengo.end(g, { winner: 'B', by: 'time' });
    const left = zengo.clocks(g, { kind: 'fischer', baseMs: 60_000, incMs: 0 }).W.mainMs;
    expect(left).toBeGreaterThan(0);
    expect(totalTime(lost, '1+0')).toBe(4500 + left);
    expect(totalTime(lost, { kind: 'fischer', baseMs: 60_000, incMs: 0 })).toBe(4500 + left);
    // From a prepared URL without per-ply times: the loser's full minute.
    const bare = zengo.end(playAll(['D4', 'E5'], 0), { winner: 'W', by: 'time' });
    expect(totalTime(bare, '1+0')).toBe(60_000);
    // Byo-yomi: main time plus every period left.
    expect(totalTime(bare, '1m3x30')).toBe(60_000 + 3 * 30_000);
    // Without a time control, or not lost on time, nothing is added.
    expect(totalTime(lost)).toBe(4500);
    expect(totalTime(lost, null)).toBe(4500);
    expect(totalTime(zengo.end(g, { winner: 'W', by: 'resign' }), '1+0')).toBe(4500);
    // A review cursor before the end shows only the logged time.
    expect(totalTime(zengo.goto(lost, 2), '1+0')).toBe(3000);
  });

  it('review shows time used, dimmed, without a clock', () => {
    const g = playAll(['D4', 'E5', 'F6'], 61_000);
    expect(reviewClockView(g, null).B).toMatchObject({ text: '2:02', untimed: true, running: false });
    expect(reviewClockView(g, null).W.text).toBe('1:01');
  });

  it('review shows the clocks as they stood at the shown move, never running', () => {
    const g = playAll(['D4', 'E5', 'F6', 'G7'], 2000);
    // Each side's first move is untimed: Black used 2 s once (F6), White once (G7).
    const v = reviewClockView(g, '1+0');
    expect(v.B).toMatchObject({ text: '0:58', running: false, untimed: false, flagged: false });
    expect(v.W).toMatchObject({ text: '0:58', running: false });
    expect(reviewClockView(zengo.goto(g, 2), '1+0').B.text).toBe('1:00');
  });

  it('review of a game lost on time shows 0.0 only at the end', () => {
    const g = playAll(['D4', 'E5', 'F6', 'G7'], 2000);
    const lost = zengo.end(g, { winner: 'W', by: 'time' });
    expect(reviewClockView(lost, '1+0').B).toMatchObject({ text: '0.0', flagged: true });
    const earlier = zengo.goto(lost, 2);
    expect(earlier.end).toBeDefined();
    expect(reviewClockView(earlier, '1+0').B).toMatchObject({ text: '1:00', flagged: false });
    expect(reviewClockView(earlier, '1+0').W.flagged).toBe(false);
  });
});

describe('rankLabel (DESIGN 4.1, 10.2)', () => {
  it('shows a calibrated 19×19 rank with ≈, nothing otherwise', () => {
    const table = { size: 19, ranks: { '5': '12k', '10': '≈2d', '3': 'weak' } };
    expect(rankLabel(5, table)).toBe('≈12k');
    expect(rankLabel(10, table)).toBe('≈2d');
    expect(rankLabel(3, table)).toBeNull();
    expect(rankLabel(7, table)).toBeNull();
    // Measured on 9×9: DESIGN 10.2 gives 19×19 strength, so it is not shown.
    expect(rankLabel(5, { size: 9, ranks: { '5': '6k' } })).toBeNull();
    expect(rankLabel(5, {})).toBeNull();
  });

  it('reads src/lib/ranks.json when calibration wrote it, else an empty table', () => {
    expect(typeof RANKS).toBe('object');
    for (let level = 1; level <= 12; level++) expect(rankLabel(level)).toBe(rankLabel(level, RANKS));
  });
});

describe('engineStartBlocked (DESIGN 14)', () => {
  const ready = { status: 'ready' } as const;
  const missing = { status: 'missing', reason: 'offline' } as const;
  const none = { small: false, large: false };
  it('never blocks online', () => {
    expect(engineStartBlocked(9, true, missing, missing, none)).toBe(false);
  });
  it('offline: levels 8–12 need stage 2, levels 1–7 stage 1', () => {
    expect(engineStartBlocked(8, false, ready, missing, none)).toBe(true);
    expect(engineStartBlocked(8, false, ready, { status: 'downloading', percent: 40 }, none)).toBe(true);
    expect(engineStartBlocked(7, false, ready, missing, none)).toBe(false);
    expect(engineStartBlocked(3, false, missing, missing, none)).toBe(true);
    expect(engineStartBlocked(12, false, ready, ready, none)).toBe(false);
  });
  it('offline: networks already loaded in the engine are enough', () => {
    expect(engineStartBlocked(8, false, ready, missing, { small: true, large: true })).toBe(false);
    expect(engineStartBlocked(3, false, missing, missing, { small: true, large: false })).toBe(false);
  });
  it('offline: an unknown cache (checking, unsupported) lets loading decide', () => {
    expect(engineStartBlocked(9, false, { status: 'unsupported' }, { status: 'unsupported' }, none)).toBe(false);
    expect(engineStartBlocked(9, false, ready, { status: 'checking' }, none)).toBe(false);
  });
});
