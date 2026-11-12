import { describe, expect, it } from 'vitest';
import {
  DIAL_GEOMETRY,
  DIAL_INCREMENTS,
  DIAL_MINUTES,
  DIAL_PERIODS,
  budgetMs,
  clockStates,
  clockView,
  customByoyomiTc,
  customTc,
  dialAim,
  dialItemOffset,
  flagged,
  initialFace,
  isCounting,
  liveClock,
  msUntilFlag,
  nearestIndex,
  positionKey,
  remaining,
  tcKey,
  tickInterval,
  timerElapsed,
  timerPause,
  timerReset,
  timerResume,
  timerSet,
  toTimeControl,
} from './clock';
import type { Game, TimeControl } from './types';
import zigo, { makeSettings, parseTc } from './zigo';

const TC_1_0: TimeControl = { kind: 'fischer', baseMs: 60_000, incMs: 0 };
const TC_3_2: TimeControl = { kind: 'fischer', baseMs: 180_000, incMs: 2_000 };
/** 1 minute main time, then 3 periods of 10 s. */
const BY_1_3x10 = { kind: 'byoyomi', baseMs: 60_000, periods: 3, periodMs: 10_000 } as const;
/** Pure byo-yomi: no main time, 5 periods of 30 s. */
const BY_0_5x30 = { kind: 'byoyomi', baseMs: 0, periods: 5, periodMs: 30_000 } as const;

const S9 = makeSettings(9);

/** Plays SGF points (`tt` = pass) with the given ms each. Black moves first. */
function playAll(moves: [string, number][], g: Game = zigo.newGame(S9)): Game {
  return moves.reduce((acc, [m, ms]) => zigo.play(acc, m, ms), g);
}

const timeout = (g: Game) => zigo.end(g, { winner: g.turn === 'B' ? 'W' : 'B', by: 'time' });

describe('toTimeControl and tcKey', () => {
  it('accepts objects, strings and off', () => {
    expect(toTimeControl(TC_3_2)).toEqual(TC_3_2);
    expect(toTimeControl('3+2')).toEqual(TC_3_2);
    expect(toTimeControl('1m3x10')).toEqual(BY_1_3x10);
    expect(toTimeControl('0m5x30')).toEqual(BY_0_5x30);
    expect(toTimeControl('off')).toBeNull();
    expect(toTimeControl(null)).toBeNull();
    expect(toTimeControl(undefined)).toBeNull();
    expect(toTimeControl({ kind: 'fischer', baseMs: 0, incMs: 0 })).toBeNull();
    expect(toTimeControl({ kind: 'byoyomi', baseMs: 60_000, periods: 0, periodMs: 30_000 })).toBeNull();
  });

  it('keys a control by value', () => {
    expect(tcKey(TC_3_2)).toBe(tcKey({ ...TC_3_2 }));
    expect(tcKey(BY_1_3x10)).not.toBe(tcKey(BY_0_5x30));
    expect(tcKey('5+7')).toBe('5+7');
    expect(tcKey(null)).toBeNull();
  });
});

describe('positionKey', () => {
  it('changes with every ply and returns on undo / redo', () => {
    const g0 = zigo.newGame(S9);
    const g1 = zigo.play(g0, 'ee', 0);
    expect(positionKey(g0)).not.toBe(positionKey(g1));
    expect(positionKey(zigo.undo(g1, 1))).toBe(positionKey(g0));
    expect(positionKey(zigo.redo(zigo.undo(g1, 1), 1))).toBe(positionKey(g1));
    expect(positionKey(zigo.pass(g1, 0))).not.toBe(positionKey(g1));
  });
});

describe('turn timer (injected now)', () => {
  it('runs from its start and banks time across a pause', () => {
    let t = timerReset(true, 1000);
    expect(timerElapsed(t, 1000)).toBe(0);
    expect(timerElapsed(t, 3500)).toBe(2500);
    t = timerPause(t, 4000);
    expect(t).toEqual({ used: 3000, since: null });
    // A hidden tab for a minute: nothing counts.
    expect(timerElapsed(t, 64_000)).toBe(3000);
    t = timerResume(t, 64_000);
    expect(timerElapsed(t, 65_000)).toBe(4000);
  });

  it('pause and resume are idempotent; timerSet follows the flag', () => {
    const run = timerReset(true, 0);
    expect(timerResume(run, 50)).toBe(run);
    const stopped = timerPause(run, 100);
    expect(timerPause(stopped, 900)).toBe(stopped);
    expect(timerSet(stopped, false, 2000)).toBe(stopped);
    expect(timerSet(stopped, true, 2000)).toEqual({ used: 100, since: 2000 });
  });

  it('a paused reset carries initial time; a backwards clock never counts negative', () => {
    const t = timerReset(false, 500, 1200);
    expect(timerElapsed(t, 99_999)).toBe(1200);
    expect(timerElapsed(timerReset(true, 1000), 900)).toBe(0);
    expect(timerReset(true, 0, -50).used).toBe(0);
  });
});

describe('remaining (Fischer)', () => {
  it('first move of each side is untimed, then Fischer increment applies', () => {
    // Black E5 (untimed, 5 s), White C3 (untimed, 7 s), Black G3 3 s, White C7 4 s.
    const g = playAll([
      ['ee', 5000],
      ['cg', 7000],
      ['gg', 3000],
      ['cc', 4000],
    ]);
    expect(remaining(g, TC_3_2, 0)).toEqual({ B: 180_000 - 3000 + 2000, W: 180_000 - 4000 + 2000 });
    // Black to move, 10 s into the turn.
    expect(remaining(g, TC_3_2, 10_000)).toEqual({ B: 179_000 - 10_000, W: 178_000 });
  });

  it('does not count the running turn before the side has moved once', () => {
    const g0 = zigo.newGame(S9);
    expect(remaining(g0, TC_1_0, 30_000)).toEqual({ B: 60_000, W: 60_000 });
    const g1 = playAll([['ee', 1000]]);
    expect(remaining(g1, TC_1_0, 30_000)).toEqual({ B: 60_000, W: 60_000 });
    const g2 = playAll([['ee', 1000], ['cc', 1000]]);
    expect(remaining(g2, TC_1_0, 30_000)).toEqual({ B: 30_000, W: 60_000 });
  });

  it('clock off: time used per side, plus the running turn', () => {
    const g = playAll([
      ['ee', 5000],
      ['cc', 7000],
    ]);
    expect(remaining(g, null, 0)).toEqual({ B: 5000, W: 7000 });
    expect(remaining(g, null, 2500)).toEqual({ B: 7500, W: 7000 });
  });

  it('goes negative past the flag and ignores the turn once the game is over', () => {
    const g = playAll([['ee', 0], ['cc', 0]]);
    expect(remaining(g, TC_1_0, 61_000).B).toBe(-1000);
    const over = timeout(g);
    expect(remaining(over, TC_1_0, 61_000).B).toBe(60_000);
  });

  it('stops during scoring (two passes)', () => {
    const g = playAll([['ee', 0], ['cc', 0], ['tt', 1000], ['tt', 2000]]);
    expect(g.scoring).toBeDefined();
    expect(isCounting(g, TC_1_0)).toBe(false);
    expect(remaining(g, TC_1_0, 30_000)).toEqual({ B: 59_000, W: 58_000 });
    expect(flagged(g, TC_1_0, 1e9)).toBeNull();
  });

  it('undo and redo restore the clocks from the log', () => {
    const moves: [string, number][] = [
      ['ee', 1000],
      ['cc', 1000],
      ['gg', 20_000],
      ['cg', 15_000],
      ['gc', 9_000],
    ];
    const g = playAll(moves);
    expect(remaining(g, TC_3_2, 0)).toEqual({ B: 180_000 - 29_000 + 4000, W: 180_000 - 15_000 + 2000 });
    const back = zigo.undo(g, 2);
    expect(remaining(back, TC_3_2, 0)).toEqual({ B: 180_000 - 20_000 + 2000, W: 180_000 });
    const again = zigo.redo(back, 2);
    expect(remaining(again, TC_3_2, 0)).toEqual(remaining(g, TC_3_2, 0));
  });
});

describe('byo-yomi (DESIGN 11)', () => {
  it('liveClock spends main time first, then periods; a period is kept until it runs out', () => {
    const base = { mainMs: 20_000, periodMs: 10_000, periods: 3 };
    expect(liveClock(base, BY_1_3x10, 5_000)).toEqual({ mainMs: 15_000, periodMs: 10_000, periods: 3 });
    expect(liveClock(base, BY_1_3x10, 26_000)).toEqual({ mainMs: 0, periodMs: 4_000, periods: 3 });
    expect(liveClock(base, BY_1_3x10, 31_000)).toEqual({ mainMs: 0, periodMs: 9_000, periods: 2 });
    expect(liveClock(base, BY_1_3x10, 49_999)).toEqual({ mainMs: 0, periodMs: 1, periods: 1 });
    expect(liveClock(base, BY_1_3x10, 50_000)).toEqual({ mainMs: 0, periodMs: 0, periods: 0 });
    expect(budgetMs(base, BY_1_3x10)).toBe(50_000);
    expect(liveClock({ mainMs: 5000, periodMs: 0, periods: 0 }, TC_1_0, 7000)).toEqual({ mainMs: -2000, periodMs: 0, periods: 0 });
  });

  it('remaining counts main time plus the periods left; the log keeps or uses up periods', () => {
    // Black: untimed first move, then 65 s (main gone, 5 s into period 1: kept), then 25 s (2 periods used).
    const g = playAll([['ee', 0], ['cc', 0], ['gg', 65_000], ['cg', 0]]);
    expect(zigo.clocks(g, BY_1_3x10).B).toEqual({ mainMs: 0, periodMs: 10_000, periods: 3 });
    expect(remaining(g, BY_1_3x10, 0).B).toBe(30_000);
    expect(remaining(g, BY_1_3x10, 12_000).B).toBe(18_000);
    expect(clockStates(g, BY_1_3x10, 12_000).B).toEqual({ mainMs: 0, periodMs: 8_000, periods: 2 });
    expect(msUntilFlag(g, BY_1_3x10, 12_000)).toBe(18_000);
    expect(flagged(g, BY_1_3x10, 29_999)).toBeNull();
    expect(flagged(g, BY_1_3x10, 30_000)).toBe('B');
    const after = playAll([['gc', 25_000], ['cd', 0]], g);
    expect(zigo.clocks(after, BY_1_3x10).B).toEqual({ mainMs: 0, periodMs: 10_000, periods: 1 });
  });

  it('shows main time as m:ss and periods as `0:24 ·3`, with tenths below 10 s', () => {
    const g = playAll([['ee', 0], ['cc', 0]]);
    const pure = clockView(g, BY_0_5x30, 6_000);
    expect(pure.B).toMatchObject({ text: '0:24 ·5', running: true, low: false, periods: 5, overtime: true, ms: 24_000 });
    expect(pure.W).toMatchObject({ text: '0:30 ·5', running: false, periods: 5 });
    const main = clockView(g, BY_1_3x10, 15_000);
    expect(main.B).toMatchObject({ text: '0:45', periods: 3, overtime: false });
    const low = clockView(g, BY_1_3x10, 62_500);
    expect(low.B).toMatchObject({ text: '7.5 ·3', low: true, overtime: true });
    const last = clockView(g, BY_1_3x10, 85_000);
    expect(last.B).toMatchObject({ text: '5.0 ·1' });
    const out = clockView(g, BY_1_3x10, 90_000);
    expect(out.B).toMatchObject({ text: '0.0', flagged: true, periods: 0 });
    expect(out.flagged).toBe('B');
  });

  it('initial faces show the base time or the first period', () => {
    expect(initialFace(BY_1_3x10)).toMatchObject({ text: '1:00', periods: 3 });
    expect(initialFace(BY_0_5x30)).toMatchObject({ text: '0:30 ·5', overtime: true });
    expect(initialFace(TC_3_2)).toMatchObject({ text: '3:00', periods: null });
    expect(initialFace(null)).toMatchObject({ text: '0:00', untimed: true });
  });
});

describe('flagged / msUntilFlag / isCounting', () => {
  const g = playAll([['ee', 0], ['cc', 0], ['gg', 50_000], ['cg', 0]]);
  it('flags the side to move at zero', () => {
    expect(isCounting(g, TC_1_0)).toBe(true);
    expect(msUntilFlag(g, TC_1_0, 0)).toBe(10_000);
    expect(flagged(g, TC_1_0, 9_999)).toBeNull();
    expect(flagged(g, TC_1_0, 10_000)).toBe('B');
    expect(msUntilFlag(g, TC_1_0, 12_000)).toBe(0);
  });
  it('never flags without a clock, before the first move, or after the end', () => {
    expect(flagged(g, null, 1e9)).toBeNull();
    expect(msUntilFlag(g, null, 0)).toBeNull();
    expect(flagged(zigo.newGame(S9), TC_1_0, 1e9)).toBeNull();
    expect(flagged(zigo.end(g, { winner: 'W', by: 'resign' }), TC_1_0, 1e9)).toBeNull();
  });
});

describe('clockView', () => {
  it('formats m:ss, marks the running side, and switches to tenths below 10 s', () => {
    const g = playAll([['ee', 0], ['cc', 0], ['gg', 0], ['cg', 0]]);
    const v = clockView(g, TC_1_0, 1500);
    expect(v.timed).toBe(true);
    expect(v.counting).toBe(true);
    expect(v.B).toEqual({ text: '0:58', running: true, low: false, flagged: false, untimed: false, ms: 58_500, periods: null, overtime: false });
    expect(v.W).toEqual({ text: '1:00', running: false, low: false, flagged: false, untimed: false, ms: 60_000, periods: null, overtime: false });
    const low = clockView(g, TC_1_0, 50_750);
    expect(low.B.text).toBe('9.2');
    expect(low.B.low).toBe(true);
  });

  it('shows 0.0 flagged at zero and on a loss on time', () => {
    const g = playAll([['ee', 0], ['cc', 0]]);
    const atZero = clockView(g, TC_1_0, 60_400);
    expect(atZero.B).toMatchObject({ text: '0.0', flagged: true, ms: 0, low: true });
    expect(atZero.flagged).toBe('B');
    const lost = timeout(g);
    const after = clockView(lost, TC_1_0, 0);
    expect(after.B).toMatchObject({ text: '0.0', flagged: true, running: false });
    expect(after.W.flagged).toBe(false);
    expect(after.flagged).toBe('B');
    expect(after.counting).toBe(false);
  });

  it('a paused turn keeps its spent time but is not drawn as running', () => {
    const g = playAll([['ee', 0], ['cc', 0]]);
    const v = clockView(g, TC_1_0, 5000, { live: false });
    expect(v.B).toMatchObject({ text: '0:55', running: false });
  });

  it('clock off: dimmed time used, never running or flagged', () => {
    const g = playAll([['ee', 65_000]]);
    const v = clockView(g, null, 3000);
    expect(v.timed).toBe(false);
    expect(v.B).toEqual({ text: '1:05', running: false, low: false, flagged: false, untimed: true, ms: 65_000, periods: null, overtime: false });
    expect(v.W).toEqual({ text: '0:03', running: false, low: false, flagged: false, untimed: true, ms: 3000, periods: null, overtime: false });
    expect(v.flagged).toBeNull();
  });

  it('the first move of each side does not run the clock', () => {
    const v = clockView(zigo.newGame(S9), TC_1_0, 20_000);
    expect(v.B).toMatchObject({ text: '1:00', running: false });
    expect(v.counting).toBe(false);
  });

  it('White moves first in a handicap game and its clock starts on its second move', () => {
    const h = zigo.newGame(makeSettings(9, 'area', 2));
    expect(h.turn).toBe('W');
    const g = playAll([['ee', 0], ['cc', 0]], h);
    expect(g.turn).toBe('W');
    expect(clockView(g, TC_1_0, 2000).W).toMatchObject({ text: '0:58', running: true });
  });
});

describe('tick and dial helpers', () => {
  it('ticks every 100 ms with a clock and 250 ms without', () => {
    expect(tickInterval(TC_1_0)).toBe(100);
    expect(tickInterval(BY_1_3x10)).toBe(100);
    expect(tickInterval(null)).toBe(250);
  });

  it('dial values make valid time controls', () => {
    expect(DIAL_MINUTES.length).toBeLessThanOrEqual(9);
    expect(DIAL_INCREMENTS.length).toBeLessThanOrEqual(9);
    for (const m of DIAL_MINUTES)
      for (const i of DIAL_INCREMENTS) expect(parseTc(customTc(m, i))).toEqual({ kind: 'fischer', baseMs: m * 60_000, incMs: i * 1000 });
    expect(customTc(20, 5)).toBe('20+5');
    expect(DIAL_PERIODS).toEqual([1, 3, 5, 10]);
    for (const p of DIAL_PERIODS) expect(parseTc(customByoyomiTc(10, p, 30))).toEqual({ kind: 'byoyomi', baseMs: 600_000, periods: p, periodMs: 30_000 });
    expect(customByoyomiTc(20, 5, 30)).toBe('20m5x30');
  });

  it('nearestIndex finds the closest value', () => {
    expect(nearestIndex(DIAL_MINUTES, 5)).toBe(DIAL_MINUTES.indexOf(5));
    expect(nearestIndex(DIAL_MINUTES, 4)).toBe(DIAL_MINUTES.indexOf(3));
    expect(nearestIndex(DIAL_MINUTES, 1000)).toBe(DIAL_MINUTES.length - 1);
  });

  it('dialAim follows the Ztyle zones and angles', () => {
    const n = 9;
    expect(dialAim(0, 10, n)).toEqual({ zone: 'center', index: null });
    expect(dialAim(0, -30, n)).toEqual({ zone: 'none', index: null });
    expect(dialAim(0, -45, n)).toEqual({ zone: 'aim', index: 0 });
    expect(dialAim(0, -60, n)).toEqual({ zone: 'commit', index: 0 });
    // Straight right is 90°: item 2 of 9 sits at 80°, item 3 at 120°.
    expect(dialAim(60, 0, n).index).toBe(2);
    // Every item's own position aims at itself.
    for (let i = 0; i < n; i++) {
      const p = dialItemOffset(i, n, DIAL_GEOMETRY.radius);
      expect(dialAim(p.x, p.y, n)).toEqual({ zone: 'commit', index: i });
    }
  });
});
