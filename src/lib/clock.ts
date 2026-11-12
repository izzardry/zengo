/**
 * Game clock math (DESIGN 11, 9.7). Pure: no React, no DOM, time is passed in.
 *
 * The clock is never accumulated from ticks. Each side's clock is derived from the ply log
 * (`zigo.clocks`: Fischer increment or byo-yomi periods, each side's first move untimed) and the
 * side to move's running turn is applied on top. The running turn is measured by a `TurnTimer`:
 * the ms already used plus the monotonic stamp (`performance.now()` in the app) at which it last
 * (re)started. A throttled background tab therefore cannot drift, and undo / redo restore the
 * clocks by themselves, because they move the cursor and the log is the truth.
 *
 * Clocks stop during scoring (DESIGN 8.4) and after the end.
 *
 * Japanese byo-yomi (DESIGN 11): main time, then P periods of S seconds. A move made inside a period
 * keeps it, each full period overrun uses one up, and time is up when the last period reads zero.
 * One rule (`byoyomiPeriodsLeft` in `lib/zigo.ts`) drives both the log (`byoyomiStep`, via
 * `zigo.clocks`) and the running turn (`liveClock`), so the live face, the flag and the clock after
 * the move always agree. `clock.test.ts` checks this against a tick-by-tick simulation.
 */
import { formatClock, formatElapsed, isLowTime } from './timeUtils';
import type { ClockInfo, ClockState, Color, Game, TcString, TimeControl } from './types';
import { byoyomiPeriodsLeft, clockRunning, clocks, encodeMoves, toTc } from './zigo';

const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

/* ---------------------------------------------------------------------------------------------- */
/* Time controls                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/**
 * A time control in either form (object, `5+7`, `20m5x30`, null / `off`) → `TimeControl`.
 * A Fischer control without base time and a byo-yomi control without periods are off.
 */
export function toTimeControl(tc: TimeControl | TcString | null | undefined): TimeControl {
  const t = toTc(tc);
  if (!t) return null;
  if (t.kind === 'fischer') return t.baseMs > 0 ? t : null;
  return t.periods >= 1 && t.periodMs > 0 ? t : null;
}

/** A stable text key of a time control (for memoizing on value, not identity). */
export function tcKey(tc: TimeControl | TcString | null | undefined): string | null {
  if (tc === null || tc === undefined) return null;
  if (typeof tc === 'string') return tc;
  return tc.kind === 'fischer' ? `f${tc.baseMs}+${tc.incMs}` : `b${tc.baseMs}m${tc.periods}x${tc.periodMs}`;
}

/**
 * Identity of the position at the cursor: the plies applied so far. A move, undo, redo or takeback
 * changes it, so it marks a new turn (`useClock`, `lib/turnBank.ts`).
 */
export function positionKey(g: Game): string {
  return `${g.cursor}:${encodeMoves(g.plies.slice(0, g.cursor))}`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Turn timer                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Time spent on the running turn: `used` ms banked before the last pause plus `now - since`
 * while running. `since === null` = paused. Immutable; every operation returns a new value.
 */
export interface TurnTimer {
  readonly used: number;
  readonly since: number | null;
}

/** A fresh turn: nothing used; running from `at` when `running`, else paused. */
export function timerReset(running: boolean, at: number, used = 0): TurnTimer {
  return { used: Math.max(0, used), since: running ? at : null };
}

/** Starts or resumes the timer at `at`. A running timer is returned unchanged. */
export function timerResume(t: TurnTimer, at: number): TurnTimer {
  return t.since === null ? { used: t.used, since: at } : t;
}

/** Pauses the timer at `at`, banking the time since it last started. A paused timer is unchanged. */
export function timerPause(t: TurnTimer, at: number): TurnTimer {
  return t.since === null ? t : { used: t.used + Math.max(0, at - t.since), since: null };
}

/** Pauses or resumes to match `running`. */
export function timerSet(t: TurnTimer, running: boolean, at: number): TurnTimer {
  return running ? timerResume(t, at) : timerPause(t, at);
}

/** Ms spent on the running turn at `at`. Never negative (a clock that went backwards counts 0). */
export function timerElapsed(t: TurnTimer, at: number): number {
  return Math.max(0, t.used + (t.since !== null ? Math.max(0, at - t.since) : 0));
}

/* ---------------------------------------------------------------------------------------------- */
/* Remaining time and flag                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/**
 * True when the side to move's clock counts down now: a clock is set, the game is neither scoring
 * nor over, and that side has already moved once (its first move is untimed, BUILD-LOG 0b).
 */
export function isCounting(g: Game, tc: TimeControl): boolean {
  return !!tc && !g.end && !g.scoring && clockRunning(g);
}

/**
 * Ms a clock state can still spend before its flag falls: Fischer the main time; byo-yomi the main
 * time plus every period left (a state from the log offers full periods).
 */
export function budgetMs(s: ClockState, tc: NonNullable<TimeControl>): number {
  return tc.kind === 'fischer' ? s.mainMs : s.mainMs + s.periods * tc.periodMs;
}

/**
 * One side's clock `spent` ms into its running turn, from its state at the start of the turn.
 * Fischer: main time minus `spent` (negative past the flag). Byo-yomi: main time first, then the
 * periods (`byoyomiPeriodsLeft`); `periodMs` is what is left of the current period and `periods`
 * counts it; out of time is all zeros.
 */
export function liveClock(base: ClockState, tc: NonNullable<TimeControl>, spent: number): ClockState {
  const t = Math.max(0, spent);
  if (tc.kind === 'fischer') return { mainMs: base.mainMs - t, periodMs: 0, periods: 0 };
  const main = Math.max(0, base.mainMs);
  if (t <= main && base.periods > 0) return { mainMs: main - t, periodMs: tc.periodMs, periods: base.periods };
  const over = t - main;
  const periods = byoyomiPeriodsLeft(base.periods, tc.periodMs, over);
  if (periods <= 0) return { mainMs: 0, periodMs: 0, periods: 0 };
  // Periods used so far end at (used) × S; the current one ends one period later.
  const used = base.periods - periods;
  return { mainMs: 0, periodMs: (used + 1) * tc.periodMs - over, periods };
}

/**
 * Each side's clock at the cursor with `turnMs` spent by the side to move on the running turn
 * (only while `isCounting`). Clock off: `mainMs` is the time used, the running turn included.
 * After the game ended or while scoring, `turnMs` is ignored.
 */
export function clockStates(g: Game, tc: TimeControl, turnMs: number): Record<Color, ClockState> {
  const base = clocks(g, tc);
  const spent = Math.max(0, turnMs);
  if (g.end || g.scoring || spent === 0) return base;
  if (!tc) return { ...base, [g.turn]: { ...base[g.turn], mainMs: base[g.turn].mainMs + spent } };
  if (!clockRunning(g)) return base;
  return { ...base, [g.turn]: liveClock(base[g.turn], tc, spent) };
}

/**
 * Remaining ms per side before the flag (timed) or ms used per side (clock off), at the cursor,
 * with `turnMs` spent by the side to move on the running turn. Timed values are not clamped: a side
 * past its flag reads negative, which `flagged` and the 2-second room grace need (DESIGN 9.7).
 * After the game ended or while scoring `turnMs` is ignored.
 */
export function remaining(g: Game, tc: TimeControl, turnMs: number): Record<Color, number> {
  const base = clocks(g, tc);
  const spent = Math.max(0, turnMs);
  if (!tc) {
    const used = { B: base.B.mainMs, W: base.W.mainMs };
    if (!g.end && !g.scoring) used[g.turn] += spent;
    return used;
  }
  const left = { B: budgetMs(base.B, tc), W: budgetMs(base.W, tc) };
  if (isCounting(g, tc)) left[g.turn] -= spent;
  return left;
}

/** The side whose flag has fallen at this moment (timed, live game, ≤ 0 left), else null. */
export function flagged(g: Game, tc: TimeControl, turnMs: number): Color | null {
  if (!isCounting(g, tc)) return null;
  return remaining(g, tc, turnMs)[g.turn] <= 0 ? g.turn : null;
}

/**
 * Ms of running turn left before the side to move flags (≥ 0), or null when no clock counts.
 * Lets a caller schedule one exact timeout instead of polling.
 */
export function msUntilFlag(g: Game, tc: TimeControl, turnMs: number): number | null {
  if (!isCounting(g, tc)) return null;
  return Math.max(0, remaining(g, tc, turnMs)[g.turn]);
}

/* ---------------------------------------------------------------------------------------------- */
/* Display                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/**
 * What one clock shows (DESIGN 11, 14.1). A superset of `StripClock` of the player strip, so it can
 * be passed to `PlayerStrip` as is.
 */
export interface ClockFace {
  /**
   * Fischer and byo-yomi main time: `m:ss`, below 10 s `s.t`. In byo-yomi periods: the period
   * countdown and the periods left, `0:24 ·3`. `0.0` at zero. Clock off: time used, `m:ss` / `h:mm:ss`.
   */
  readonly text: string;
  /** This clock counts down right now (drawn on a light chip). False with the clock off. */
  readonly running: boolean;
  /** The countdown shown is below 10 s: bold and tenths (DESIGN 11). */
  readonly low: boolean;
  /** At zero or lost on time: `0.0` in `destructive`. */
  readonly flagged: boolean;
  /** Clock off: the face shows time used, dimmed. */
  readonly untimed: boolean;
  /** The countdown shown (main time or what is left of the period), clamped at 0; time used with the clock off. */
  readonly ms: number;
  /** Byo-yomi: periods left (the current one included); null for Fischer and clock off. */
  readonly periods: number | null;
  /** Byo-yomi: the side is in its periods (main time used up). */
  readonly overtime: boolean;
  /**
   * Spoken reading for `role="timer"` (DESIGN 14.1), e.g. `24 seconds, 3 periods`; set by
   * `withSpokenLabels` (byo-yomi only). `PlayerStrip` reads it instead of the abbreviated text.
   */
  readonly label?: string;
}

/** Both clocks plus what the page needs to act on them. */
export interface ClockView {
  readonly B: ClockFace;
  readonly W: ClockFace;
  /** A clock is set. */
  readonly timed: boolean;
  /** The side to move's clock counts down now. */
  readonly counting: boolean;
  /** The side out of time right now (live) or the side that lost on time (game over), else null. */
  readonly flagged: Color | null;
}

export interface ClockViewOptions {
  /**
   * The turn is being timed now (a live game on screen, not paused, not hidden). Only changes the
   * `running` chip: a paused clock still shows the time already spent on the turn.
   */
  readonly live?: boolean;
}

const FLAGGED_FACE = { text: '0.0', low: true, flagged: true, untimed: false, ms: 0, overtime: false } as const;

/** The face of a clock state under a time control. Never `running` or `flagged`: `clockView` decides those. */
export function faceOf(s: ClockState, tc: TimeControl): ClockFace {
  if (!tc) {
    const ms = Math.max(0, s.mainMs);
    return { text: formatElapsed(ms), running: false, low: false, flagged: false, untimed: true, ms, periods: null, overtime: false };
  }
  if (tc.kind === 'fischer') {
    const ms = Math.max(0, s.mainMs);
    return { text: formatClock(ms), running: false, low: isLowTime(ms), flagged: false, untimed: false, ms, periods: null, overtime: false };
  }
  if (s.mainMs > 0) {
    return { text: formatClock(s.mainMs), running: false, low: isLowTime(s.mainMs), flagged: false, untimed: false, ms: s.mainMs, periods: s.periods, overtime: false };
  }
  if (s.periods <= 0) return { ...FLAGGED_FACE, flagged: false, running: false, periods: 0, overtime: true };
  const ms = Math.max(0, s.periodMs);
  return {
    text: `${formatClock(ms)} ·${s.periods}`,
    running: false,
    low: isLowTime(ms),
    flagged: false,
    untimed: false,
    ms,
    periods: s.periods,
    overtime: true,
  };
}

/** The faces before any move: the base time (timed) or nothing used. */
export function initialFace(tc: TimeControl): ClockFace {
  if (!tc) return faceOf({ mainMs: 0, periodMs: 0, periods: 0 }, null);
  if (tc.kind === 'fischer') return faceOf({ mainMs: tc.baseMs, periodMs: 0, periods: 0 }, tc);
  return faceOf({ mainMs: tc.baseMs, periodMs: tc.periodMs, periods: tc.periods }, tc);
}

/**
 * Display state of both clocks for a game at its cursor (DESIGN 11): remaining time with a clock,
 * time used without one. A game lost on time shows `0.0` on the losing side even though the
 * overrun of the last turn is not in the log.
 */
export function clockView(g: Game, tc: TimeControl, turnMs: number, opts: ClockViewOptions = {}): ClockView {
  const live = opts.live ?? true;
  const states = clockStates(g, tc, turnMs);
  const left = remaining(g, tc, turnMs);
  const timed = !!tc;
  const counting = isCounting(g, tc);
  const result = g.end?.result;
  const lostOnTime: Color | null = result?.by === 'time' ? other(result.winner) : null;
  const liveFlag = counting && left[g.turn] <= 0 ? g.turn : null;
  const face = (c: Color): ClockFace => {
    if (!timed) return faceOf(states[c], tc);
    if (lostOnTime === c || liveFlag === c) return { ...FLAGGED_FACE, running: false, periods: tc!.kind === 'byoyomi' ? 0 : null };
    return { ...faceOf(states[c], tc), running: live && counting && g.turn === c };
  };
  return { B: face('B'), W: face('W'), timed, counting, flagged: lostOnTime ?? liveFlag };
}

/**
 * Display tick interval: tenths matter only below 10 s, but a 100 ms tick keeps the `m:ss`
 * seconds change on time too. With the clock off the face shows whole seconds.
 */
export function tickInterval(tc: TimeControl): number {
  return tc ? 100 : 250;
}

/* ---------------------------------------------------------------------------------------------- */
/* Spoken readings (DESIGN 14.1)                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/** The translator `withSpokenLabels` needs: `t` of `useI18n`, limited to the clock table. */
export type ClockTranslate = (
  key: 'clock.seconds' | 'clock.secondOne' | 'clock.periods' | 'clock.lastPeriod' | 'clock.spoken',
  vars?: Record<string, string | number>,
) => string;

/**
 * What a screen reader says for a byo-yomi face: in the periods `24 seconds, 3 periods` (the
 * countdown in whole seconds, as shown, and the periods left), `7 seconds, last period`; in the
 * main time `4:31, 3 periods`. Undefined where the text reads well as it is (Fischer, clock off,
 * out of time).
 */
export function spokenClock(face: ClockFace, t: ClockTranslate): string | undefined {
  if (face.periods === null || face.flagged || face.untimed || face.periods <= 0) return undefined;
  const periods = face.periods === 1 ? t('clock.lastPeriod') : t('clock.periods', { n: face.periods });
  if (!face.overtime) return t('clock.spoken', { time: face.text, periods });
  const secs = Math.floor(Math.max(0, face.ms) / 1000);
  const time = secs === 1 ? t('clock.secondOne') : t('clock.seconds', { n: secs });
  return t('clock.spoken', { time, periods });
}

/** `view` with the spoken reading on both faces (`ClockFace.label`). */
export function withSpokenLabels<V extends ClockView>(view: V, t: ClockTranslate): V {
  const label = (f: ClockFace): ClockFace => {
    const spoken = spokenClock(f, t);
    return spoken === f.label ? f : { ...f, label: spoken };
  };
  return { ...view, B: label(view.B), W: label(view.W) };
}

/* ---------------------------------------------------------------------------------------------- */
/* The engine's clock                                                                              */
/* ---------------------------------------------------------------------------------------------- */

/**
 * What the computer is told about its own clock when it moves for the side to move
 * (`EngineApi.genmove`): the clock at the start of the turn from the log. Undefined without a
 * clock, before that side's first move (untimed), during scoring and after the end.
 */
export function engineClock(g: Game, tc: TimeControl | TcString | null | undefined): ClockInfo | undefined {
  const t = toTimeControl(tc);
  if (!t || !isCounting(g, t)) return undefined;
  return { tc: t, left: clocks(g, t)[g.turn] };
}
