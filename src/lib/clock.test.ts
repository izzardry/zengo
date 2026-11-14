import { describe, expect, it } from 'vitest';
import {
  budgetMs,
  clockStates,
  clockView,
  engineClock,
  flagged,
  initialFace,
  isCounting,
  liveClock,
  msUntilFlag,
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
  withSpokenLabels,
  spokenClock,
  type ClockFace,
  type ClockTranslate,
} from './clock';
import { CLOCK_PRESETS } from '@/components/start/options';
import { translate, type Language } from './i18n/core';
import type { ClockState, Color, Game, Point, Size, TimeControl } from './types';
import zengo, { byoyomiStep, formatTc, indexToPoint, makeSettings, parseTc } from './zengo';

const TC_1_0: TimeControl = { kind: 'fischer', baseMs: 60_000, incMs: 0 };
const TC_3_2: TimeControl = { kind: 'fischer', baseMs: 180_000, incMs: 2_000 };
/** 1 minute main time, then 3 periods of 10 s. */
const BY_1_3x10 = { kind: 'byoyomi', baseMs: 60_000, periods: 3, periodMs: 10_000 } as const;
/** Pure byo-yomi: no main time, 5 periods of 30 s. */
const BY_0_5x30 = { kind: 'byoyomi', baseMs: 0, periods: 5, periodMs: 30_000 } as const;

const S9 = makeSettings(9);

/** Plays SGF points (`tt` = pass) with the given ms each. Black moves first. */
function playAll(moves: [string, number][], g: Game = zengo.newGame(S9)): Game {
  return moves.reduce((acc, [m, ms]) => zengo.play(acc, m, ms), g);
}

const timeout = (g: Game) => zengo.end(g, { winner: g.turn === 'B' ? 'W' : 'B', by: 'time' });

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
    const g0 = zengo.newGame(S9);
    const g1 = zengo.play(g0, 'ee', 0);
    expect(positionKey(g0)).not.toBe(positionKey(g1));
    expect(positionKey(zengo.undo(g1, 1))).toBe(positionKey(g0));
    expect(positionKey(zengo.redo(zengo.undo(g1, 1), 1))).toBe(positionKey(g1));
    expect(positionKey(zengo.pass(g1, 0))).not.toBe(positionKey(g1));
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
    const g0 = zengo.newGame(S9);
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
    const back = zengo.undo(g, 2);
    expect(remaining(back, TC_3_2, 0)).toEqual({ B: 180_000 - 20_000 + 2000, W: 180_000 });
    const again = zengo.redo(back, 2);
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
    expect(zengo.clocks(g, BY_1_3x10).B).toEqual({ mainMs: 0, periodMs: 10_000, periods: 3 });
    expect(remaining(g, BY_1_3x10, 0).B).toBe(30_000);
    expect(remaining(g, BY_1_3x10, 12_000).B).toBe(18_000);
    expect(clockStates(g, BY_1_3x10, 12_000).B).toEqual({ mainMs: 0, periodMs: 8_000, periods: 2 });
    expect(msUntilFlag(g, BY_1_3x10, 12_000)).toBe(18_000);
    expect(flagged(g, BY_1_3x10, 29_999)).toBeNull();
    expect(flagged(g, BY_1_3x10, 30_000)).toBe('B');
    const after = playAll([['gc', 25_000], ['cd', 0]], g);
    expect(zengo.clocks(after, BY_1_3x10).B).toEqual({ mainMs: 0, periodMs: 10_000, periods: 1 });
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
    expect(flagged(zengo.newGame(S9), TC_1_0, 1e9)).toBeNull();
    expect(flagged(zengo.end(g, { winner: 'W', by: 'resign' }), TC_1_0, 1e9)).toBeNull();
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
    const v = clockView(zengo.newGame(S9), TC_1_0, 20_000);
    expect(v.B).toMatchObject({ text: '1:00', running: false });
    expect(v.counting).toBe(false);
  });

  it('White moves first in a handicap game and its clock starts on its second move', () => {
    const h = zengo.newGame(makeSettings(9, 'area', 2));
    expect(h.turn).toBe('W');
    const g = playAll([['ee', 0], ['cc', 0]], h);
    expect(g.turn).toBe('W');
    expect(clockView(g, TC_1_0, 2000).W).toMatchObject({ text: '0:58', running: true });
  });
});

describe('tick', () => {
  it('ticks every 100 ms with a clock and 250 ms without', () => {
    expect(tickInterval(TC_1_0)).toBe(100);
    expect(tickInterval(BY_1_3x10)).toBe(100);
    expect(tickInterval(null)).toBe(250);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Byo-yomi boundaries and the step simulation (PLAN 7: "Byo-yomi from the log")                  */
/* ---------------------------------------------------------------------------------------------- */

describe('byo-yomi boundaries (DESIGN 11)', () => {
  const base = { mainMs: 0, periodMs: 10_000, periods: 3 };

  it('a period read down to 0.0 is kept by a move made then, unless it was the last', () => {
    // Exactly one period: the face reads 0.0 with the period still counted, and a move keeps it.
    expect(liveClock(base, BY_1_3x10, 10_000)).toEqual({ mainMs: 0, periodMs: 0, periods: 3 });
    expect(byoyomiStep(base, BY_1_3x10, 10_000)).toEqual({ mainMs: 0, periodMs: 10_000, periods: 3 });
    // One ms more: the period is overrun and used up; the next one runs.
    expect(liveClock(base, BY_1_3x10, 10_001)).toEqual({ mainMs: 0, periodMs: 9_999, periods: 2 });
    expect(byoyomiStep(base, BY_1_3x10, 10_001)).toEqual({ mainMs: 0, periodMs: 10_000, periods: 2 });
    // The last period reading zero is out of time, as the flag.
    expect(liveClock(base, BY_1_3x10, 30_000)).toEqual({ mainMs: 0, periodMs: 0, periods: 0 });
    expect(byoyomiStep(base, BY_1_3x10, 30_000)).toEqual({ mainMs: 0, periodMs: 0, periods: 0 });
    expect(liveClock(base, BY_1_3x10, 29_999)).toEqual({ mainMs: 0, periodMs: 1, periods: 1 });
  });

  it('main time running out exactly starts the first period in full', () => {
    const s = { mainMs: 5_000, periodMs: 10_000, periods: 3 };
    expect(liveClock(s, BY_1_3x10, 5_000)).toEqual({ mainMs: 0, periodMs: 10_000, periods: 3 });
    expect(byoyomiStep(s, BY_1_3x10, 5_000)).toEqual({ mainMs: 0, periodMs: 10_000, periods: 3 });
    expect(clockView(playAll([['ee', 0], ['cc', 0]]), BY_1_3x10, 60_000).B).toMatchObject({ text: '0:10 ·3', overtime: true, periods: 3 });
  });

  it('shows 0.0 with the periods left for the instant a period reads zero', () => {
    const g = playAll([['ee', 0], ['cc', 0]]);
    const v = clockView(g, BY_1_3x10, 70_000);
    expect(v.B).toMatchObject({ text: '0.0 ·3', flagged: false, periods: 3, overtime: true, low: true });
    expect(v.flagged).toBeNull();
    expect(clockView(g, BY_1_3x10, 70_100).B).toMatchObject({ text: '9.9 ·2', periods: 2 });
  });
});

/** Seeded PRNG (mulberry32), so every property run is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reference clock with no formulas: time passes in small ticks. Byo-yomi: main time first; then
 * the current period counts down; when it has read zero and time goes on, it is used up and the
 * next one starts; when the last one reads zero the side is out. A move resets the period.
 */
class StepClock {
  main: number;
  left: number;
  periods: number;
  out = false;
  constructor(private readonly tc: NonNullable<TimeControl>) {
    this.main = tc.baseMs;
    this.left = tc.kind === 'byoyomi' ? tc.periodMs : 0;
    this.periods = tc.kind === 'byoyomi' ? tc.periods : 0;
  }
  clone(): StepClock {
    const c = new StepClock(this.tc);
    Object.assign(c, { main: this.main, left: this.left, periods: this.periods, out: this.out });
    return c;
  }
  /** One tick of `d` ms. */
  private tick(d: number) {
    const tc = this.tc;
    if (tc.kind === 'fischer') {
      this.main -= d;
      if (this.main <= 0) this.out = true;
      return;
    }
    while (d > 0 && !this.out) {
      if (this.main > 0) {
        const take = Math.min(this.main, d);
        this.main -= take;
        d -= take;
      } else {
        if (this.left === 0) {
          this.periods -= 1;
          this.left = tc.periodMs;
        }
        const take = Math.min(this.left, d);
        this.left -= take;
        d -= take;
      }
      if (this.main === 0 && this.periods === 1 && this.left === 0) this.out = true;
    }
  }
  /** `ms` of a turn in random ticks (the chunking must not matter). */
  burn(ms: number, rng: () => number) {
    let rest = ms;
    while (rest > 0) {
      const d = Math.min(rest, rng() < 0.3 ? 1 : 1 + Math.floor(rng() * 4000));
      this.tick(d);
      rest -= d;
    }
  }
  /** The move is made. */
  move() {
    if (this.out) return;
    if (this.tc.kind === 'fischer') this.main += this.tc.incMs;
    else if (this.main === 0) this.left = this.tc.periodMs;
  }
  state(): ClockState {
    if (this.tc.kind === 'fischer') return { mainMs: this.main, periodMs: 0, periods: 0 };
    return this.out ? { mainMs: 0, periodMs: 0, periods: 0 } : { mainMs: this.main, periodMs: this.left, periods: this.periods };
  }
  /** Ms until the flag: main time plus what is left of the periods. */
  budget(): number {
    if (this.tc.kind === 'fischer') return this.main;
    if (this.out) return 0;
    return this.main + (this.main > 0 ? this.periods * this.tc.periodMs : this.left + (this.periods - 1) * this.tc.periodMs);
  }
}

/** A random legal stone (never a pass, so the game never enters scoring). */
function randomStone(g: Game, rng: () => number): Point {
  const n = g.settings.size * g.settings.size;
  const start = Math.floor(rng() * n);
  for (let k = 0; k < n; k++) {
    const p = indexToPoint((start + k) % n, g.settings.size);
    if (zengo.isLegal(g, p)) return p;
  }
  throw new Error('no legal point');
}

/** Ms for a turn, biased to the interesting edges: period boundaries, ±1 ms, zero, long thinks. */
function turnMs(sim: StepClock, tc: NonNullable<TimeControl>, rng: () => number): number {
  const r = rng();
  const unit = tc.kind === 'byoyomi' ? tc.periodMs : Math.max(1000, tc.incMs);
  const edge = (k: number) => (sim.main > 0 ? sim.main : 0) + k * unit;
  if (r < 0.15) return edge(Math.floor(rng() * 4));
  if (r < 0.3) return Math.max(0, edge(Math.floor(rng() * 4)) + (rng() < 0.5 ? -1 : 1));
  if (r < 0.35) return 0;
  if (r < 0.45) return Math.floor(rng() * (sim.main + 5 * unit));
  return Math.floor(rng() * 1.3 * unit);
}

type Byoyomi = Extract<NonNullable<TimeControl>, { kind: 'byoyomi' }>;

function randomByoyomi(rng: () => number): Byoyomi {
  const baseMs = rng() < 0.3 ? 0 : rng() < 0.5 ? 1000 * (1 + Math.floor(rng() * 30)) : 1 + Math.floor(rng() * 30_000);
  const periods = 1 + Math.floor(rng() * 5);
  const periodMs = rng() < 0.5 ? 1000 * (1 + Math.floor(rng() * 30)) : 500 + Math.floor(rng() * 20_000);
  return { kind: 'byoyomi', baseMs, periods, periodMs };
}

const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

describe('byo-yomi derivation against a step simulation (seeded)', () => {
  const SIZES: Size[] = [9, 13, 19];

  it('the log, the running turn, the flag and undo match a tick-by-tick clock', () => {
    let checks = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const rng = mulberry32(seed * 7919);
      const tc = randomByoyomi(rng);
      const handicap = rng() < 0.2 ? 2 : 0;
      let g = zengo.newGame(makeSettings(SIZES[seed % 3], 'area', handicap));
      const sims: Record<Color, StepClock> = { B: new StepClock(tc), W: new StepClock(tc) };
      const moved: Record<Color, boolean> = { B: false, W: false };
      const snapshots: Record<Color, ClockState>[] = [{ B: sims.B.state(), W: sims.W.state() }];
      const plies = 24 + Math.floor(rng() * 16);
      for (let i = 0; i < plies; i++) {
        const c = g.turn;
        const ms = turnMs(sims[c], tc, rng);
        // The running turn, part way and at the end.
        if (moved[c]) {
          const base = zengo.clocks(g, tc)[c];
          expect(base).toEqual(sims[c].state());
          for (const t of [Math.floor(rng() * (ms + 1)), ms]) {
            const live = sims[c].clone();
            live.burn(t, rng);
            expect(liveClock(base, tc, t), `seed ${seed} ply ${i} t ${t}`).toEqual(live.state());
            expect(clockStates(g, tc, t)[c]).toEqual(live.state());
            expect(clockStates(g, tc, t)[other(c)]).toEqual(sims[other(c)].state());
            expect(remaining(g, tc, t)[c]).toBe(budgetMs(base, tc) - t);
            if (!live.out) expect(remaining(g, tc, t)[c]).toBe(live.budget());
            expect(flagged(g, tc, t)).toBe(live.out ? c : null);
            // A move made right then leaves the clock where the simulation does.
            const after = live.clone();
            after.move();
            expect(byoyomiStep(base, tc, t)).toEqual(after.state());
            const face = clockView(g, tc, t)[c];
            expect(face.flagged).toBe(live.out);
            if (!live.out) expect(face.periods).toBe(live.periods);
            checks++;
          }
          sims[c].burn(ms, rng);
          sims[c].move();
        } else {
          moved[c] = true; // each side's first move is untimed
        }
        g = zengo.play(g, randomStone(g, rng), ms);
        const derived = zengo.clocks(g, tc);
        expect(derived, `seed ${seed} after ply ${i}`).toEqual({ B: sims.B.state(), W: sims.W.state() });
        snapshots.push(derived);
      }
      // Undo, redo and review restore every earlier clock from the log.
      for (let k = 0; k < 6; k++) {
        const cursor = Math.floor(rng() * (g.plies.length + 1));
        expect(zengo.clocks(zengo.goto(g, cursor), tc)).toEqual(snapshots[cursor]);
        expect(zengo.clocks(zengo.undo(g, g.plies.length - cursor), tc)).toEqual(snapshots[cursor]);
      }
      expect(zengo.clocks(zengo.redo(zengo.undo(g, 5), 5), tc)).toEqual(snapshots[g.plies.length]);
    }
    expect(checks).toBeGreaterThan(3000);
  });

  it('Fischer matches the step clock until a flag falls', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed * 104_729);
      const tc: NonNullable<TimeControl> = { kind: 'fischer', baseMs: 1000 * (10 + Math.floor(rng() * 120)), incMs: 1000 * Math.floor(rng() * 10) };
      let g = zengo.newGame(makeSettings(19));
      const sims: Record<Color, StepClock> = { B: new StepClock(tc), W: new StepClock(tc) };
      const moved: Record<Color, boolean> = { B: false, W: false };
      for (let i = 0; i < 40; i++) {
        const c = g.turn;
        const ms = turnMs(sims[c], tc, rng);
        if (moved[c]) {
          const live = sims[c].clone();
          live.burn(ms, rng);
          expect(remaining(g, tc, ms)[c]).toBe(live.budget());
          expect(flagged(g, tc, ms)).toBe(live.out ? c : null);
          if (live.out) break;
          sims[c].burn(ms, rng);
          sims[c].move();
        } else {
          moved[c] = true;
        }
        g = zengo.play(g, randomStone(g, rng), ms);
        expect(zengo.clocks(g, tc)).toEqual({ B: sims.B.state(), W: sims.W.state() });
      }
    }
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Presets (DESIGN 11)                                                                              */
/* ---------------------------------------------------------------------------------------------- */

describe('presets time correctly (DESIGN 11)', () => {
  it('are stored as `5+7` / `20m5x30` and read back unchanged', () => {
    const stored = (size: Size) => CLOCK_PRESETS[size].map((p) => formatTc(p));
    expect(stored(9)).toEqual([null, '2+7', '3+10', '5m5x30']);
    expect(stored(13)).toEqual([null, '3+7', '5+10', '10m5x30']);
    expect(stored(19)).toEqual([null, '5+7', '10+10', '20m5x30', '30m5x60']);
    for (const size of [9, 13, 19] as Size[]) for (const p of CLOCK_PRESETS[size]) expect(toTimeControl(formatTc(p))).toEqual(p);
  });

  it('Fischer presets: the base, the increment after each counted move, the flag at zero', () => {
    for (const size of [9, 13, 19] as Size[]) {
      for (const p of CLOCK_PRESETS[size]) {
        if (!p || p.kind !== 'fischer') continue;
        const g = playAll([['ee', 0], ['cc', 0], ['gg', 4000], ['cg', 0]], zengo.newGame(makeSettings(size)));
        expect(zengo.clocks(g, p).B.mainMs).toBe(p.baseMs - 4000 + p.incMs);
        expect(flagged(g, p, p.baseMs - 4000 + p.incMs - 1)).toBeNull();
        expect(flagged(g, p, p.baseMs - 4000 + p.incMs)).toBe('B');
        expect(initialFace(p).text).toBe(`${p.baseMs / 60_000}:00`);
      }
    }
  });

  it('byo-yomi presets: main time, then `0:30 ·5`, a period kept, used up, the last one loses', () => {
    for (const size of [9, 13, 19] as Size[]) {
      for (const p of CLOCK_PRESETS[size]) {
        if (!p || p.kind !== 'byoyomi') continue;
        const S = p.periodMs;
        const secs = S / 1000;
        const g = playAll([['ee', 0], ['cc', 0]], zengo.newGame(makeSettings(size)));
        expect(clockView(g, p, 0).B.text).toBe(`${p.baseMs / 60_000}:00`);
        expect(clockView(g, p, p.baseMs).B.text).toBe(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} ·${p.periods}`);
        // A move 1 s into the first period keeps all periods.
        const kept = playAll([['gg', p.baseMs + 1000], ['cg', 0]], g);
        expect(zengo.clocks(kept, p).B).toEqual({ mainMs: 0, periodMs: S, periods: p.periods });
        // 1.5 periods over: one used.
        const used = playAll([['gc', 1.5 * S], ['dg', 0]], kept);
        expect(zengo.clocks(used, p).B).toEqual({ mainMs: 0, periodMs: S, periods: p.periods - 1 });
        // The flag falls when the last period reads zero.
        const budget = (p.periods - 1) * S;
        expect(flagged(used, p, budget - 1)).toBeNull();
        expect(clockView(used, p, budget - 1000).B.text).toBe('1.0 ·1');
        expect(flagged(used, p, budget)).toBe('B');
        expect(clockView(used, p, budget).B).toMatchObject({ text: '0.0', flagged: true });
      }
    }
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Spoken readings and the engine's clock                                                          */
/* ---------------------------------------------------------------------------------------------- */

const tr =
  (lang: Language): ClockTranslate =>
  (key, vars) =>
    translate(lang, key, vars);

describe('spoken byo-yomi readings (DESIGN 14.1)', () => {
  const g = playAll([['ee', 0], ['cc', 0]]);

  it('reads the period countdown and the periods left in all four languages', () => {
    const face = clockView(g, BY_0_5x30, 6_000).B;
    expect(face.text).toBe('0:24 ·5');
    expect(spokenClock(face, tr('en'))).toBe('24 seconds, 5 periods');
    expect(spokenClock(face, tr('de'))).toBe('24 Sekunden, 5 Perioden');
    expect(spokenClock(face, tr('fr'))).toBe('24 secondes, 5 périodes');
    expect(spokenClock(face, tr('es'))).toBe('24 segundos, 5 periodos');
  });

  it('says the last period and a single second, and the main time with its periods', () => {
    const last = clockView(g, BY_1_3x10, 60_000 + 20_000 + 8_500).B;
    expect(last.text).toBe('1.5 ·1');
    expect(spokenClock(last, tr('en'))).toBe('1 second, last period');
    expect(spokenClock(last, tr('de'))).toBe('1 Sekunde, letzte Periode');
    expect(spokenClock(last, tr('fr'))).toBe('1 seconde, dernière période');
    expect(spokenClock(last, tr('es'))).toBe('1 segundo, último periodo');
    const main = clockView(g, BY_1_3x10, 15_000).B;
    expect(spokenClock(main, tr('en'))).toBe('0:45, 3 periods');
  });

  it('leaves Fischer, clock off and out of time to the text', () => {
    expect(spokenClock(clockView(g, TC_1_0, 1000).B, tr('en'))).toBeUndefined();
    expect(spokenClock(clockView(g, null, 1000).B, tr('en'))).toBeUndefined();
    expect(spokenClock(clockView(g, BY_1_3x10, 90_000).B, tr('en'))).toBeUndefined();
  });

  it('withSpokenLabels puts the reading on both faces', () => {
    const v = withSpokenLabels(clockView(g, BY_0_5x30, 6_000), tr('en'));
    expect(v.B.label).toBe('24 seconds, 5 periods');
    expect(v.W.label).toBe('30 seconds, 5 periods');
    // Faces without a reading are passed through as they are.
    const fischer = clockView(g, TC_1_0, 0);
    const same: ClockFace = withSpokenLabels(fischer, tr('en')).B;
    expect(same).toBe(fischer.B);
    expect(same.label).toBeUndefined();
  });
});

describe('engineClock', () => {
  it('gives the side to move its clock at the start of the turn, once it is timed', () => {
    expect(engineClock(zengo.newGame(S9), '1m3x10')).toBeUndefined();
    const g = playAll([['ee', 0], ['cc', 0], ['gg', 65_000], ['cg', 0]]);
    expect(engineClock(g, '1m3x10')).toEqual({ tc: BY_1_3x10, left: { mainMs: 0, periodMs: 10_000, periods: 3 } });
    expect(engineClock(g, TC_3_2)).toEqual({ tc: TC_3_2, left: { mainMs: 180_000 - 65_000 + 2000, periodMs: 0, periods: 0 } });
    expect(engineClock(g, null)).toBeUndefined();
    expect(engineClock(timeout(g), TC_3_2)).toBeUndefined();
  });
});
