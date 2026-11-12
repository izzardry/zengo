/**
 * Pure helpers of the stage (pages/Index.tsx): what the board, strips, pill and overlay show for a
 * session. No React, no DOM, so they are unit-tested on their own.
 */
import { budgetMs, clockView, toTimeControl, type ClockView } from '@/lib/clock';
import { COMPUTER_ENABLED, flags } from '@/lib/flags';
import type { GameSession } from '@/lib/gameRecord';
import type { Color, Game, Mode, Point, TcString, TimeControl } from '@/lib/types';
import zigo, { isPass } from '@/lib/zigo';

/**
 * Milestone switch for rooms (milestone 3 sets it to true and plugs the room into `useGameState`'s
 * `onRoom`). Typed as a plain boolean so code can test it either way.
 */
export const ROOMS_ENABLED: boolean = false;

/**
 * Modes that can be started in this build. Milestone 2 turns `computer` on (`COMPUTER_ENABLED`),
 * milestone 3 turns on `room` (`ROOMS_ENABLED`). The Start pill answers a mode that is off with a
 * `Coming soon` toast (PLAN Integrator 1).
 */
export const PLAYABLE_MODES: Readonly<Record<Mode, boolean>> = {
  local: true,
  computer: COMPUTER_ENABLED && flags.computer,
  room: ROOMS_ENABLED && flags.rooms,
};

/** Duration of the start ⇄ game blur transition (Ztyle 07, Zudoku). */
export const TRANSITION_MS = 500;

/** Minimum horizontal travel of a swipe on the review board (px). */
export const SWIPE_MIN_PX = 40;

export const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

/**
 * The player whose strip is at the near edge: Black in pass-and-play (Black moves first; the
 * session's color is `B` there), the player's own side otherwise (DESIGN 5.1).
 */
export function nearColor(s: Pick<GameSession, 'mode' | 'color'>): Color {
  return s.mode === 'local' ? 'B' : s.color;
}

/** Every recorded ply of the live game as an SGF point, the redo tail included (move strip and list). */
export function allMoves(g: Game): Point[] {
  return g.plies.map((p) => p.m);
}

/** The color of the first ply: White in a handicap game, else Black. */
export function firstColor(g: Game): Color {
  return g.settings.handicap >= 2 ? 'W' : 'B';
}

/**
 * Which players' latest ply is a pass in the shown position (the strips' `passed` badge, DESIGN
 * 4.2): the trailing run of consecutive passes, so a stone by either side clears both badges.
 */
export function passedBadges(g: Game): Record<Color, boolean> {
  const out: Record<Color, boolean> = { B: false, W: false };
  for (let i = g.cursor - 1; i >= 0 && i >= g.cursor - 2; i--) {
    if (!isPass(g.plies[i].m)) break;
    out[zigo.colorOfPly(g, i)] = true;
  }
  return out;
}

/** The last ply before the cursor was a pass by the side not to move: the flag's dot (DESIGN 6.2). */
export function opponentPassed(g: Game): boolean {
  if (g.cursor === 0 || g.end || g.scoring) return false;
  return isPass(g.plies[g.cursor - 1].m);
}

/**
 * Time used by both sides up to the cursor (overlay summary, DESIGN 8.5). The log holds only played
 * plies, so a game lost on time (`tc` given) also counts the flagged turn: the whole time the loser
 * had left when it began. That follows from the log and the time control alone, so the live
 * overlay, a reload and a saved game all give the same duration.
 */
export function totalTime(g: Game, tc?: TimeControl | TcString | null): number {
  let ms = 0;
  for (let i = 0; i < g.cursor; i++) ms += g.plies[i].ms;
  const control = toTimeControl(tc);
  const result = g.end?.result;
  if (control && result?.by === 'time' && g.cursor === g.plies.length) {
    const loser = other(result.winner);
    ms += Math.max(0, budgetMs(zigo.clocks(g, control)[loser], control));
  }
  return ms;
}

/**
 * The strips' clocks in review (DESIGN 12.3): both clocks as they stood at the shown move, not
 * running. A finished game's review view carries the ending; before the last move it does not
 * apply, so it is dropped there (otherwise the loser on time would read `0.0` throughout).
 */
export function reviewClockView(view: Game, tc: TcString | null): ClockView {
  const g = view.end && view.cursor < view.plies.length ? { ...view, end: undefined } : view;
  return clockView(g, toTimeControl(tc), 0, { live: false });
}
