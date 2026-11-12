/**
 * The running game clock (DESIGN 11, 9.7) as a React hook.
 *
 * `useClock` times the running turn with monotonic stamps (`performance.now()`), never by counting
 * ticks, and derives both clocks from the move log (`lib/clock.ts`: Fischer or byo-yomi). A ~100 ms
 * display tick runs only while the turn is timed. In solo modes the turn pauses while the tab is
 * hidden and while the caller says `paused` (Back / leave), and resumes on return. Clocks stop
 * during scoring and after the end. Undo / redo restore the clocks by themselves: the log is the
 * truth and a new position starts a new turn.
 *
 * The page passes `clock.elapsed()` as the `ms` of each stone or pass, and `onFlag` ends the game on
 * time; it fires once per turn.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clockView,
  initialFace,
  positionKey,
  remaining,
  tcKey as keyOfTc,
  tickInterval,
  timerElapsed,
  timerReset,
  timerSet,
  toTimeControl,
  type ClockView,
  type TurnTimer,
} from '@/lib/clock';
import type { Color, Game, Now, TcString, TimeControl } from '@/lib/types';

/** A running turn measured elsewhere (room controller, DESIGN 9.7): `RoomSnapshot.clock`. */
export interface ExternalTurn {
  /** `now()` stamp at which the side to move's turn (re)started; null while paused. */
  readonly turnStart: number | null;
  /** What that side had already used in this turn before the last pause. */
  readonly turnUsed: number;
}

export interface UseClockOptions {
  /**
   * The game is on screen and playable: phase `playing`, not review, not the start screen.
   * Default true. False pauses the turn (it resumes, with the time already spent, on return).
   * Scoring and the end pause it anyway.
   */
  readonly active?: boolean;
  /** Explicit pause, e.g. while the player has left the game with Back. Default false. */
  readonly paused?: boolean;
  /** Pause while the tab is hidden (solo modes, DESIGN 11). Default true; pass false in rooms. */
  readonly pauseWhenHidden?: boolean;
  /** Session identity (game id or room code + game number). A change starts a fresh turn. */
  readonly key?: string | null;
  /** Monotonic clock in ms. Default `performance.now()`. Must match `external`'s stamps. */
  readonly now?: Now;
  /** The side to move ran out of time. Fires once per turn, only while the turn is timed. */
  readonly onFlag?: (color: Color) => void;
  /**
   * Room (DESIGN 9.7): this device's color. The opponent's flag is only reported once their clock
   * has read zero for `opponentGraceMs` (default 2000); this device's own flag fires at zero.
   * Leave unset in solo modes (both flags fire at zero).
   */
  readonly ownColor?: Color;
  readonly opponentGraceMs?: number;
  /**
   * Room: the running turn as the room controller keeps it. When given, the hook does not time
   * the turn itself (no visibility or pause handling) and only displays and flags.
   */
  readonly external?: ExternalTurn | null;
  /** Ms already spent on the current turn when it first appears (e.g. restored after a reload). */
  readonly initialTurnMs?: number;
  /** Display tick override in ms. Default 100 with a clock, 250 without. */
  readonly tickMs?: number;
}

export interface GameClock extends ClockView {
  /**
   * Ms the side to move has spent on the running turn, read now. Pass it as the `ms` of the move
   * being made (player or computer). Works with the clock off too (time used is always recorded).
   */
  elapsed(): number;
  /** The running turn is being timed now (live, not paused, tab visible in solo modes). */
  readonly ticking: boolean;
  /** `elapsed()` as of this render. */
  readonly turnMs: number;
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Identity of a turn: a new position (move, pass, undo, redo, takeback) or another session starts a new one. */
function turnKeyOf(game: Game | null, key: string | null | undefined): string {
  return game ? `${key ?? ''}|${positionKey(game)}` : `${key ?? ''}|-`;
}

/** Faces for "no game": the base time (timed) or nothing used. */
function emptyView(tc: TimeControl): ClockView {
  const face = initialFace(tc);
  return { B: face, W: face, timed: !!tc, counting: false, flagged: null };
}

/**
 * Game clock for `game` under `tc` (object, `5+7` / `20m5x30` string or null = clock off).
 * Returns both faces (ready for `PlayerStrip`'s `clock` prop), the flag, and `elapsed()`.
 */
export function useClock(game: Game | null, tcIn: TimeControl | TcString | null, opts: UseClockOptions = {}): GameClock {
  const {
    active = true,
    paused = false,
    pauseWhenHidden = true,
    key = null,
    onFlag,
    ownColor,
    opponentGraceMs = 2000,
    external = null,
    initialTurnMs = 0,
  } = opts;
  const tcKey = keyOfTc(tcIn);
  // Normalized once per distinct value so effects do not re-run on a new object each render.
  const tcRef = useRef<{ key: string | null; tc: TimeControl }>({ key: null, tc: null });
  if (tcRef.current.key !== tcKey) tcRef.current = { key: tcKey, tc: toTimeControl(tcIn) };
  const tc = tcRef.current.tc;

  const nowRef = useRef<Now>(opts.now ?? defaultNow);
  nowRef.current = opts.now ?? defaultNow;
  const onFlagRef = useRef(onFlag);
  onFlagRef.current = onFlag;

  const [hidden, setHidden] = useState(documentHidden);
  const [, setTick] = useState(0);

  const live = active && !!game && !game.end && !game.scoring;
  const running = live && !paused && !(pauseWhenHidden && hidden);

  /* ---- own turn timer (solo modes) ---- */
  const turnKey = turnKeyOf(game, key);
  const timer = useRef<{ key: string; session: string | null; hadGame: boolean; t: TurnTimer } | null>(null);
  const at = nowRef.current();
  const prev = timer.current;
  if (!prev || prev.key !== turnKey) {
    // The first turn seen of a session may carry time spent before (a reload).
    const firstOfSession = !prev || prev.session !== key || !prev.hadGame;
    timer.current = {
      key: turnKey,
      session: key,
      hadGame: !!game,
      t: timerReset(running, at, firstOfSession && game ? initialTurnMs : 0),
    };
  } else {
    timer.current = { ...prev, t: timerSet(prev.t, running, at) };
  }

  const externalRef = useRef(external);
  externalRef.current = external;

  const elapsed = useCallback((): number => {
    const ext = externalRef.current;
    const t = nowRef.current();
    if (ext) return Math.max(0, ext.turnUsed + (ext.turnStart !== null ? Math.max(0, t - ext.turnStart) : 0));
    return timer.current ? timerElapsed(timer.current.t, t) : 0;
  }, []);

  const ticking = external ? live && external.turnStart !== null : running;

  /* ---- tab visibility: bank the turn at the exact moment the tab hides ---- */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      const isHidden = documentHidden();
      const cur = timer.current;
      if (cur && pauseWhenHidden) {
        const t = nowRef.current();
        // Hidden: pause now. Visible: resume now unless something else holds the clock.
        if (isHidden) timer.current = { ...cur, t: timerSet(cur.t, false, t) };
        else if (live && !paused) timer.current = { ...cur, t: timerSet(cur.t, true, t) };
      }
      setHidden(isHidden);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pauseWhenHidden, live, paused]);

  /* ---- display tick, only while timed ---- */
  const every = opts.tickMs ?? tickInterval(tc);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), every);
    return () => clearInterval(id);
  }, [ticking, every]);

  /* ---- view ---- */
  const turnMs = elapsed();
  const view = game ? clockView(game, tc, turnMs, { live: ticking }) : emptyView(tc);

  /* ---- flag: once per turn ---- */
  let flagNow: Color | null = null;
  if (game && ticking && view.counting) {
    const left = remaining(game, tc, turnMs)[game.turn];
    const grace = ownColor && game.turn !== ownColor ? Math.max(0, opponentGraceMs) : 0;
    if (left <= -grace) flagNow = game.turn;
  }
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!flagNow || fired.current === turnKey) return;
    fired.current = turnKey;
    onFlagRef.current?.(flagNow);
  }, [flagNow, turnKey]);

  return { ...view, ticking, turnMs, elapsed };
}
