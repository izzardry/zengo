/**
 * The game on the stage (DESIGN 3, 4, 6.2, 8.3, 8.4, 10.3, 12, 13).
 *
 * Owns the start-screen settings (code, opponent, color pill, size pill, rules, handicap, clock
 * pill), the open game session, the undo/redo rules per mode (across passes and out of scoring),
 * passing and resigning with their undo toasts, the scoring phase (marking through `useScoring`,
 * Accept, Resume, round 2), autosave of every change, the 15-second "last played" rule, resume,
 * review, "continue from here", the Start pill label, the URL, share links and SGF export.
 *
 * Modes: pass-and-play is complete here. Computer games are sessions like any other (undo by full
 * turn, `isComputerTurn`); milestone 2's driver plugs in through these extension points:
 * - `play(point, ms)` / `pass(ms)` accept the computer's move while `isComputerTurn` (also while
 *   the player reviews);
 * - `finish(result)` ends the game with a result decided elsewhere (the computer resigning);
 * - `timeout(color)` for the clock; `markAssisted()` for hints and the guard;
 * - the `proposeDead` option: the dead-stone proposer, called when a game enters scoring.
 *
 * Rooms (DESIGN 9, PLAN 7), with the `rooms` option: the room controller owns the game. This hook
 * runs `useRoom` for the open room and only reads from it: `session` is derived from the
 * controller's snapshot (with this hook's review cursor), the actions go to the controller (a
 * stone or a pass, undo as a takeback request, resign, the flag, the scoring marks, Accept and
 * Resume), and nothing is saved here (the controller saves the room and its games). Start with
 * `ROOM` creates or joins the room of the shown code (DESIGN 9.2); an invite link (`?s=CODE&o=r`,
 * also with `x` / `y`) opens it at once; Back leaves it. Room addresses carry the code only, never
 * moves (DESIGN 13.2). The room's engine proposal is the `room.propose` option, handed to the
 * controller as it is: the controller sends its answer as data (DESIGN 9.5).
 * Without `rooms`, Start with ROOM, an invite link and a stored unfinished room game call the
 * `onRoom` option instead (false without it). A finished room game that is not the room's current
 * game opens in review.
 *
 * The rules themselves are pure functions in `lib/gameRecord.ts` (session transitions) and
 * `lib/zengo.ts` (Go); this hook wires them to React, the store, the address bar and the turn timer.
 * Inject `store`, `now` and `rng` in tests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultRng, isValidCode, normalizeCode } from '@/lib/codes';
import {
  DEFAULT_LEVEL,
  DEFAULT_OPPONENT,
  LAST_PLAYED_DELAY_MS,
  applyAccept,
  applyAssisted,
  applyEnd,
  applyGoto,
  applyMarks,
  applyMove,
  applyPass,
  applyRedo,
  applyReopen,
  applyResign,
  applyResume,
  applyScoreEnd,
  applyTimeout,
  applyToggle,
  applyTouch,
  applyUndo,
  applyUndoPass,
  canPlay,
  clampLevel,
  continueSpec,
  createSession,
  findSolo,
  freshCode,
  gameFromSaved,
  isFinished,
  isRunning,
  isScoring,
  isSolo,
  notifySavedGames,
  onSavedGamesChange,
  parseClockPref,
  parseOpponent,
  redoTarget,
  resolveColor,
  savedSettings,
  sessionFromSaved,
  settingsOf,
  sgfOf,
  sizeForMoves,
  startPillFor,
  toSavedGame,
  undoRuleFor,
  undoTarget,
  viewOf,
  type GameSession,
  type GameSettings,
  type StartPill,
  type UndoRule,
} from '@/lib/gameRecord';
import { flags } from '@/lib/flags';
import type { RoomCreateSettings, RoomState } from '@/lib/room';
import {
  readClock,
  readColorChoice,
  readHandicap,
  readRules,
  readSize,
  store as defaultStore,
  writeClock,
  writeColorChoice,
  writeHandicap,
  writeRules,
  writeSize,
} from '@/lib/storage';
import type {
  Color,
  ColorChoice,
  Game,
  Mode,
  Now,
  Opponent,
  Point,
  Result,
  Rng,
  Rules,
  SavedGame,
  Size,
  Store,
  TcString,
} from '@/lib/types';
import {
  appBaseUrl,
  buildUrl,
  gameParams,
  parseUrl,
  roomShareUrl,
  shareUrl as buildShareUrl,
  urlQuery,
  useUrlParams,
  type UrlParams,
} from '@/lib/url';
import { roomGameId } from '@/lib/sync';
import zengo, { isPass, makeSettings, normalizeHandicap } from '@/lib/zengo';
import { useRoom, type RoomHandle, type UseRoomOptions } from './useRoom';
import { useScoring, type ScoringActions, type UseScoring } from './useScoring';

export type { GameSession, GameSettings, StartPill, UndoRule } from '@/lib/gameRecord';

/**
 * Where the stage is (DESIGN 4): start screen, a live game, the live game's scoring phase, or the
 * read-only review (finished games, and move-list jumps in a live game).
 */
export type Phase = 'start' | 'playing' | 'scoring' | 'review';

/**
 * The dead-stone proposer (milestone 2: the engine's ownership through `scoring.propose`). Called
 * with the live game when it enters scoring. Round 1: the result becomes the initial marking
 * (null = every stone alive). Round 2: the game is scored at once with it (null = every stone alive).
 */
export type DeadStoneProposer = (game: Game) => readonly Point[] | null | Promise<readonly Point[] | null>;

/** The settings Start with ROOM hands to the room (milestone 3). */
export interface RoomStartSettings extends GameSettings {
  readonly tc: TcString | null;
  readonly color: ColorChoice;
}

export interface UseGameStateOptions {
  /** Persistence; defaults to the app store over `localStorage`. */
  store?: Store;
  /** Clock for timestamps and per-ply time; defaults to `Date.now`. */
  now?: Now;
  /** Randomness for codes and the random color; defaults to WebCrypto. */
  rng?: Rng;
  /** Base address for share links; defaults to the current page without hash. */
  baseUrl?: string;
  /** App version for SGF's `AP[Zengo:<version>]`; defaults to the build's git hash. */
  version?: string;
  /** Dead-stone proposer for the scoring phase (milestone 2). Without it every stone starts alive. */
  proposeDead?: DeadStoneProposer;
  /**
   * Runs rooms in this hook (DESIGN 9): Start with ROOM, invite links and stored room games open
   * the room through `useRoom`. Default false; `flags.rooms` must be on too.
   */
  rooms?: boolean;
  /**
   * Options of the room session (`useRoom`): the engine's dead-stone proposer (`propose`), and in
   * tests the memory broker, the lock manager, timers or a fake controller. The store, the create
   * intent and the `x` / `y` signals come from this hook.
   */
  room?: Omit<UseRoomOptions, 'enabled' | 'create' | 'offer' | 'answer' | 'onSignalUsed' | 'store'>;
  /**
   * Without `rooms`: opens the room of `code` elsewhere. Start with ROOM (`create` holds the
   * start-screen settings), an invite link `?s=CODE&o=r` or a stored unfinished room game (`create`
   * null). Returns whether the room opened. Without it (and without `rooms`) these return false.
   */
  onRoom?: (code: string, create: RoomStartSettings | null) => boolean;
}

/** The room open on the stage (room mode). The game itself lives in the room controller. */
interface RoomOpen {
  readonly code: string;
  /** Start with ROOM: the settings to create the room with if this device has none. Null for links and history. */
  readonly create: RoomCreateSettings | null;
  /** Review cursor (move list jump, stepping), or null while live. Always before the live position. */
  readonly review: number | null;
  /** The room's game number the review was taken in: a rematch ends the review. */
  readonly reviewN: number;
  /** `now()` when the room was opened. */
  readonly openedAt: number;
}

/** Internal state: start-screen settings plus the open session. */
interface State {
  code: string;
  opponent: Opponent;
  colorChoice: ColorChoice;
  size: Size;
  rules: Rules;
  /** Handicap of the current size (remembered per size). */
  handicap: number;
  /** Clock pill of the current size (remembered per size). */
  tc: TcString | null;
  /** Last solo opponent setting, for "continue from here" (DESIGN 12.3). */
  lastSolo: Opponent;
  session: GameSession | null;
  /** The code of a room invite link that arrived and has not been handled yet (without `rooms`). */
  roomInvite: string | null;
  /** The open room (room mode, with `rooms`); `session` is null then. */
  room: RoomOpen | null;
}

interface Ctx {
  store: Store;
  now: Now;
  rng: Rng;
  /** Rooms run in this hook (`rooms` option and `flags.rooms`). */
  rooms: boolean;
}

/* ---------------------------------------------------------------------------------------------- */
/* Pure helpers (state ⇄ URL)                                                                       */
/* ---------------------------------------------------------------------------------------------- */

function initialSettings(ctx: Ctx): State {
  const opponent = parseOpponent(ctx.store.pref<unknown>('opponent', null));
  const size = readSize(ctx.store);
  return {
    code: '',
    opponent,
    colorChoice: readColorChoice(ctx.store),
    size,
    rules: readRules(ctx.store),
    handicap: readHandicap(ctx.store, size),
    tc: readClock(ctx.store, size, null),
    lastSolo: isSolo(opponent) ? opponent : DEFAULT_OPPONENT,
    session: null,
    roomInvite: null,
    room: null,
  };
}

/**
 * A game link's game: the moves replayed leniently at the link's settings, ended by `r`. A link
 * whose moves end in two passes and has no result was shared during scoring: it opens in scoring.
 */
function gameFromLink(url: UrlParams, settings: GameSettings): Game {
  let game: Game;
  try {
    game = zengo.fromRecord({ ...settings, moves: url.moves ?? '', result: url.result }, { lenient: true });
  } catch {
    return zengo.newGame(settingsOf(settings));
  }
  const n = game.plies.length;
  if (!game.end && !game.scoring && n >= 2 && isPass(game.plies[n - 1].m) && isPass(game.plies[n - 2].m)) {
    try {
      game = zengo.replay(game.settings, game.plies);
    } catch {
      /* keep the resumed game */
    }
  }
  return game;
}

/**
 * Applies a URL to the state: a room link (preselect ROOM and the code; the room opens through
 * `onRoom`), a game link (resume the stored game it names, or open it as a new game on this device
 * without overwriting anything), or start-screen settings.
 */
function applyUrl(prev: State, url: UrlParams, ctx: Ctx): State {
  const games = ctx.store.games();
  const code = url.code ?? (isValidCode(prev.code) ? prev.code : freshCode(games, ctx.rng));
  const isGameLink = !!url.playing || url.moves !== undefined;
  const base: State = { ...prev, code, session: null, roomInvite: null, room: null };

  if (url.mode === 'room') {
    if (!ctx.rooms) return { ...base, opponent: { mode: 'room' }, roomInvite: url.code ?? null };
    // The room already open here (a manual-signalling `x` / `y` arriving in this tab): keep it.
    if (prev.room && prev.room.code === code) return prev;
    if (!url.code) return { ...base, opponent: { mode: 'room' } };
    return { ...base, opponent: { mode: 'room' }, room: { code, create: null, review: null, reviewN: 0, openedAt: ctx.now() } };
  }

  if (!isGameLink) {
    // Start-screen link: the parameters preselect the opponent, color, size, rules, handicap and clock.
    let opponent = prev.opponent;
    if (url.mode === 'local') opponent = { mode: 'local' };
    else if (url.mode === 'computer' || (url.level !== undefined && opponent.mode === 'computer')) {
      opponent = { mode: 'computer', level: url.level ?? levelOf(prev) };
    }
    const size = url.size ?? prev.size;
    const handicap =
      url.handicap !== undefined
        ? normalizeHandicap(size, url.handicap)
        : size === prev.size
          ? prev.handicap
          : readHandicap(ctx.store, size);
    const tc = url.tc ?? (size === prev.size ? prev.tc : readClock(ctx.store, size, null));
    return {
      ...base,
      opponent,
      lastSolo: isSolo(opponent) ? opponent : prev.lastSolo,
      colorChoice: url.color ?? prev.colorChoice,
      size,
      rules: url.rules ?? prev.rules,
      handicap,
      tc,
    };
  }

  const now = ctx.now();
  const mode: Mode = url.mode ?? 'local';
  const saved = findSolo(games, code);
  if (saved && (url.moves === undefined || (url.moves === saved.moves && (url.size ?? saved.size) === saved.size))) {
    // A reload, or the device's own link: the stored game.
    return { ...base, session: sessionFromSaved(saved, now) };
  }

  // A game link carries its settings: `g` and `h` are left out for area and no handicap.
  const size = url.size ?? sizeForMoves(url.moves ?? '', prev.size);
  const settings: GameSettings = {
    size,
    rules: url.rules ?? 'area',
    handicap: normalizeHandicap(size, url.handicap ?? 0),
  };
  const spec = {
    // A different game under a code this device already uses gets a new code (never overwrite).
    code: saved ? freshCode(games, ctx.rng) : code,
    mode,
    level: mode === 'computer' ? (url.level ?? levelOf(prev)) : undefined,
    color: url.color ?? resolveColor(prev.colorChoice, mode, ctx.rng),
    tc: url.tc ?? null,
    game: gameFromLink(url, settings),
  };
  const session = createSession(spec, now);
  return { ...base, code: session.code, session };
}

function levelOf(s: State): number {
  if (s.opponent.mode === 'computer') return s.opponent.level;
  if (s.lastSolo.mode === 'computer') return s.lastSolo.level;
  return DEFAULT_LEVEL;
}

/**
 * What the address bar should say for a state. The start screen with `ROOM` selected leaves `o`
 * out: `?s=CODE&o=r` is the invite link, which opens the room at once, and the selection is
 * remembered in `zengo:opponent` anyway.
 */
function desiredUrl(s: State): UrlParams {
  // A room says its code only (DESIGN 13.2): no moves, no settings.
  if (s.room) return { code: s.room.code, playing: true, mode: 'room' };
  if (s.session) return gameParams(toSavedGame(s.session));
  return {
    code: isValidCode(s.code) ? s.code : undefined,
    level: s.opponent.mode === 'computer' ? s.opponent.level : undefined,
    mode: s.opponent.mode === 'room' ? undefined : s.opponent.mode,
    color: s.colorChoice === 'random' ? undefined : s.colorChoice,
    tc: s.tc ?? undefined,
    size: s.size,
    rules: s.rules,
    handicap: s.handicap,
  };
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function defaultVersion(): string {
  return typeof __GIT_HASH__ === 'string' ? __GIT_HASH__ : 'dev';
}

/** The board shown while the room controller has not loaded yet: the create settings, else 9×9. */
function placeholderGame(open: RoomOpen): Game {
  const c = open.create;
  return zengo.newGame(makeSettings(c?.size ?? 9, c?.rules ?? 'area', normalizeHandicap(c?.size ?? 9, c?.handicap ?? 0)));
}

/**
 * The review cursor of an open room as it stands now, for the room's game `n` at live `cursor`:
 * null (live) once another game of the room started (a rematch) or a takeback cut the game to or
 * before the reviewed position, so the player is never left reviewing a game that moved on.
 */
function roomReviewOf(open: RoomOpen, n: number, cursor: number): number | null {
  const r = open.review;
  return r === null || open.reviewN !== n || r >= cursor ? null : Math.max(0, r);
}

/**
 * The stage's session for an open room, read from the controller's snapshot (PLAN 7: the
 * controller owns the game). Not saved by this hook. `review` follows `roomReviewOf`.
 */
function roomSessionOf(open: RoomOpen, rs: RoomState | null, fallback: Game): GameSession {
  const game = rs?.game ?? fallback;
  const cur = rs && rs.logs.length > 0 ? rs.logs[rs.logs.length - 1] : undefined;
  const n = rs?.n ?? 0;
  return {
    id: roomGameId(open.code, n),
    code: open.code,
    mode: 'room',
    color: rs?.color ?? 'B',
    tc: cur?.tc ?? null,
    game,
    assisted: false,
    createdAt: open.openedAt,
    lastPlayedAt: open.openedAt,
    touched: true,
    openedAt: open.openedAt,
    review: roomReviewOf(open, n, game.cursor),
    room: { n, epoch: rs?.epoch ?? 0 },
  };
}

/** The stored game of room `code` with the highest game number, if any. */
function latestRoomGame(games: readonly SavedGame[], code: string): SavedGame | null {
  let best: SavedGame | null = null;
  for (const g of games) {
    if (g.mode !== 'room' || g.code !== code) continue;
    if (!best || (g.room?.n ?? 0) > (best.room?.n ?? 0)) best = g;
  }
  return best;
}

/**
 * Whether a stored room game opens its room (reconnects) rather than a read-only review: an
 * unfinished game always does; a finished one when it is the room's current game, so its rematch
 * can be asked for (DESIGN 9.4). Older games of a room open in review (DESIGN 12.2).
 */
function opensRoom(saved: SavedGame, store: Store): boolean {
  if (saved.mode !== 'room') return false;
  if (!isFinished(saved)) return true;
  if (!store.rooms().some((r) => r.code === saved.code)) return false;
  const n = saved.room?.n ?? 0;
  return !store.games().some((g) => g.mode === 'room' && g.code === saved.code && (g.room?.n ?? 0) > n);
}

/* ---------------------------------------------------------------------------------------------- */
/* The hook                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export interface UseGameState {
  /* ---- where we are ---- */
  phase: Phase;
  /** The open session, or null on the start screen. `session.game` is the live game. */
  session: GameSession | null;
  /** The game value the board shows: the review position in review, else the live game. Null on the start screen. */
  view: Game | null;

  /* ---- start-screen settings ---- */
  code: string;
  opponent: Opponent;
  colorChoice: ColorChoice;
  /** Size pill (DESIGN 4.1). Remembered in `zengo:size`. */
  size: Size;
  /** Rules dial: `area` (default) or `territory`. Remembered in `zengo:rules`. */
  rules: Rules;
  /** Handicap dial for the current size: 0 or 2–9 (2–5 on 9×9). Remembered per size in `zengo:handicap`. */
  handicap: number;
  /** Clock pill value of the current size, e.g. `5+7`, `20m5x30`, or null for off. Remembered per size in `zengo:clock`. */
  tc: TcString | null;
  /** Sets the code (normalized: uppercase `0-9A-Z`, 1–8). Returns false and ignores an empty result. */
  setCode(code: string): boolean;
  /** A new random code that no stored game uses. Returns it. */
  regenerateCode(): string;
  /** Remembered in `zengo:opponent`. */
  setOpponent(o: Opponent): void;
  /** Remembered in `zengo:color`. */
  setColorChoice(c: ColorChoice): void;
  /** Remembered in `zengo:size`; switches the handicap and clock to that size's remembered values. */
  setSize(size: Size): void;
  /** Remembered in `zengo:rules`. */
  setRules(rules: Rules): void;
  /** Normalized for the current size and remembered for it. */
  setHandicap(n: number): void;
  /** Remembered for the current size (null = off). */
  setTc(tc: TcString | null): void;
  /** Label of the Start pill for the current code and opponent (DESIGN 4.1), and the stored game it refers to. */
  startPill: StartPill;
  /** Position for the blurred start-screen board: the stored game of the code, or an empty board of the selected size with the handicap stones. */
  preview: Game;
  /** The code of a room invite link that arrived (ROOM is preselected); null once handled or replaced. Without `rooms` only. */
  roomInvite: string | null;
  /**
   * With ROOM selected: the current game of the shown code's room, when this device holds that
   * room. Its settings (size, rules, handicap, clock, this device's color) are the room's and are
   * shown dimmed (DESIGN 4.1, 9.1).
   */
  roomSaved: SavedGame | null;

  /* ---- opening and leaving games ---- */
  /**
   * The Start pill's action: resume or review the stored game of the code, or begin a new game
   * with the selected settings. With `ROOM` selected: `onRoom` (false without it).
   */
  start(): boolean;
  /**
   * Opens a stored game (history tap): resume if unfinished (also in scoring), review if finished.
   * An unfinished room game goes to `onRoom` (false without it); a finished one opens in review.
   */
  open(saved: SavedGame): boolean;
  /** "New game" on the overlay: a new code with the current game's mode, level, clock, size, rules and handicap. False in a room. */
  newGame(): boolean;
  /** Back to the start screen. The game is already saved; the code stays selected. Leaves an open room. */
  exit(): void;
  /**
   * The open room (room mode): its view (presence, requests, score, scoring, manual exchange, tab
   * guard) and actions. Null outside room mode, also while a finished room game is only reviewed.
   */
  room: RoomHandle | null;

  /* ---- playing ---- */
  /**
   * Places a stone at `p` (two SGF letters; `tt` passes) for the side to move. `ms` is the time
   * the mover used; omitted, the hook's own turn timer is used (time per ply is recorded even
   * without a clock). Returns false if illegal, over, scoring, in review, or not this device's turn
   * (the computer's move is accepted while `isComputerTurn`).
   */
  play(p: Point, ms?: number): boolean;
  /** A pass (DESIGN 6.2). The second consecutive pass enters scoring; in round 2 the game is scored at once. */
  pass(ms?: number): boolean;
  /** Milliseconds the side to move has used on the current turn (paused while the tab is hidden, in scoring, or on Back). */
  turnElapsed(): number;
  /** Undo rule of the open game: `ply` (pass-and-play), `turn` (computer), `request` (room). */
  undoRule: UndoRule | null;
  canUndo: boolean;
  canRedo: boolean;
  /** One move back (pass-and-play, passes included) or one full turn back (computer). Marks the game assisted. */
  undo(): boolean;
  /** Replays what undo took back (session-only; empty after a resume or reload). */
  redo(): boolean;
  /** The pass undo toast is possible: the player's latest pass can be taken back. */
  canUndoPass: boolean;
  /** Takes back the player's latest pass (the 5-second toast, DESIGN 6.2): no redo tail, not assisted. */
  undoPass(): boolean;
  /** Pass-and-play: the side to move resigns. Computer: the player resigns. Not during scoring. */
  resign(): boolean;
  /** Takes back a resignation or time-out (the 5-second undo toast). A scored ending is final. */
  reopen(): boolean;
  /** Ends the game with a result decided elsewhere (the computer resigning). */
  finish(result: Result): boolean;
  /** `flagged` ran out of time: the other side wins on time. */
  timeout(flagged: Color): boolean;
  /** Marks the game assisted (a hint, the territory preview or the guard was used). */
  markAssisted(): void;
  /** True when the live game is over. */
  isOver: boolean;
  /** True while the live game is in its scoring phase. */
  isScoring: boolean;
  /** Live, not over, not scoring, and it is this device's player's turn (always true in pass-and-play). */
  isPlayerTurn: boolean;
  /** Live computer game, not over, not scoring, and the computer is to move (milestone 2 plugs the engine in here). */
  isComputerTurn: boolean;

  /* ---- scoring (DESIGN 8.4) ---- */
  /**
   * The scoring view of the shown position, with the solo actions: `toggle(p)` (a whole group,
   * round 1), `accept(side?)` (no side: end at once; a side: face-to-face Accepts, ends when both
   * accepted) and `resume()` (play on; the next double pass is scored at once).
   */
  scoring: UseScoring;
  /** Replaces the marks with a dead set (for a proposer outside the hook). False when not scoring. */
  setDead(dead: readonly Point[]): boolean;

  /* ---- review ---- */
  /** Review cursor, or null while live. */
  reviewCursor: number | null;
  /**
   * Enters review at `cursor` (default: the current position). Leaving it on an unfinished game: `exitReview`.
   * In a room the live position stays live (the room's game moves on; reviews end with it).
   */
  enterReview(cursor?: number): void;
  /** Back to the live position of an unfinished game. No-op for finished games (they stay in review). */
  exitReview(): void;
  /** Jumps to a cursor (move list tap). Enters review; reaching the live position of an unfinished game leaves it. */
  goto(cursor: number): void;
  /** Steps the review by `delta` plies (negative = back). */
  step(delta: number): void;
  toStart(): void;
  toEnd(): void;
  canStepBack: boolean;
  canStepForward: boolean;
  /** "Continue from here": a new solo game from the shown position with a new code, same size, rules and handicap (DESIGN 12.3). */
  continueFromHere(): boolean;

  /* ---- sharing ---- */
  /**
   * Share link (DESIGN 13.2): the full URL (settings, moves, and the result of a finished game,
   * which then opens in review) for a game; the room invite with ROOM selected on the start
   * screen; else the start-screen settings.
   */
  shareUrl(): string;
  /** `Copy SGF` (DESIGN 13.3) of the open game, or null on the start screen. */
  sgf(): string | null;
}

export function useGameState(options: UseGameStateOptions = {}): UseGameState {
  const store = options.store ?? defaultStore;
  const nowOpt = options.now;
  const rngOpt = options.rng;
  const now = useCallback<Now>(() => (nowOpt ? nowOpt() : Date.now()), [nowOpt]);
  const rng = useCallback<Rng>(() => (rngOpt ? rngOpt() : defaultRng()), [rngOpt]);
  const roomsOn = !!options.rooms && flags.rooms;
  const ctx = useMemo<Ctx>(() => ({ store, now, rng, rooms: roomsOn }), [store, now, rng, roomsOn]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const optsRef = useRef(options);
  optsRef.current = options;

  const url = useUrlParams();
  const { write, isOwnWrite, search } = url;

  const [state, setState] = useState<State>(() => applyUrl(initialSettings(ctx), parseUrl(search), ctx));
  const ref = useRef(state);

  /* ---- the open room (DESIGN 9): the controller owns its game; this hook only reads it ---- */
  const roomOpen = state.room;
  const roomHandle = useRoom(roomOpen?.code ?? null, {
    ...options.room,
    store,
    enabled: !!roomOpen,
    create: roomOpen?.create ?? null,
    offer: roomOpen ? (url.params.offer ?? null) : null,
    answer: roomOpen ? (url.params.answer ?? null) : null,
    // `x` and `y` are transient: once used they leave the address bar (DESIGN 13.2).
    onSignalUsed: () => write({ ...desiredUrl(ref.current), offer: '', answer: '' }),
  });
  const roomRef = useRef(roomHandle);
  roomRef.current = roomHandle;
  const roomState = roomOpen ? roomHandle.state : null;
  const roomStateRef = useRef(roomState);
  roomStateRef.current = roomState;
  const roomFallback = useMemo(() => (roomOpen ? placeholderGame(roomOpen) : null), [roomOpen]);
  const roomFallbackRef = useRef(roomFallback);
  roomFallbackRef.current = roomFallback;

  // The controller saves the room's games itself: tell the history and the Start pill.
  // The controller keeps `logs` as the same array until a game changes, so this runs per change.
  const roomLogs = roomState?.logs;
  useEffect(() => {
    if (roomLogs) notifySavedGames();
  }, [roomLogs]);

  /* ---- turn timer: ms per ply even without a clock ---- */
  const turn = useRef<{ used: number; since: number | null }>({ used: 0, since: null });
  const timerInit = useRef(false);
  if (!timerInit.current) {
    timerInit.current = true;
    if (isRunning(state.session) && isVisible()) turn.current.since = now();
  }

  const turnElapsed = useCallback(() => {
    if (ref.current.room) return roomRef.current.elapsed();
    const t = turn.current;
    return Math.max(0, t.used + (t.since !== null ? ctxRef.current.now() - t.since : 0));
  }, []);

  /** Sets state; keeps the turn timer in step with the live game. */
  const commit = useCallback((next: State) => {
    const prev = ref.current;
    ref.current = next;
    const t = turn.current;
    const running = isRunning(next.session) && isVisible();
    const at = ctxRef.current.now();
    const pg = prev.session?.game;
    const ng = next.session?.game;
    // A new ply or another game starts a new turn; marking, review and the like do not.
    const newTurn =
      prev.session?.id !== next.session?.id || pg?.cursor !== ng?.cursor || pg?.plies !== ng?.plies || !pg !== !ng;
    if (newTurn) {
      t.used = 0;
      t.since = running ? at : null;
    } else if (running && t.since === null) {
      t.since = at;
    } else if (!running && t.since !== null) {
      t.used += at - t.since;
      t.since = null;
    }
    setState(next);
  }, []);

  /** Updates the session with a transition; returns whether it applied. */
  const update = useCallback(
    (fn: (s: GameSession, at: number) => GameSession | null): boolean => {
      const st = ref.current;
      if (!st.session) return false;
      const next = fn(st.session, ctxRef.current.now());
      if (!next) return false;
      if (next !== st.session) commit({ ...st, session: next });
      return true;
    },
    [commit],
  );

  /* ---- pause the turn timer while the tab is hidden ---- */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      const t = turn.current;
      const at = ctxRef.current.now();
      if (document.visibilityState === 'hidden') {
        if (t.since !== null) {
          t.used += at - t.since;
          t.since = null;
        }
      } else if (t.since === null && isRunning(ref.current.session)) {
        t.since = at;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* ---- URL: external changes in, own state out ---- */
  const handled = useRef(search);
  useEffect(() => {
    if (search === handled.current) return;
    handled.current = search;
    if (isOwnWrite(search)) return;
    // Another package's parameters (x, y) or a URL that already says what the state says.
    const incoming = parseUrl(search);
    if (urlQuery({ ...incoming, offer: undefined, answer: undefined }) === urlQuery(desiredUrl(ref.current))) return;
    // A link pasted into a running tab, or a hash edited by hand.
    commit(applyUrl(ref.current, incoming, ctxRef.current));
  }, [search, isOwnWrite, commit]);

  const desired = useMemo(() => desiredUrl(state), [state]);
  const desiredKey = urlQuery(desired);
  const desiredRef = useRef(desired);
  desiredRef.current = desired;
  useEffect(() => {
    write(desiredRef.current);
  }, [desiredKey, write]);

  /* ---- room invites go to `onRoom` (milestone 3) ---- */
  const invite = state.roomInvite;
  useEffect(() => {
    if (!invite) return;
    const onRoom = optsRef.current.onRoom;
    if (!ctxRef.current.rooms && onRoom && onRoom(invite, null)) commit({ ...ref.current, roomInvite: null });
  }, [invite, commit]);

  /* ---- autosave on every change (DESIGN 12.1) ---- */
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    const s = state.session;
    if (!s || !s.touched || s.mode === 'room') return;
    const rec = toSavedGame(s);
    const json = JSON.stringify(rec);
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    store.saveGame(rec);
    notifySavedGames();
  }, [state.session, store]);

  /* ---- the 15-second "last played" rule ---- */
  const sessionId = state.session?.id;
  const touched = state.session?.touched ?? true;
  const openedAt = state.session?.openedAt ?? 0;
  useEffect(() => {
    if (sessionId === undefined || touched) return;
    const wait = Math.max(0, LAST_PLAYED_DELAY_MS - (ctxRef.current.now() - openedAt));
    const id = setTimeout(() => {
      const st = ref.current;
      if (!st.session || st.session.id !== sessionId || st.session.touched) return;
      commit({ ...st, session: applyTouch(st.session, ctxRef.current.now()) });
    }, wait);
    return () => clearTimeout(id);
  }, [sessionId, touched, openedAt, commit]);

  /* ---- the dead-stone proposal when a game enters scoring (DESIGN 8.4 steps 1 and 5) ---- */
  const [proposing, setProposing] = useState(false);
  const live = state.session;
  const liveScoring = isScoring(live) ? live.game.scoring : undefined;
  const proposalKey = liveScoring && liveScoring.rev === 0 ? `${live!.id}:${live!.game.cursor}:${liveScoring.round}` : null;
  useEffect(() => {
    if (!proposalKey) return;
    const s0 = ref.current.session;
    if (!isScoring(s0)) return;
    const game = s0.game;
    const round = game.scoring!.round;
    const proposer = optsRef.current.proposeDead;
    /** Still the same scoring phase, unmarked: the proposal applies. */
    const current = () => {
      const s = ref.current.session;
      return isScoring(s) && s.id === s0.id && s.game.cursor === game.cursor && s.game.plies === game.plies && s.game.scoring!.rev === 0 ? s : null;
    };
    const apply = (dead: readonly Point[] | null) => {
      if (!current()) return;
      const d = dead ?? [];
      if (round === 2) update((s, at) => applyScoreEnd(s, d, at));
      else if (d.length > 0) update((s, at) => applyMarks(s, d, at));
    };
    if (!proposer) {
      // No engine: round 1 starts with every stone alive; round 2 is scored at once with every stone alive.
      if (round === 2) apply([]);
      return;
    }
    let cancelled = false;
    let out: ReturnType<DeadStoneProposer>;
    try {
      out = proposer(game);
    } catch {
      out = null;
    }
    if (!(out instanceof Promise)) {
      apply(out);
      return;
    }
    setProposing(true);
    out
      .catch(() => null)
      .then((dead) => {
        if (!cancelled) apply(dead);
      })
      .finally(() => {
        if (!cancelled) setProposing(false);
      });
    return () => {
      cancelled = true;
      setProposing(false);
    };
  }, [proposalKey, update]);

  /* ---- stored games (start pill, preview) ---- */
  const [savedVersion, setSavedVersion] = useState(0);
  useEffect(() => {
    const bump = () => setSavedVersion((v) => v + 1);
    const off = onSavedGamesChange(bump);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith('zengo:')) bump();
    };
    window.addEventListener('storage', onStorage);
    // The autosave effect above runs before this subscription on mount (a game opened from a
    // link is saved at once): re-read the store so the Start pill knows that game after Back.
    bump();
    return () => {
      off();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const startPill = useMemo(
    () => startPillFor(state.code, state.opponent, store.games()),
    // savedVersion re-reads the store after saves and deletes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.code, state.opponent, store, savedVersion],
  );
  // With ROOM selected, the preview shows the current game of that room if this device holds it.
  const roomSaved = useMemo(
    () =>
      roomsOn && state.opponent.mode === 'room' && store.rooms().some((r) => r.code === state.code)
        ? latestRoomGame(store.games(), state.code)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomsOn, state.code, state.opponent, store, savedVersion],
  );
  const previewSaved = startPill.saved ?? roomSaved;
  const { size: selSize, rules: selRules, handicap: selHandicap } = state;
  const preview = useMemo(
    () =>
      previewSaved
        ? gameFromSaved(previewSaved)
        : zengo.newGame(settingsOf({ size: selSize, rules: selRules, handicap: selHandicap })),
    [previewSaved, selSize, selRules, selHandicap],
  );

  /* ---- settings ---- */
  const setCode = useCallback(
    (input: string) => {
      const code = normalizeCode(input);
      if (!isValidCode(code)) return false;
      const st = ref.current;
      if (st.code !== code) commit({ ...st, code });
      return true;
    },
    [commit],
  );

  const regenerateCode = useCallback(() => {
    const code = freshCode(ctxRef.current.store.games(), ctxRef.current.rng);
    commit({ ...ref.current, code });
    return code;
  }, [commit]);

  const setOpponent = useCallback(
    (o: Opponent) => {
      const opponent = o.mode === 'computer' ? { mode: 'computer' as const, level: clampLevel(o.level) ?? DEFAULT_LEVEL } : o;
      ctxRef.current.store.setPref('opponent', opponent);
      const st = ref.current;
      commit({ ...st, opponent, lastSolo: isSolo(opponent) ? opponent : st.lastSolo, roomInvite: null });
    },
    [commit],
  );

  const setColorChoice = useCallback(
    (c: ColorChoice) => {
      writeColorChoice(ctxRef.current.store, c);
      commit({ ...ref.current, colorChoice: c === 'B' || c === 'W' ? c : 'random' });
    },
    [commit],
  );

  const setSize = useCallback(
    (size: Size) => {
      if (size !== 9 && size !== 13 && size !== 19) return;
      const s = ctxRef.current.store;
      writeSize(s, size);
      commit({ ...ref.current, size, handicap: readHandicap(s, size), tc: readClock(s, size, null) });
    },
    [commit],
  );

  const setRules = useCallback(
    (rules: Rules) => {
      const r: Rules = rules === 'territory' ? 'territory' : 'area';
      writeRules(ctxRef.current.store, r);
      commit({ ...ref.current, rules: r });
    },
    [commit],
  );

  const setHandicap = useCallback(
    (n: number) => {
      const st = ref.current;
      const h = normalizeHandicap(st.size, n);
      writeHandicap(ctxRef.current.store, st.size, h);
      commit({ ...st, handicap: h });
    },
    [commit],
  );

  const setTc = useCallback(
    (tc: TcString | null) => {
      const st = ref.current;
      const value = parseClockPref(tc);
      writeClock(ctxRef.current.store, st.size, value);
      commit({ ...st, tc: value });
    },
    [commit],
  );

  /* ---- opening and leaving ---- */
  const openSaved = useCallback(
    (saved: SavedGame) => {
      const st = ref.current;
      const { rooms, store: s, now: n } = ctxRef.current;
      if (rooms && opensRoom(saved, s)) {
        // Resuming a room game reconnects to its room (the controller loads it from the store).
        commit({ ...st, code: saved.code, session: null, roomInvite: null, room: { code: saved.code, create: null, review: null, reviewN: 0, openedAt: n() } });
        return true;
      }
      if (saved.mode === 'room' && !isFinished(saved)) {
        const onRoom = optsRef.current.onRoom;
        if (rooms || !onRoom || !onRoom(saved.code, null)) return false;
        commit({ ...st, code: saved.code, session: null, roomInvite: null, room: null });
        return true;
      }
      commit({ ...st, code: saved.code, roomInvite: null, room: null, session: sessionFromSaved(saved, n()) });
      return true;
    },
    [commit],
  );

  const start = useCallback(() => {
    const st = ref.current;
    const { store: s, rng: r, now: n } = ctxRef.current;
    const games = s.games();
    const code = isValidCode(st.code) ? st.code : freshCode(games, r);
    if (st.opponent.mode === 'room') {
      // Creating and joining are the same action (DESIGN 9.2): the controller finds out which.
      const create: RoomStartSettings = { tc: st.tc, color: st.colorChoice, size: st.size, rules: st.rules, handicap: st.handicap };
      if (ctxRef.current.rooms) {
        commit({ ...st, code, session: null, roomInvite: null, room: { code, create, review: null, reviewN: 0, openedAt: n() } });
        return true;
      }
      const onRoom = optsRef.current.onRoom;
      if (!onRoom || !onRoom(code, create)) return false;
      commit({ ...st, code, session: null, roomInvite: null });
      return true;
    }
    const pill = startPillFor(code, st.opponent, games);
    if (pill.saved) return openSaved(pill.saved);
    const mode = st.opponent.mode;
    const session = createSession(
      {
        code,
        mode,
        level: st.opponent.mode === 'computer' ? st.opponent.level : undefined,
        color: resolveColor(st.colorChoice, mode, r),
        tc: st.tc,
        settings: { size: st.size, rules: st.rules, handicap: st.handicap },
      },
      n(),
    );
    commit({ ...st, code, roomInvite: null, room: null, session });
    return true;
  }, [commit, openSaved]);

  const newGame = useCallback(() => {
    const st = ref.current;
    const { store: s, rng: r, now: n } = ctxRef.current;
    const cur = st.session;
    const mode: Mode = cur ? cur.mode : st.opponent.mode;
    if (mode === 'room' || st.room) return false;
    const level = cur ? cur.level : st.opponent.mode === 'computer' ? st.opponent.level : undefined;
    const settings: GameSettings = cur
      ? savedSettings(cur.game.settings)
      : { size: st.size, rules: st.rules, handicap: st.handicap };
    const code = freshCode(s.games(), r);
    const session = createSession(
      { code, mode, level, color: resolveColor(st.colorChoice, mode, r), tc: cur ? cur.tc : st.tc, settings },
      n(),
    );
    commit({ ...st, code, session });
    return true;
  }, [commit]);

  const exit = useCallback(() => {
    const st = ref.current;
    if (st.room) {
      // Leaving the room: useRoom disposes its session (transport closed, lock released, turn banked).
      commit({ ...st, code: st.room.code, session: null, room: null });
      notifySavedGames();
      return;
    }
    if (!st.session) return;
    commit({ ...st, code: st.session.code, session: null });
  }, [commit]);

  /** Room mode: the review cursor as it stands now (`roomReviewOf` against the controller's game). */
  const roomReview = useCallback((open: RoomOpen): number | null => {
    const rs = roomStateRef.current;
    const game = rs?.game ?? roomFallbackRef.current ?? placeholderGame(open);
    return roomReviewOf(open, rs?.n ?? 0, game.cursor);
  }, []);

  /* ---- playing ---- */
  const play = useCallback(
    (p: Point, ms?: number) => {
      const st = ref.current;
      if (st.room) return roomReview(st.room) === null && roomRef.current.move(p, ms);
      return update((s, at) => applyMove(s, p, ms ?? turnElapsed(), at));
    },
    [update, turnElapsed, roomReview],
  );
  const pass = useCallback(
    (ms?: number) => {
      const st = ref.current;
      if (st.room) return roomReview(st.room) === null && roomRef.current.pass(ms);
      return update((s, at) => {
        const next = applyPass(s, ms ?? turnElapsed(), at);
        // Round 2 without a proposer: scored at once with every stone alive (DESIGN 8.4 step 5).
        if (next && isScoring(next) && next.game.scoring!.round === 2 && !optsRef.current.proposeDead) {
          return applyScoreEnd(next, [], at) ?? next;
        }
        return next;
      });
    },
    [update, turnElapsed, roomReview],
  );
  const undo = useCallback(() => {
    // In a room, undo is a takeback request (DESIGN 4.2, 9.4).
    const st = ref.current;
    if (st.room) return roomReview(st.room) === null && roomRef.current.ask('takeback');
    return update((s, at) => applyUndo(s, at));
  }, [update, roomReview]);
  const redo = useCallback(() => update((s, at) => applyRedo(s, at)), [update]);
  const undoPass = useCallback(() => update((s, at) => applyUndoPass(s, at)), [update]);
  const resign = useCallback(() => {
    // Final in a room (DESIGN 8.3): the controller sends the end.
    if (ref.current.room) return roomRef.current.resign();
    return update((s, at) => applyResign(s, at));
  }, [update]);
  const reopen = useCallback(() => update((s, at) => applyReopen(s, at)), [update]);
  const finish = useCallback((result: Result) => update((s, at) => applyEnd(s, result, at)), [update]);
  const timeout = useCallback(
    (flagged: Color) => {
      // The controller decides: its own flag at zero, the opponent's 2 s past zero (DESIGN 9.7).
      if (ref.current.room) return roomRef.current.flag();
      return update((s, at) => applyTimeout(s, flagged, at));
    },
    [update],
  );
  const markAssisted = useCallback(() => {
    update((s) => applyAssisted(s));
  }, [update]);

  /* ---- scoring ---- */
  const toggleDead = useCallback((p: Point) => update((s, at) => applyToggle(s, p, at)), [update]);
  const acceptScore = useCallback((side?: Color) => update((s, at) => applyAccept(s, side ?? null, at)), [update]);
  const resumePlay = useCallback(() => update((s, at) => applyResume(s, at)), [update]);
  const setDead = useCallback(
    (dead: readonly Point[]) => {
      if (ref.current.room) return roomRef.current.mark(dead);
      return update((s, at) => applyMarks(s, dead, at));
    },
    [update],
  );

  /* ---- review ---- */
  /** Room mode: sets the review cursor of the room's current game; reaching the live position means live. */
  const roomGoto = useCallback(
    (cursor: (review: number | null, max: number) => number) => {
      const st = ref.current;
      if (!st.room) return;
      const rs = roomStateRef.current;
      const max = rs?.game.cursor ?? 0;
      const n = rs?.n ?? 0;
      const c = Math.max(0, Math.min(max, Math.floor(cursor(roomReviewOf(st.room, n, max), max))));
      const review = c === max ? null : c;
      if (review !== st.room.review || (review !== null && n !== st.room.reviewN)) {
        commit({ ...st, room: { ...st.room, review, reviewN: n } });
      }
    },
    [commit],
  );
  const goto = useCallback(
    (cursor: number) => {
      if (ref.current.room) roomGoto(() => cursor);
      else update((s) => applyGoto(s, cursor));
    },
    [update, roomGoto],
  );
  const step = useCallback(
    (delta: number) => {
      if (ref.current.room) roomGoto((r, max) => (r ?? max) + Math.trunc(delta));
      else update((s) => applyGoto(s, (s.review ?? s.game.cursor) + Math.trunc(delta)));
    },
    [update, roomGoto],
  );
  const toStart = useCallback(() => goto(0), [goto]);
  const toEnd = useCallback(() => {
    if (ref.current.room) roomGoto((_, max) => max);
    else update((s) => applyGoto(s, s.game.cursor));
  }, [update, roomGoto]);
  const enterReview = useCallback(
    (cursor?: number) => {
      if (ref.current.room) {
        roomGoto((r, max) => cursor ?? r ?? max);
        return;
      }
      update((s) => {
        const c = Math.max(0, Math.min(s.game.cursor, Math.floor(cursor ?? s.review ?? s.game.cursor)));
        return s.review === c ? s : { ...s, review: c };
      });
    },
    [update, roomGoto],
  );
  const exitReview = useCallback(() => {
    const st = ref.current;
    if (st.room) {
      if (st.room.review !== null) commit({ ...st, room: { ...st.room, review: null } });
      return;
    }
    update((s) => (s.game.end || s.review === null ? s : { ...s, review: null }));
  }, [update, commit]);

  /** The shown session: the open room's (derived from the controller), else the solo session. */
  const shownSession = useCallback((st: State): GameSession | null => {
    if (st.room) return roomSessionOf(st.room, roomStateRef.current, roomFallbackRef.current ?? placeholderGame(st.room));
    return st.session;
  }, []);

  const continueFromHere = useCallback(() => {
    const st = ref.current;
    // In a room the shown game is the controller's (with this hook's review cursor). The new game
    // is a solo game: room games are never forked into a room (DESIGN 12.3).
    const shown = shownSession(st);
    if (!shown) return false;
    const { store: s, rng: r, now: n } = ctxRef.current;
    const view = viewOf(shown);
    const size = view.settings.size;
    // The clock pill of that size: the start screen's value when it is the selected size.
    const tc = size === st.size ? st.tc : readClock(s, size, null);
    const spec = continueSpec(view, st.lastSolo, freshCode(s.games(), r), tc);
    if (!spec) return false;
    const session = createSession(spec, n());
    commit({ ...st, code: session.code, room: null, session });
    return true;
  }, [commit, shownSession]);

  /* ---- sharing ---- */
  const baseUrl = options.baseUrl;
  const shareUrl = useCallback(() => {
    const st = ref.current;
    const base = baseUrl ?? appBaseUrl();
    // Rooms share the invite only: `?s=CODE&o=r`, never moves or the key (DESIGN 13.2).
    if (st.room) return roomShareUrl(st.room.code, base);
    if (st.session) return buildShareUrl(toSavedGame(st.session), base);
    // Rooms share the invite only: `?s=CODE&o=r`, never moves or the key (DESIGN 13.2).
    if (st.opponent.mode === 'room' && isValidCode(st.code)) return roomShareUrl(st.code, base);
    return buildUrl(desiredUrl(st), base);
  }, [baseUrl]);

  const sgf = useCallback(() => {
    const s = shownSession(ref.current);
    return s ? sgfOf(s, optsRef.current.version ?? defaultVersion()) : null;
  }, [shownSession]);

  /* ---- derived ---- */
  const roomGame = roomState?.game ?? null;
  const roomColor = roomState?.color;
  const roomN = roomState?.n;
  const roomEpoch = roomState?.epoch;
  const roomTc = roomState && roomState.logs.length > 0 ? roomState.logs[roomState.logs.length - 1].tc : null;
  const roomSession = useMemo(
    () => (roomOpen ? roomSessionOf(roomOpen, roomStateRef.current, roomFallback ?? placeholderGame(roomOpen)) : null),
    // The derived session changes only when what it shows changes (not on every snapshot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomOpen, roomFallback, roomGame, roomColor, roomN, roomEpoch, roomTc],
  );
  const session = roomSession ?? state.session;
  // A rematch or a takeback that ended the room's review also drops the stored cursor, so the
  // game growing past it again (moves after the takeback) never brings the old review back.
  const roomReviewEnded = !!roomOpen && roomOpen.review !== null && roomSession?.review === null;
  useEffect(() => {
    const st = ref.current;
    if (roomReviewEnded && st.room && st.room.review !== null && roomReview(st.room) === null) {
      commit({ ...st, room: { ...st.room, review: null } });
    }
  }, [roomReviewEnded, roomReview, commit]);
  const view = useMemo(() => (session ? viewOf(session) : null), [session]);
  const roomScoringNow = !!roomSession && !!roomSession.game.scoring && !roomSession.game.end;
  const scoringNow = isScoring(session) || roomScoringNow;
  const phase: Phase = !session ? 'start' : session.review !== null ? 'review' : scoringNow ? 'scoring' : 'playing';
  const rule = session ? undoRuleFor(session.mode) : null;
  const liveGame = !!session && session.review === null && session.mode !== 'room';
  const canUndo = roomOpen
    ? session?.review === null && !!roomState?.canAsk.takeback
    : liveGame && !session.game.end && !!rule && undoTarget(session.game, rule, session.color) < session.game.cursor;
  const canRedo =
    liveGame && !!rule && !session.game.end && redoTarget(session.game, rule, session.color) > session.game.cursor;
  const playable = canPlay(session) && !session.game.scoring;
  const isPlayerTurn = roomOpen
    ? session?.review === null && !!roomState?.canMove && roomHandle.tab === 'owner'
    : playable && (session.mode === 'local' || session.game.turn === session.color);
  const isComputerTurn = isRunning(session) && session.mode === 'computer' && session.game.turn !== session.color;
  const canUndoPass = useMemo(() => !!session && applyUndoPass(session, 0) !== null, [session]);
  const reviewCursor = session?.review ?? null;
  const viewCursor = session ? (session.review ?? session.game.cursor) : 0;
  const finished = !!session?.game.end;

  // In a room the scoring actions go to the controller; marking needs the controller's consent
  // (seated, round 1, a proposal there or seat 0's hand, DESIGN 9.5), also offline (9.3).
  const soloActions = useMemo<ScoringActions>(
    () => ({ toggle: toggleDead, accept: acceptScore, resume: resumePlay }),
    [toggleDead, acceptScore, resumePlay],
  );
  const roomActions = roomHandle.scoringActions;
  const roomCanMark = !!roomHandle.scoring?.canMark && roomHandle.tab === 'owner';
  const roomScoringActions = useMemo<ScoringActions>(
    () => ({ toggle: roomCanMark ? roomActions.toggle : undefined, accept: roomActions.accept, resume: roomActions.resume }),
    [roomActions, roomCanMark],
  );
  const scoring = useScoring(view, roomOpen ? roomScoringActions : soloActions, {
    live: !!session && session.review === null,
    pending: roomOpen ? !!roomHandle.scoring?.proposing : proposing,
  });

  return {
    phase,
    session,
    view,

    code: state.code,
    opponent: state.opponent,
    colorChoice: state.colorChoice,
    size: state.size,
    rules: state.rules,
    handicap: state.handicap,
    tc: state.tc,
    setCode,
    regenerateCode,
    setOpponent,
    setColorChoice,
    setSize,
    setRules,
    setHandicap,
    setTc,
    startPill,
    preview,
    roomInvite: state.roomInvite,
    roomSaved,

    start,
    open: openSaved,
    newGame,
    exit,
    room: roomOpen ? roomHandle : null,

    play,
    pass,
    turnElapsed,
    undoRule: rule,
    canUndo,
    canRedo,
    undo,
    redo,
    canUndoPass,
    undoPass,
    resign,
    reopen,
    finish,
    timeout,
    markAssisted,
    isOver: finished,
    isScoring: scoringNow,
    isPlayerTurn,
    isComputerTurn,

    scoring,
    setDead,

    reviewCursor,
    enterReview,
    exitReview,
    goto,
    step,
    toStart,
    toEnd,
    canStepBack: !!session && viewCursor > 0,
    canStepForward: !!session && session.review !== null && session.review < session.game.cursor,
    continueFromHere,

    shareUrl,
    sgf,
  };
}

export default useGameState;
