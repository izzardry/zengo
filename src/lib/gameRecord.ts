/**
 * Pure game-session logic behind `useGameState` and `useSavedGames` (DESIGN 4.1, 6.2, 8.3, 8.4,
 * 10.3, 12, 13).
 *
 * No React, no DOM, no storage: every function takes what it needs (including `now`) and returns a
 * new value, so the rules are tested here without rendering anything. The rules of Go themselves
 * are in `lib/zigo.ts`, counting in `lib/scoring.ts`.
 */
import { generateCode } from './codes';
import scoringApi from './scoring';
import type {
  Color,
  ColorChoice,
  Game,
  Mode,
  Opponent,
  Ply,
  Point,
  Result,
  Rng,
  Rules,
  SavedGame,
  Scoring,
  Settings,
  Size,
  TcString,
} from './types';
import { normalizeTc } from './url';
import zigo, { PASS, isPass, makeSettings, normalizeHandicap } from './zigo';

/* ---------------------------------------------------------------------------------------------- */
/* Settings                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** Default computer level (DESIGN 10.2). */
export const DEFAULT_LEVEL = 5;
/** First-run opponent: `COMPUTER 5 MEDIUM` (DESIGN 4.1). */
export const DEFAULT_OPPONENT: Opponent = Object.freeze({ mode: 'computer', level: DEFAULT_LEVEL });
/** First-run board size (DESIGN 4.1). */
export const DEFAULT_SIZE: Size = 9;
/** Time a resumed game must stay open before its "last played" time moves (DESIGN 12.1, Ztyle 11). */
export const LAST_PLAYED_DELAY_MS = 15_000;
/** History cards shown before `N more games` (DESIGN 12.2). */
export const RECENT_COUNT = 5;

/** The three settings every game has beyond the opponent (DESIGN 3). */
export interface GameSettings {
  readonly size: Size;
  readonly rules: Rules;
  /** 0 or 2–9 (2–5 on 9×9). */
  readonly handicap: number;
}

/** The rules core's settings (komi from the rules and handicap, DESIGN 8.2). */
export function settingsOf(s: GameSettings): Settings {
  return makeSettings(s.size, s.rules, s.handicap);
}

/** A level as an integer 1–12, or undefined. */
export function clampLevel(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return n >= 1 && n <= 12 ? n : undefined;
}

/** Validates a stored opponent value (`zigo:opponent`); anything unreadable is the default. */
export function parseOpponent(v: unknown): Opponent {
  if (typeof v === 'object' && v !== null) {
    const o = v as { mode?: unknown; level?: unknown };
    if (o.mode === 'room') return { mode: 'room' };
    if (o.mode === 'local') return { mode: 'local' };
    if (o.mode === 'computer') return { mode: 'computer', level: clampLevel(o.level) ?? DEFAULT_LEVEL };
  }
  return DEFAULT_OPPONENT;
}

/** Validates a stored color choice (`zigo:color`): `random`, `B` or `W`. Default random. */
export function parseColorChoice(v: unknown): ColorChoice {
  return v === 'B' || v === 'W' ? v : 'random';
}

/** Value that means "clock off" in the clock preference. */
export const CLOCK_OFF = 'off';

/** Validates a time control (`5+7`, `20m5x30`): normalized, or null for off and anything else. */
export function parseClockPref(v: unknown): TcString | null {
  return typeof v === 'string' ? (normalizeTc(v) ?? null) : null;
}

/** True for computer and pass-and-play. */
export function isSolo(o: Opponent | Mode): boolean {
  const mode = typeof o === 'string' ? o : o.mode;
  return mode !== 'room';
}

/** The opponent selector value that describes a game. */
export function opponentOf(g: { mode: Mode; level?: number }): Opponent {
  if (g.mode === 'room') return { mode: 'room' };
  if (g.mode === 'local') return { mode: 'local' };
  return { mode: 'computer', level: clampLevel(g.level) ?? DEFAULT_LEVEL };
}

/** This device's side for a new game: pass-and-play is always Black (DESIGN 12.1); random flips a coin. */
export function resolveColor(choice: ColorChoice, mode: Mode, rng: Rng): Color {
  if (mode === 'local') return 'B';
  if (choice === 'B' || choice === 'W') return choice;
  return rng() < 0.5 ? 'B' : 'W';
}

/** A fresh code that no stored game uses yet (as its code or id). */
export function freshCode(games: readonly SavedGame[], rng: Rng): string {
  const taken = new Set<string>();
  for (const g of games) {
    taken.add(g.code);
    taken.add(g.id);
  }
  for (let i = 0; i < 50; i++) {
    const c = generateCode(rng);
    if (!taken.has(c)) return c;
  }
  return generateCode(rng);
}

/**
 * The size a game link means when it has no `n`: the smallest board every move of `moves` fits
 * on, or `fallback` without moves. Links always carry `n`; this only keeps a hand-cut link usable.
 */
export function sizeForMoves(moves: string, fallback: Size): Size {
  const points = zigo.decodeMoves(moves).filter((p) => !isPass(p));
  if (points.length === 0) return fallback;
  let max = 0;
  for (const p of points) max = Math.max(max, p.charCodeAt(0) - 97, p.charCodeAt(1) - 97);
  return max < 9 ? 9 : max < 13 ? 13 : 19;
}

const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

/* ---------------------------------------------------------------------------------------------- */
/* Undo / redo rules (DESIGN 4.2, 10.3)                                                             */
/* ---------------------------------------------------------------------------------------------- */

/**
 * How the undo slot behaves in a mode:
 * - `ply`: pass-and-play, one move (a stone or a pass) back;
 * - `turn`: against the computer, one full turn (the computer's reply and the player's move);
 * - `request`: in a room, a takeback request (handled by the room controller, not here).
 */
export type UndoRule = 'ply' | 'turn' | 'request';

export function undoRuleFor(mode: Mode): UndoRule {
  return mode === 'local' ? 'ply' : mode === 'computer' ? 'turn' : 'request';
}

/** Side to move after `cursor` plies of `g`. */
export function turnAt(g: Game, cursor: number): Color {
  return zigo.colorOfPly(g, cursor);
}

/**
 * Cursor that undo goes back to, or `g.cursor` when there is nothing to undo. Passes are plies
 * like stones; undoing the second pass leaves scoring (`lib/zigo.ts`).
 * - `ply`: one back.
 * - `turn` (player `color`): back to the latest earlier position where the player is to move, so
 *   a computer reply and the player's move go together; when the computer is still thinking, only
 *   the player's move. When there is none (the player undoes the very first turn while the
 *   computer moved first), back to the start, and the computer moves again (DESIGN 10.3).
 * - `request`: no local undo.
 */
export function undoTarget(g: Game, rule: UndoRule, color: Color): number {
  if (g.cursor === 0 || rule === 'request') return g.cursor;
  if (rule === 'ply') return g.cursor - 1;
  for (let c = g.cursor - 1; c >= 0; c--) if (turnAt(g, c) === color) return c;
  return 0;
}

/**
 * Cursor that redo goes forward to along the redo tail, or `g.cursor` when there is none.
 * `turn` replays both plies of a turn: forward to the next position where the player is to move,
 * or to the end of the tail.
 */
export function redoTarget(g: Game, rule: UndoRule, color: Color): number {
  const max = g.plies.length;
  if (g.cursor >= max || rule === 'request') return g.cursor;
  if (rule === 'ply') return g.cursor + 1;
  for (let c = g.cursor + 1; c <= max; c++) if (c === max || turnAt(g, c) === color) return c;
  return max;
}

/* ---------------------------------------------------------------------------------------------- */
/* Sessions                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** The game open on the stage, with everything needed to save it (DESIGN 12.1). */
export interface GameSession {
  /** `SavedGame.id`: the code for solo games, `${code}.${n}` for room games. */
  readonly id: string;
  readonly code: string;
  readonly mode: Mode;
  /** Computer level 1–12; computer games only. */
  readonly level?: number;
  /** This device's side; `B` in pass-and-play. */
  readonly color: Color;
  /** Time control, e.g. `5+7` or `20m5x30`, or null. */
  readonly tc: TcString | null;
  /** The live game (size, rules, handicap and komi in `game.settings`). Its redo tail beyond `cursor` lives only in this session (DESIGN 12.1). */
  readonly game: Game;
  /** A hint, the territory preview, an undo or the guard was used (DESIGN 7). */
  readonly assisted: boolean;
  readonly createdAt: number;
  /** As it will be saved; moves to `now` on every change, or after 15 s (DESIGN 12.1). */
  readonly lastPlayedAt: number;
  /** True once this session has changed the game or stayed 15 s (or created it). */
  readonly touched: boolean;
  /** `now()` when the session was opened; the 15-second rule counts from here. */
  readonly openedAt: number;
  /** Review cursor (read-only board), or null while playing live. */
  readonly review: number | null;
  readonly room?: { n: number; epoch: number };
}

/** Settings of a new game. */
export interface NewGameSpec {
  code: string;
  mode: Mode;
  level?: number;
  color: Color;
  tc: TcString | null;
  /** Size, rules and handicap; ignored when `game` is given (its settings are used). */
  settings?: GameSettings;
  /** Start from this game value instead of a new one. */
  game?: Game;
  assisted?: boolean;
}

/** A brand-new game: saved at once, "last played" now (Zudoku: a new game counts as a change). */
export function createSession(spec: NewGameSpec, now: number): GameSession {
  const game = spec.game ?? zigo.newGame(settingsOf(spec.settings ?? { size: DEFAULT_SIZE, rules: 'area', handicap: 0 }));
  return {
    id: spec.code,
    code: spec.code,
    mode: spec.mode,
    ...(spec.mode === 'computer' ? { level: clampLevel(spec.level) ?? DEFAULT_LEVEL } : {}),
    color: spec.mode === 'local' ? 'B' : spec.color,
    tc: spec.tc,
    game,
    assisted: spec.assisted ?? false,
    createdAt: now,
    lastPlayedAt: now,
    touched: true,
    openedAt: now,
    review: game.end ? game.cursor : null,
  };
}

/** The settings a stored game was played with (handicap normalized for its size). */
export function savedSettings(saved: Pick<SavedGame, 'size' | 'rules' | 'handicap'>): GameSettings {
  return { size: saved.size, rules: saved.rules, handicap: normalizeHandicap(saved.size, saved.handicap) };
}

/** Rebuilds a stored game, scoring marks and result included. Unreadable tails are cut (lenient), never thrown. */
export function gameFromSaved(saved: SavedGame): Game {
  try {
    return zigo.fromRecord(saved, { lenient: true });
  } catch {
    try {
      return zigo.newGame(settingsOf(savedSettings(saved)));
    } catch {
      return zigo.newGame(settingsOf({ size: DEFAULT_SIZE, rules: 'area', handicap: 0 }));
    }
  }
}

/** True when a stored game has a result. */
export function isFinished(saved: SavedGame): boolean {
  return !!saved.result;
}

/**
 * Opens a stored game: unfinished games resume (redo empty, "last played" untouched until a change
 * or 15 s), also in the scoring phase with their marks; finished games open in review at their
 * last position.
 */
export function sessionFromSaved(saved: SavedGame, now: number): GameSession {
  const game = gameFromSaved(saved);
  return {
    id: saved.id,
    code: saved.code,
    mode: saved.mode,
    ...(saved.mode === 'computer' ? { level: clampLevel(saved.level) ?? DEFAULT_LEVEL } : {}),
    color: saved.mode === 'local' ? 'B' : saved.color,
    tc: saved.tc ?? null,
    game,
    assisted: !!saved.assisted,
    createdAt: saved.createdAt,
    lastPlayedAt: saved.lastPlayedAt,
    touched: false,
    openedAt: now,
    review: game.end ? game.cursor : null,
    ...(saved.room ? { room: saved.room } : {}),
  };
}

/**
 * The stored form of a session (DESIGN 12.1). Only the plies up to the cursor are kept (redo is
 * session-only). The scoring state is kept during and after scoring, so a reload returns to the
 * same marks (DESIGN 8.4).
 */
export function toSavedGame(s: GameSession): SavedGame {
  const g = s.game;
  const plies = g.plies.slice(0, g.cursor);
  const out: SavedGame = {
    id: s.id,
    code: s.code,
    mode: s.mode,
    color: s.color,
    size: g.settings.size,
    rules: g.settings.rules,
    handicap: g.settings.handicap,
    tc: s.tc,
    moves: zigo.encodeMoves(plies),
    ms: plies.map((p) => p.ms),
    assisted: s.assisted,
    createdAt: s.createdAt,
    lastPlayedAt: s.lastPlayedAt,
  };
  if (s.mode === 'computer') out.level = s.level ?? DEFAULT_LEVEL;
  if (g.scoring) out.scoring = { round: g.scoring.round, rev: g.scoring.rev, dead: [...g.scoring.dead], accepted: [g.scoring.accepted[0], g.scoring.accepted[1]] };
  if (g.end) out.result = { ...g.end.result };
  if (s.room) out.room = s.room;
  return out;
}

/** A changed session: new game value, "last played" now. */
function changed(s: GameSession, game: Game, now: number, extra: Partial<GameSession> = {}): GameSession {
  return { ...s, ...extra, game, lastPlayedAt: now, touched: true };
}

/** Whether the board of the session is live and open (not reviewed, not over, not a room). Moves also need `!game.scoring`. */
export function canPlay(s: GameSession | null): s is GameSession {
  return !!s && s.review === null && !s.game.end && s.mode !== 'room';
}

/** True while the live solo game is in the scoring phase (DESIGN 8.4). */
export function isScoring(s: GameSession | null): s is GameSession {
  return !!s && !!s.game.scoring && !s.game.end && s.mode !== 'room';
}

/**
 * Whether the solo game's clock runs: not over, not scoring (clocks stop, DESIGN 8.4), not a room.
 * Unlike `canPlay` this ignores review: a move-list jump in a live game does not stop its clock or
 * the computer (DESIGN 11: solo clocks pause only when the tab is hidden or on Back).
 */
export function isRunning(s: GameSession | null): s is GameSession {
  return !!s && !s.game.end && !s.game.scoring && s.mode !== 'room';
}

/** The computer is to move in a running game against it (it moves on while the player reviews). */
export function computerToMove(s: GameSession): boolean {
  return isRunning(s) && s.mode === 'computer' && s.game.turn !== s.color;
}

/**
 * Plays `p` (two SGF letters; `tt` passes) with `ms` used. Null if the move is illegal or the board
 * is not playable. The computer's move also lands while the player looks back through the moves
 * (review stays put).
 */
export function applyMove(s: GameSession, p: Point, ms: number, now: number): GameSession | null {
  if (s.game.scoring) return null;
  if (!canPlay(s) && !computerToMove(s)) return null;
  if (!zigo.isLegal(s.game, p)) return null;
  try {
    return changed(s, zigo.play(s.game, p, ms), now);
  } catch {
    return null;
  }
}

/** A pass (DESIGN 6.2). The second consecutive pass enters scoring. */
export function applyPass(s: GameSession, ms: number, now: number): GameSession | null {
  return applyMove(s, PASS, ms, now);
}

/** Undo per the mode's rule, across passes and out of scoring. Marks the game `assisted` (DESIGN 7). Null if nothing to undo. */
export function applyUndo(s: GameSession, now: number): GameSession | null {
  if (s.review !== null || s.mode === 'room' || s.game.end) return null;
  const target = undoTarget(s.game, undoRuleFor(s.mode), s.color);
  if (target >= s.game.cursor) return null;
  return changed(s, zigo.undo(s.game, s.game.cursor - target), now, { assisted: true });
}

/** Redo per the mode's rule. Null if there is no redo tail. */
export function applyRedo(s: GameSession, now: number): GameSession | null {
  if (s.review !== null || s.mode === 'room' || s.game.end) return null;
  const target = redoTarget(s.game, undoRuleFor(s.mode), s.color);
  if (target <= s.game.cursor) return null;
  return changed(s, zigo.redo(s.game, target - s.game.cursor), now);
}

/** The game cut back to its first `n` plies, with no redo tail (marks of a later scoring are gone). */
function truncate(g: Game, n: number): Game {
  if (n >= g.plies.length && !g.end) return g;
  return zigo.replay(g.settings, g.plies.slice(0, n));
}

/**
 * The 5-second undo toast of a pass (DESIGN 6.2), in solo modes: takes back the player's latest
 * pass as if it had not happened. In pass-and-play the last ply must be a pass; against the computer
 * the latest pass of the player's color, with only computer plies after it. Everything from that
 * pass on is dropped (no redo tail), an ending caused by it (round 2 is scored at once) is lifted,
 * and the game is not marked assisted (it is a correction, like the resign toast). Null if there is
 * no such pass.
 */
export function applyUndoPass(s: GameSession, now: number): GameSession | null {
  if (s.mode === 'room' || s.review !== null) return null;
  const g = s.game;
  // Only an ending the pass caused: a round-2 double pass is scored at once. An Accept is final.
  if (g.end && (g.end.result.by !== 'score' || g.scoring?.round !== 2)) return null;
  let i = g.cursor - 1;
  if (s.mode === 'computer') {
    while (i >= 0 && turnAt(g, i) !== s.color) i--;
  }
  if (i < 0 || !isPass(g.plies[i].m)) return null;
  return changed(s, truncate(g, i), now, { review: null });
}

/**
 * Resignation (DESIGN 8.3). Against the computer the player resigns; in pass-and-play the side to
 * move does. Null if the game is over, in review, in scoring, or a room game (the room controller
 * resigns there).
 */
export function applyResign(s: GameSession, now: number): GameSession | null {
  if (!canPlay(s) || s.game.scoring) return null;
  const loser: Color = s.mode === 'local' ? s.game.turn : s.color;
  return changed(s, zigo.end(s.game, { winner: other(loser), by: 'resign' }), now);
}

/** Ends the game with a result decided elsewhere (the computer resigning, DESIGN 10.4). */
export function applyEnd(s: GameSession, result: Result, now: number): GameSession | null {
  if (s.mode === 'room' || s.game.end) return null;
  return changed(s, zigo.end(s.game, result), now);
}

/**
 * `flagged` ran out of time (DESIGN 8.3): the other side wins on time. The clock runs on in review,
 * so a flag can fall there too; it never falls during scoring (clocks stop).
 */
export function applyTimeout(s: GameSession, flagged: Color, now: number): GameSession | null {
  if (!isRunning(s)) return null;
  return changed(s, zigo.end(s.game, { winner: other(flagged), by: 'time' }), now);
}

/**
 * Takes back a resignation or a time-out (the 5-second undo toast). A scored ending is final: an
 * Accept cannot be reopened (Resume exists before it). Null if there is nothing to reopen.
 */
export function applyReopen(s: GameSession, now: number): GameSession | null {
  if (s.mode === 'room' || !s.game.end || s.game.end.result.by === 'score') return null;
  return changed(s, zigo.reopen(s.game), now, { review: null });
}

/** The 15-second rule: the session now counts as played. */
export function applyTouch(s: GameSession, now: number): GameSession {
  if (s.touched) return s;
  return { ...s, lastPlayedAt: now, touched: true };
}

/** Marks the game as assisted (hint, territory preview, guard). */
export function applyAssisted(s: GameSession): GameSession {
  return s.assisted ? s : { ...s, assisted: true };
}

/* ---------------------------------------------------------------------------------------------- */
/* Scoring (DESIGN 8.4)                                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** New marks for a live scoring phase: `rev` up by one, both acceptances cleared. */
function withMarks(g: Game, dead: readonly Point[]): Game {
  const sc = g.scoring as Scoring;
  return zigo.setScoring(g, { round: sc.round, rev: sc.rev + 1, dead: [...dead], accepted: [0, 0] });
}

/** Toggles the whole group at `p` between alive and dead (DESIGN 8.4 step 2). Null if not scoring or `p` is empty. */
export function applyToggle(s: GameSession, p: Point, now: number): GameSession | null {
  if (!isScoring(s) || s.review !== null) return null;
  const g = s.game;
  if (zigo.groupAt(g, p).length === 0) return null;
  const dead = scoringApi.toggle(g, (g.scoring as Scoring).dead, p);
  return changed(s, withMarks(g, dead), now);
}

/** Replaces the marks with a dead set (the engine's proposal, M2). Null if not scoring. */
export function applyMarks(s: GameSession, dead: readonly Point[], now: number): GameSession | null {
  if (!isScoring(s)) return null;
  const g = s.game;
  // Only stones count; the set is sorted and de-duplicated by `setScoring`.
  const stones = dead.filter((p) => zigo.groupAt(g, p).length > 0);
  return changed(s, withMarks(g, stones), now);
}

/** The result of the current marking: `scoring.result` of `scoring.score` (DESIGN 8.4). */
export function scoredResult(g: Game, dead: readonly Point[]): Result {
  return scoringApi.result(g, scoringApi.score(g, dead));
}

/**
 * Ends a game in scoring with `dead` as the agreed marking: the marks are stored with the result,
 * so review and history show them (DESIGN 12.3). Null if not scoring.
 */
export function applyScoreEnd(s: GameSession, dead: readonly Point[], now: number): GameSession | null {
  if (!isScoring(s)) return null;
  const sc = s.game.scoring as Scoring;
  const same = dead.length === sc.dead.length && [...dead].sort().every((p, i) => p === sc.dead[i]);
  const marked = same ? s.game : (applyMarks(s, dead, now)?.game ?? s.game);
  return changed(s, zigo.end(marked, scoredResult(marked, (marked.scoring as Scoring).dead)), now, { review: null });
}

/**
 * Accept (DESIGN 8.4 step 4). Without `side` (computer, side-by-side pass-and-play) the game ends
 * at once with the marking as shown. With `side` (face-to-face pass-and-play: each player has an
 * Accept) that side's acceptance of the current `rev` is recorded, and the game ends when both
 * sides have accepted the same `rev`. `rev` 0 means "never marked", which `accepted` cannot tell
 * from "not accepted", so the first Accept of an unmarked board moves `rev` to 1 (marks unchanged).
 */
export function applyAccept(s: GameSession, side: Color | null, now: number): GameSession | null {
  if (!isScoring(s) || s.review !== null) return null;
  const sc = s.game.scoring as Scoring;
  if (side === null) return applyScoreEnd(s, sc.dead, now);
  const rev = Math.max(1, sc.rev);
  const idx = side === 'B' ? 0 : 1;
  const accepted: [number, number] = [sc.accepted[0], sc.accepted[1]];
  accepted[idx] = rev;
  const game = zigo.setScoring(s.game, { round: sc.round, rev, dead: [...sc.dead], accepted });
  const next = changed(s, game, now);
  if (accepted[0] === rev && accepted[1] === rev) return applyScoreEnd(next, sc.dead, now);
  return next;
}

/** Resume (DESIGN 8.4 step 5): back to play with the player to move; the next scoring is round 2. */
export function applyResume(s: GameSession, now: number): GameSession | null {
  if (!isScoring(s) || s.review !== null) return null;
  return changed(s, zigo.resume(s.game), now);
}

/* ---------------------------------------------------------------------------------------------- */
/* Review (DESIGN 12.3)                                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** Last cursor review can reach: the live cursor (the end of a finished game). */
export function reviewMax(s: GameSession): number {
  return s.game.cursor;
}

/**
 * Moves the review cursor. Clamped to `0..reviewMax`. On an unfinished game, reaching the live
 * position leaves review; a finished game always stays in review.
 */
export function applyGoto(s: GameSession, cursor: number): GameSession {
  const max = reviewMax(s);
  const c = Math.max(0, Math.min(max, Math.floor(cursor)));
  const review = c === max && !s.game.end ? null : c;
  return review === s.review ? s : { ...s, review };
}

/** The game value the board shows: the review position, or the live game. */
export function viewOf(s: GameSession): Game {
  return s.review === null ? s.game : zigo.goto(s.game, s.review);
}

/**
 * "Continue from here" (DESIGN 12.3): a new solo game from the shown position with a new code, at
 * the same size, rules and handicap. Its moves are the shown game's plies up to that position,
 * replayed from a new game of the same settings (so history, thumbnails, links and SGF need no
 * set-up position), with times zeroed because clock times are not carried. A position right after
 * two passes continues in scoring (Resume plays on). Null if the plies cannot be replayed.
 */
export function continueSpec(
  view: Game,
  solo: Opponent,
  code: string,
  tc: TcString | null,
): NewGameSpec | null {
  const plies: Ply[] = view.plies.slice(0, view.cursor).map((p) => ({ m: p.m, ms: 0 }));
  let game: Game;
  try {
    game = zigo.replay(view.settings, plies);
  } catch {
    return null;
  }
  const mode: Mode = solo.mode === 'computer' ? 'computer' : 'local';
  return {
    code,
    mode,
    level: solo.mode === 'computer' ? solo.level : undefined,
    // Against the computer the player takes over the side to move.
    color: mode === 'local' ? 'B' : game.turn,
    tc,
    game,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* SGF export (DESIGN 13.3)                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/**
 * `Copy SGF` for a session: the whole game (`zigo.sgf`), with `PB`/`PW` naming the computer
 * (`Zigo Level 5`) against the computer, the date the game was created, and the time control.
 */
export function sgfOf(s: GameSession, version: string): string {
  const level = s.mode === 'computer' ? `Zigo Level ${s.level ?? DEFAULT_LEVEL}` : undefined;
  const d = new Date(s.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : undefined;
  return zigo.sgf(s.game, {
    version,
    black: level && s.color === 'W' ? level : undefined,
    white: level && s.color === 'B' ? level : undefined,
    date,
    tc: s.tc,
  });
}

/* ---------------------------------------------------------------------------------------------- */
/* Start pill (DESIGN 4.1)                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export type StartLabel = 'start' | 'resume' | 'review';

export interface StartPill {
  /** `start` (new code or room), `resume` (unfinished local game), `review` (finished local game). */
  readonly label: StartLabel;
  /** The stored game the code refers to; its settings (opponent, color, size, rules, handicap, clock) are what the dimmed selectors show. */
  readonly saved: SavedGame | null;
}

/** The solo game stored under `code` (solo ids are the code). */
export function findSolo(games: readonly SavedGame[], code: string): SavedGame | null {
  return games.find((g) => g.id === code && g.mode !== 'room') ?? null;
}

/** Label of the Start pill for a code and opponent. Rooms always say `START` (create or join). */
export function startPillFor(code: string, opponent: Opponent, games: readonly SavedGame[]): StartPill {
  if (opponent.mode === 'room') return { label: 'start', saved: null };
  const saved = findSolo(games, code);
  if (!saved) return { label: 'start', saved: null };
  return { label: isFinished(saved) ? 'review' : 'resume', saved };
}

/* ---------------------------------------------------------------------------------------------- */
/* History grouping (Zudoku GameHistory, DESIGN 12.2)                                               */
/* ---------------------------------------------------------------------------------------------- */

/** Time groups of the full history list, as in Zudoku. Labels are the UI's (1E) to translate. */
export type TimeGroupKey = 'today' | 'week' | 'month' | 'year' | 'older';

export interface TimeGroup {
  readonly key: TimeGroupKey;
  readonly games: SavedGame[];
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Groups games by `lastPlayedAt`, newest first, empty groups dropped: today (since local
 * midnight), this week (7 days before that), this month (30), this year (365), older.
 */
export function groupByTime(games: readonly SavedGame[], now: number): TimeGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const bounds: [TimeGroupKey, number][] = [
    ['today', today],
    ['week', today - 7 * DAY],
    ['month', today - 30 * DAY],
    ['year', today - 365 * DAY],
    ['older', -Infinity],
  ];
  const groups: TimeGroup[] = bounds.map(([key]) => ({ key, games: [] }));
  const sorted = [...games].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  for (const g of sorted) {
    const i = bounds.findIndex(([, from]) => g.lastPlayedAt >= from);
    groups[i].games.push(g);
  }
  return groups.filter((g) => g.games.length > 0);
}

/* ---------------------------------------------------------------------------------------------- */
/* Change notification between hooks                                                               */
/* ---------------------------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

/** Subscribe to "stored games changed" (saves by `useGameState`, deletes by `useSavedGames`). */
export function onSavedGamesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tell every subscriber that the stored games changed. */
export function notifySavedGames(): void {
  for (const cb of [...listeners]) cb();
}
