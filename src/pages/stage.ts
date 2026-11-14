/**
 * Pure helpers of the stage (pages/Index.tsx): what the board, strips, pill and overlay show for a
 * session. No React, no DOM, so they are unit-tested on their own.
 */
import { budgetMs, clockView, toTimeControl, type ClockView } from '@/lib/clock';
import type { EngineOfflineStatus } from '@/lib/engine/offline';
import { COMPUTER_ENABLED, flags } from '@/lib/flags';
import type { GameSession } from '@/lib/gameRecord';
import { needsLargeNet } from '@/lib/levels';
import type { Color, EngineApi, Game, Mode, Point, TcString, TimeControl } from '@/lib/types';
import zengo, { isPass } from '@/lib/zengo';

/**
 * Milestone switch for rooms (milestone 3 turned it on; `useGameState` runs the room with its
 * `rooms` option). Typed as a plain boolean so code can test it either way.
 */
export const ROOMS_ENABLED: boolean = true;

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

/** The engine exists in this build: the computer, the hint, the guard and the scoring proposal use it. */
export const ENGINE_ON: boolean = COMPUTER_ENABLED && flags.computer;

/**
 * Start (or Resume) of a computer game while offline (DESIGN 14): when the networks the level
 * needs are neither loaded nor cached, the Start pill does nothing and the status line says why
 * (`Computer needs a connection`, `Levels 8–12 need a connection`). Online, or while the cache is
 * still being checked or cannot be read, the start goes ahead and loading decides.
 */
export function engineStartBlocked(
  level: number,
  online: boolean,
  stage1: EngineOfflineStatus,
  stage2: EngineOfflineStatus,
  nets: EngineApi['nets'],
): boolean {
  if (online) return false;
  const large = needsLargeNet(level);
  if (nets.small && (!large || nets.large)) return false;
  const absent = (s: EngineOfflineStatus) => s.status === 'missing' || s.status === 'downloading';
  return (!nets.small && absent(stage1)) || (large && !nets.large && absent(stage2));
}

/** The calibration table `scripts/calibrate.mjs --write` produces (`src/lib/ranks.json`). */
export interface RankTable {
  readonly size?: number;
  readonly ranks?: Readonly<Record<string, string>>;
}

/** `src/lib/ranks.json` when calibration has written it; an empty table otherwise. */
const rankFiles = import.meta.glob<RankTable>('../lib/ranks.json', { eager: true, import: 'default' });
export const RANKS: RankTable = Object.values(rankFiles)[0] ?? {};

/**
 * The faint rank line under a computer level (DESIGN 4.1, 10.2): `≈12k` for a level calibrated on
 * 19×19, else null. Ranks measured on a smaller board are not shown: DESIGN 10.2 gives 19×19 strength.
 */
export function rankLabel(level: number, table: RankTable = RANKS): string | null {
  if (table.size !== 19) return null;
  const raw = table.ranks?.[String(level)];
  const rank = typeof raw === 'string' ? raw.replace(/^≈/, '') : '';
  return /^\d{1,2}[kd]$/.test(rank) ? `≈${rank}` : null;
}

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
    out[zengo.colorOfPly(g, i)] = true;
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
    ms += Math.max(0, budgetMs(zengo.clocks(g, control)[loser], control));
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
