/**
 * Pure helpers behind the history list (DESIGN 12.2, Ztyle 10 "List card"): grouping by time,
 * the facts on each card (position, side to move, state), relative time and the room score.
 * No React.
 */
import { formatResult, fromRecord, makeSettings, newGame } from '@/lib/zigo';
import type { Color, Game, Language, Room, SavedGame, Size } from '@/lib/types';

const DAY = 24 * 60 * 60 * 1000;

/** Most recent games shown above the "N more games" button. */
export const RECENT_GAMES = 5;

export type HistoryGroup = 'today' | 'thisWeek' | 'thisMonth' | 'thisYear' | 'older';
export const HISTORY_GROUPS: readonly HistoryGroup[] = ['today', 'thisWeek', 'thisMonth', 'thisYear', 'older'];

/** Newest `lastPlayedAt` first, without changing the input. */
export function sortByRecent(games: readonly SavedGame[]): SavedGame[] {
  return [...games].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}

/** Group of a timestamp as Zudoku draws it: since local midnight, then 7 / 30 / 365 days before it. */
export function groupOf(time: number, now: number): HistoryGroup {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  if (time >= start) return 'today';
  if (time >= start - 7 * DAY) return 'thisWeek';
  if (time >= start - 30 * DAY) return 'thisMonth';
  if (time >= start - 365 * DAY) return 'thisYear';
  return 'older';
}

/** Non-empty groups in order, games newest first. */
export function groupByTime(games: readonly SavedGame[], now: number): { group: HistoryGroup; games: SavedGame[] }[] {
  const buckets = new Map<HistoryGroup, SavedGame[]>(HISTORY_GROUPS.map((g) => [g, []]));
  for (const g of sortByRecent(games)) buckets.get(groupOf(g.lastPlayedAt, now))!.push(g);
  return HISTORY_GROUPS.filter((g) => buckets.get(g)!.length > 0).map((group) => ({ group, games: buckets.get(group)! }));
}

const SIZES: readonly Size[] = [9, 13, 19];

/** The stored size, or 19 for a record that predates sizes or is damaged. */
export function sizeOf(game: Pick<SavedGame, 'size'>): Size {
  return SIZES.includes(game.size) ? game.size : 19;
}

/**
 * The game rebuilt from its record, as the card shows it: the final position (or the position at
 * the end of the stored plies), the side to move and the number of plies that replayed. Lenient:
 * a damaged move string stops at the last legal ply; an unreadable record gives the empty board.
 */
export function gameOf(game: SavedGame): Game {
  const size = sizeOf(game);
  const rules = game.rules === 'territory' ? 'territory' : 'area';
  const handicap = Number.isFinite(game.handicap) ? game.handicap : 0;
  try {
    return fromRecord(
      {
        size,
        rules,
        handicap,
        moves: typeof game.moves === 'string' ? game.moves : '',
        ms: Array.isArray(game.ms) ? game.ms : undefined,
        scoring: game.scoring,
        result: game.result,
      },
      { lenient: true },
    );
  } catch {
    return newGame(makeSettings(size, rules, 0));
  }
}

/** Plies (stones and passes) that replayed from the record. */
export function plyCount(game: SavedGame, g: Game = gameOf(game)): number {
  return g.cursor;
}

/**
 * Moves as Go counts them: every stone and every pass is one move (the move strip numbers plies,
 * `34. D4`, and the game-over summary says `54 moves`).
 */
export function moveCount(plies: number): number {
  return Math.max(0, plies);
}

/** Side to move after `plies` plies: Black first, White first with a handicap of 2 or more. */
export function sideToMove(plies: number, handicap = 0): Color {
  const first: Color = handicap >= 2 ? 'W' : 'B';
  if (plies % 2 === 0) return first;
  return first === 'B' ? 'W' : 'B';
}

/** What the state cell of a card says (DESIGN 12.2). */
export type CardState =
  | { kind: 'yourMove' }
  | { kind: 'theirMove' }
  | { kind: 'toMove'; color: Color }
  | { kind: 'scoring' }
  /** This device won; `margin2` (half points ×2) only for a scored game. */
  | { kind: 'won'; margin2?: number }
  | { kind: 'lost' }
  /** Pass-and-play: the result as `B+4.5`, `W+R`, `B+T` (`formatResult`, SGF `RE`). */
  | { kind: 'result'; text: string };

export function cardState(game: SavedGame, g: Game = gameOf(game)): CardState {
  const r = game.result;
  if (r) {
    if (game.mode === 'local') return { kind: 'result', text: formatResult(r) };
    if (r.winner !== game.color) return { kind: 'lost' };
    return r.by === 'score' && typeof r.margin === 'number' ? { kind: 'won', margin2: r.margin } : { kind: 'won' };
  }
  if (g.scoring || game.scoring) return { kind: 'scoring' };
  if (game.mode === 'local') return { kind: 'toMove', color: g.turn };
  return { kind: g.turn === game.color ? 'yourMove' : 'theirMove' };
}

/** `9×9`, `19×19 · JP` for territory rules (the size pill's label, DESIGN 4.1). */
export function sizeLabel(game: Pick<SavedGame, 'size' | 'rules'>): string {
  const n = sizeOf(game);
  return game.rules === 'territory' ? `${n}×${n} · JP` : `${n}×${n}`;
}

/** `2`, `1½`, `½` from half points ×2. */
export function formatPoints(halfPointsX2: number): string {
  const whole = Math.floor(halfPointsX2 / 2);
  const half = halfPointsX2 % 2 === 1;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

/** Room score from this device's seat first, `2 – 1` (DESIGN 4.2). */
export function formatRoomScore(room: Pick<Room, 'score' | 'seat'>): string {
  const mine = room.score[room.seat] ?? 0;
  const theirs = room.score[room.seat === 0 ? 1 : 0] ?? 0;
  return `${formatPoints(mine)} – ${formatPoints(theirs)}`;
}

/** The room record a room game belongs to, if this device still has it. */
export function roomOf(game: SavedGame, rooms: readonly Room[] | undefined): Room | undefined {
  if (game.mode !== 'room' || !rooms) return undefined;
  return rooms.find((r) => r.code === game.code || r.games.includes(game.id));
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Relative time in the UI language through `Intl.RelativeTimeFormat`: `now`, `5 min. ago`,
 * `3 hr. ago`, `yesterday`, `4 days ago`; from a week back the date (`Nov 3`, with the year when
 * it differs).
 */
export function formatRelativeTime(time: number, now: number, lang: Language): string {
  const diff = Math.max(0, now - time);
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
    if (diff < MINUTE) return rtf.format(0, 'second');
    if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute');
    if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour');
    if (diff < 7 * DAY) {
      // Calendar days, so "yesterday" means yesterday and not "24 hours ago".
      const a = new Date(now);
      a.setHours(0, 0, 0, 0);
      const b = new Date(time);
      b.setHours(0, 0, 0, 0);
      const days = Math.max(1, Math.round((a.getTime() - b.getTime()) / DAY));
      return rtf.format(-days, 'day');
    }
    const d = new Date(time);
    const sameYear = d.getFullYear() === new Date(now).getFullYear();
    return d.toLocaleDateString(lang, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return new Date(time).toISOString().slice(0, 10);
  }
}
