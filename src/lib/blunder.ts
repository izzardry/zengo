/**
 * Blunder guard rules (DESIGN 7.2), pure: no React, no engine, no timers.
 *
 * Against the computer, with helpers on, a stone the player commits is flagged (bounced) when:
 * - the score lead, from the player's view, drops by `scoreDropFor(size)` points or more (6 / 8 / 12
 *   on 9×9 / 13×13 / 19×19) AND the win rate drops by at least `WINRATE_DROP` (15 percentage
 *   points), comparing the cached "before" evaluation (player to move) with the "after" evaluation
 *   of the position after the stone (opponent to move) — `judgeEvals`;
 * - or the stone puts 3 or more of the player's own stones into atari where the opponent can capture
 *   at once (`selfAtariVerdict`, rules only, no engine). Single stones are never flagged (throw-ins,
 *   ko and snapback are often good); two-stone sacrifices are left alone too.
 *
 * The thresholds prefer a missed blunder to a false bounce (DESIGN 17, risk 5): both engine
 * conditions must hold, and a missing evaluation never flags.
 *
 * `isConfirmation` is the 5-second confirm window: the same stone in the same position again within
 * `CONFIRM_WINDOW_MS` of its refusal commits.
 */
import type { EngineEvaluation, Game, Point, Size } from './types';
import { isPass, selfAtariSize } from './zengo';

/** Score-lead drop (points, from the player's view) that flags a stone, by board size (DESIGN 7.2). */
export const SCORE_DROP: Readonly<Record<Size, number>> = Object.freeze({ 9: 6, 13: 8, 19: 12 });
/** …and at the same time the win rate must drop by at least this much (DESIGN 7.2: 15 points). */
export const WINRATE_DROP = 0.15;
/** A self-atari of this many own stones or more is flagged without the engine (DESIGN 7.2). */
export const SELF_ATARI_STONES = 3;
/** The check must finish within about this long after the stone, or it goes through (DESIGN 7.2). */
export const GUARD_BUDGET_MS = 150;
/** Placing a refused stone again within this window commits it (DESIGN 7.2). */
export const CONFIRM_WINDOW_MS = 5000;
/** Timeout of the "before" evaluation started when the player's turn begins (includes engine loading). */
export const BEFORE_TIMEOUT_MS = 15_000;

export type BlunderReason = 'drop' | 'self-atari';

export interface Verdict {
  readonly flag: boolean;
  readonly reason?: BlunderReason;
  /** Score-lead drop in points from the player's view (engine verdicts). */
  readonly scoreDrop?: number;
  /** Win-rate drop, 0..1 (engine verdicts). */
  readonly winrateDrop?: number;
  /** Own stones put into atari (self-atari verdicts). */
  readonly stones?: number;
}

const OK: Verdict = Object.freeze({ flag: false });

/** The score-lead drop that flags a stone on a `size` board. */
export function scoreDropFor(size: number): number {
  return SCORE_DROP[size as Size] ?? SCORE_DROP[19];
}

/** The part of an evaluation the guard reads. */
export type GuardEval = Pick<EngineEvaluation, 'winrate' | 'scoreLead'>;

/**
 * Verdict from two evaluations (both are from their own side to move, as the engine reports them).
 * @param before the position before the stone, the player to move (null: unknown → never flags).
 * @param after the position after the stone, the opponent to move (null: the engine was late → never flags).
 */
export function judgeEvals(size: number, before: GuardEval | null, after: GuardEval | null): Verdict {
  if (!before || !after) return OK;
  if (![before.winrate, before.scoreLead, after.winrate, after.scoreLead].every(Number.isFinite)) return OK;
  const scoreDrop = before.scoreLead - -after.scoreLead;
  const winrateDrop = before.winrate - (1 - after.winrate);
  const flag = scoreDrop >= scoreDropFor(size) && winrateDrop >= WINRATE_DROP;
  return flag ? { flag, reason: 'drop', scoreDrop, winrateDrop } : { flag, scoreDrop, winrateDrop };
}

/** Rules-only verdict: the stone puts `SELF_ATARI_STONES` or more own stones into capturable atari. */
export function selfAtariVerdict(g: Game, p: Point): Verdict {
  if (isPass(p)) return OK;
  const stones = selfAtariSize(g, p);
  return stones >= SELF_ATARI_STONES ? { flag: true, reason: 'self-atari', stones } : OK;
}

/* ------------------------------------------------------------------------------------------------
 * Confirm window
 * --------------------------------------------------------------------------------------------- */

/** The last refused stone: the position it was refused in, its point and when. */
export interface Refusal {
  /** Position key (`guardKey`). */
  readonly key: string;
  readonly point: Point;
  readonly at: number;
}

/** True when `point` in position `key` repeats the refused stone within `windowMs` of its refusal: commit it. */
export function isConfirmation(r: Refusal | null, key: string, point: Point, now: number, windowMs = CONFIRM_WINDOW_MS): boolean {
  return !!r && r.key === key && r.point === point && now - r.at >= 0 && now - r.at <= windowMs;
}

/** Identity of a position for the guard: the cursor and the plies up to it. */
export function guardKey(g: Game): string {
  let s = `${g.cursor}:`;
  for (let i = 0; i < g.cursor; i++) s += g.plies[i].m;
  return s;
}
