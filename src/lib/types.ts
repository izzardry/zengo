/**
 * Zengo contracts.
 *
 * Every cross-package type and interface lives here (PLAN.md section 4). Packages code against
 * these shapes. A package that needs a change reports it to the orchestrator, which edits this
 * file serially. Shapes copied from DESIGN.md name their section.
 *
 * This file holds types and a handful of `as const` values only. No logic.
 *
 * Conventions used throughout:
 * - A `Point` is two SGF letters, column then row from the top (`aa` = top-left); `tt` = pass.
 * - Board arrays (`Game.board`, ownership maps) are row-major from the top: index = row × size + col,
 *   with row 0 the top row (SGF row `a`). Use `pointToIndex` / `indexToPoint` in `lib/zengo.ts`.
 * - Anything that can carry half points is an integer of half points ×2 (`komi2`, `margin`, …).
 */

/* ------------------------------------------------------------------------------------------------
 * Go primitives (PLAN 4, DESIGN 8, 13.2)
 * --------------------------------------------------------------------------------------------- */

/** Side: Black or White. */
export type Color = 'B' | 'W';

/** Board size. */
export type Size = 9 | 13 | 19;

/** Rule set (DESIGN 8.2): `area` = Chinese-style (default), `territory` = Japanese-style counting. */
export type Rules = 'area' | 'territory';

/** Two SGF letters, `aa` … `ss` (column, then row from the top); `tt` = pass (DESIGN 13.2). */
export type Point = string;

/** Play mode (DESIGN 3). `local` is pass-and-play ("Two players"). */
export type Mode = 'computer' | 'local' | 'room';

/**
 * Time control (DESIGN 11); `null` = clock off.
 * - Fischer `m+s`: base time, increment added after each completed move.
 * - Japanese byo-yomi `Mm P×Ss`: base time, then `periods` periods of `periodMs` each.
 */
export type TimeControl =
  | { readonly kind: 'fischer'; readonly baseMs: number; readonly incMs: number }
  | { readonly kind: 'byoyomi'; readonly baseMs: number; readonly periods: number; readonly periodMs: number }
  | null;

/**
 * Time control in its compact text form: `5+7` (Fischer) or `20m5x30` (byo-yomi). Used in URLs
 * (`t`), `SavedGame.tc` and protocol messages. Convert with `parseTc` / `formatTc` in `lib/zengo.ts`.
 */
export type TcString = string;

/** Game settings (DESIGN 8.2). `handicap` is 0 or 2–9 (2–5 on 9×9); `komi2` = komi ×2 (7.5 → 15). */
export interface Settings {
  readonly size: Size;
  readonly rules: Rules;
  readonly handicap: number;
  readonly komi2: number;
}

/** One ply of a game record (DESIGN 9.2): a point or `tt` for a pass, and the mover's ms. */
export interface Ply {
  readonly m: Point;
  /** Milliseconds the mover used for it, measured on the mover's device. */
  readonly ms: number;
}

/** How a game ended (DESIGN 9.2). */
export type Termination = 'score' | 'resign' | 'time';

/** Result of a game (DESIGN 9.2). There are no draws (half-point komi). */
export interface Result {
  readonly winner: Color;
  readonly by: Termination;
  /** For `by: 'score'`: the winning margin in half points ×2 (`B+4.5` → 9). */
  readonly margin?: number;
}

/**
 * The scoring phase (DESIGN 9.2, 8.4). Present after two consecutive passes.
 * `round` 2 = scoring reached again after a resume: scored directly, no marking round.
 */
export interface Scoring {
  readonly round: 1 | 2;
  /** Incremented on every toggle; the higher rev wins a reconcile. Starts at 0. */
  readonly rev: number;
  /** Dead stones as sorted SGF points. */
  readonly dead: readonly Point[];
  /** The rev each seat (or, in pass-and-play, each side: [Black, White]) accepted; 0 = none. */
  readonly accepted: readonly [number, number];
}

/* ------------------------------------------------------------------------------------------------
 * Game value and the rules core (PLAN 4, DESIGN 8.1)
 * --------------------------------------------------------------------------------------------- */

/**
 * Immutable game value. Every operation of `ZengoApi` returns a new one. The object and `plies`
 * are frozen; `board` is a typed array (which cannot be frozen) and must never be mutated.
 */
export interface Game {
  readonly settings: Settings;
  /** All recorded plies, including a redo tail beyond `cursor`. */
  readonly plies: readonly Ply[];
  /** Plies applied; `< plies.length` while redo is possible, or while reviewing. */
  readonly cursor: number;
  /** size², 0 empty, 1 black, 2 white, at `cursor`. Row-major from the top. */
  readonly board: Uint8Array;
  /** Side to move at `cursor`. White moves first with a handicap of 2 or more. */
  readonly turn: Color;
  /** Stones captured BY each color up to `cursor` (dead stones at scoring not included). */
  readonly prisoners: Readonly<Record<Color, number>>;
  /** Simple-ko point: the point the side to move may not retake this turn, else null. */
  readonly ko: Point | null;
  /**
   * Consecutive passes at `cursor`, counted since the last stone or the last `resume`
   * (so 0 right after a resume even when the last two plies are passes).
   */
  readonly passes: number;
  /** Present while the game is in the scoring phase (two consecutive passes, not resumed). */
  readonly scoring?: Scoring;
  /** Set when the game is over. `goto` keeps it; `undo` / `redo` drop it. */
  readonly end?: { readonly result: Result };
  /**
   * Addition: the start position of a game created from a set-up board (`newGame(settings, setup)`),
   * absent for a normal game (empty board plus handicap stones from `settings.handicap`).
   */
  readonly setup?: { readonly board: Uint8Array; readonly turn: Color };
}

/** Why a point cannot be played (`ZengoApi.illegalReason`). `ko` = the simple-ko point; `superko` = a longer cycle. */
export type IllegalReason = 'occupied' | 'suicide' | 'ko' | 'superko';

/** Header values for SGF export (DESIGN 13.3). Missing names and date are left out. */
export interface SgfMeta {
  /** App version for `AP[Zengo:<version>]`. */
  readonly version: string;
  /** `PB`, e.g. `Zengo Level 5` for the computer. */
  readonly black?: string;
  /** `PW`. */
  readonly white?: string;
  /** `DT`, ISO `YYYY-MM-DD`. */
  readonly date?: string;
  /** Written as `TM` (main time in seconds) and `OT` (overtime as free text). */
  readonly tc?: TimeControl | TcString | null;
}

/**
 * One side's clock derived from the ply log (DESIGN 11).
 * - Fischer: `mainMs` is the remaining time; `periodMs` and `periods` are 0.
 * - Byo-yomi: `mainMs` is the main time left; `periods` the periods left; `periodMs` the time the
 *   current period offers for the next move (a full period, because a move made inside a period
 *   keeps it). Out of time: `mainMs` 0, `periods` 0, `periodMs` 0.
 * - Clock off: `mainMs` is the time used so far; the rest 0.
 */
export interface ClockState {
  readonly mainMs: number;
  readonly periodMs: number;
  readonly periods: number;
}

/** What the engine is told about the clock of the side it moves for (`EngineApi.genmove`). */
export interface ClockInfo {
  readonly tc: NonNullable<TimeControl>;
  /** The engine's own clock at the start of its turn. */
  readonly left: ClockState;
}

/** A position handed to the engine (`ZengoApi.position`). Arrays are row-major from the top. */
export interface Position {
  readonly size: Size;
  readonly rules: Rules;
  readonly komi2: number;
  /** Stones on the board before the first ply (handicap or set-up). */
  readonly setup: { readonly B: readonly Point[]; readonly W: readonly Point[] };
  /** The color that made the first ply. */
  readonly first: Color;
  /** Plies applied, in order; `tt` = pass. */
  readonly moves: readonly Point[];
  /** Board after `moves`: size², 0 empty, 1 black, 2 white. */
  readonly board: Uint8Array;
  readonly turn: Color;
  readonly ko: Point | null;
}

/** `lib/zengo.ts` — pure, no React, no DOM. PLAN 4 first; additions documented in place. */
export interface ZengoApi {
  /** A new game; places the handicap stones of `settings.handicap` unless `setup` is given. */
  newGame(settings: Settings, setup?: { board: Uint8Array; turn: Color }): Game;
  /** occupied / suicide / ko / positional superko. False while scoring or after the end. */
  isLegal(g: Game, p: Point): boolean;
  /** Why the side to move cannot play `p`, by the rules alone (ignores scoring and end). Off-board = occupied. */
  illegalReason(g: Game, p: Point): IllegalReason | null;
  /** Plays at the cursor; throws on illegal, while scoring or after the end; drops the redo tail; `tt` passes. */
  play(g: Game, p: Point, ms: number): Game;
  /** A pass; the second consecutive pass enters scoring. Throws while scoring or after the end. */
  pass(g: Game, ms: number): Game;
  /** Moves the cursor back (keeps the redo tail). Drops `end`; undoing the second pass leaves scoring. */
  undo(g: Game, plies: number): Game;
  /** Moves the cursor forward along the redo tail. Drops `end`. */
  redo(g: Game, plies: number): Game;
  /** Moves the cursor anywhere in `0..plies.length` for review. Keeps `end`. */
  goto(g: Game, cursor: number): Game;
  /** The chain at `p`, sorted; [] for an empty point. */
  groupAt(g: Game, p: Point): Point[];
  /** Liberties of the chain at `p`; 0 for an empty point. */
  libertiesOf(g: Game, p: Point): number;
  /** Chains of `color` with exactly one liberty, each sorted, ordered by their first point. */
  atari(g: Game, color: Color): Point[][];
  /** Stones of the side to move put into atari that the opponent can capture at once by playing `p`; 0 if none or illegal. */
  selfAtariSize(g: Game, p: Point): number;
  /** Leaves scoring; play continues with the player to move; the next scoring is round 2. */
  resume(g: Game): Game;
  /** Ends the game at the cursor (drops the redo tail, keeps scoring). An ended game is returned unchanged. */
  end(g: Game, result: Result): Game;
  /** `D4`, `pass`. Columns A–T without I, rows from the bottom. */
  gtp(p: Point, size: Size): string;
  /** Inverse of `gtp`, case-insensitive; null if not a point on this board. */
  fromGtp(s: string, size: Size): Point | null;
  /** Two SGF letters per ply (DESIGN 13.2). Throws on a malformed ply. */
  encodeMoves(plies: readonly Ply[]): string;
  /** Inverse of `encodeMoves`. Returns the longest well-formed prefix (never throws). */
  decodeMoves(s: string): Point[];
  /** SGF FF[4] (DESIGN 13.3): all plies of a finished game, else the plies up to the cursor. */
  sgf(g: Game, meta: SgfMeta): string;
  /** Each side's clock at the cursor, excluding the running turn (each side's first move is untimed). */
  clocks(g: Game, tc: TimeControl): Record<Color, ClockState>;

  /* ---- additions (package 0b) ---- */

  /** Plays a sequence of plies (or points) from a new game. Resumes scoring implicitly when a ply follows it. Throws on an illegal ply. */
  replay(settings: Settings, plies: readonly (Ply | Point)[]): Game;
  /** Rebuilds a game from stored fields (`SavedGame`, `GameLog`). See `lib/zengo.ts`. */
  fromRecord(rec: GameRecordFields, opts?: { lenient?: boolean }): Game;
  /** Replaces the marks of the scoring phase (dead sorted and de-duplicated). Throws when not scoring. */
  setScoring(g: Game, scoring: Scoring): Game;
  /** Removes the ending so play can go on (the resign undo toast). */
  reopen(g: Game): Game;
  /** The engine's view of the game at the cursor. */
  position(g: Game): Position;
  /** Color that made ply `i` (0-based). */
  colorOfPly(g: Game, i: number): Color;
  /** The last applied ply's point (`tt` for a pass), or null at the start. */
  lastMove(g: Game): Point | null;
  /** Time used per side up to the cursor (sum of `ms`). */
  timeUsed(g: Game): Record<Color, number>;
  /** True when the side to move has moved before, so its clock is running (first move untimed). */
  clockRunning(g: Game): boolean;
}

/** The stored fields `ZengoApi.fromRecord` reads (a subset of `SavedGame`). */
export interface GameRecordFields {
  readonly size: Size;
  readonly rules: Rules;
  readonly handicap: number;
  /** Komi ×2; defaults to the rule set's komi for the handicap. */
  readonly komi2?: number;
  readonly moves: string;
  readonly ms?: readonly number[];
  readonly scoring?: Scoring;
  readonly result?: Result;
}

/* ------------------------------------------------------------------------------------------------
 * Scoring (DESIGN 8.4)
 * --------------------------------------------------------------------------------------------- */

/** One side's count. Whole points (stones and points are integers). */
export interface ScoreSide {
  /** Empty points (and points of dead opponent stones) counted for this side. */
  readonly territory: number;
  /** This side's living stones on the board. */
  readonly stones: number;
  /** Stones captured during play plus opponent stones marked dead (counted under territory rules only). */
  readonly prisoners: number;
}

/**
 * A count (`ScoringApi.score`). Totals and margin are half points ×2.
 * - Area: total2 = 2 × (stones + territory); White adds komi2 + compensation2.
 * - Territory: total2 = 2 × (territory + prisoners); White adds komi2.
 */
export interface Score {
  readonly rules: Rules;
  readonly B: ScoreSide;
  readonly W: ScoreSide;
  /** Komi ×2, added to White. */
  readonly komi2: number;
  /** Area rules with handicap: White gets 1 point per handicap stone, ×2 here; else 0. */
  readonly compensation2: number;
  readonly total2: Readonly<Record<Color, number>>;
  /** total2.B − total2.W; positive = Black ahead. */
  readonly margin2: number;
}

/** `lib/scoring.ts` — pure, over the vendored goscorer. */
export interface ScoringApi {
  /** Area or territory count (by `g.settings.rules`) of the board at the cursor with `dead` removed. */
  score(g: Game, dead: readonly Point[]): Score;
  /** Owner of every empty or dead point (null = nobody: dame, seki, neutral). Living stones are absent. */
  territory(g: Game, dead: readonly Point[]): Record<Point, Color | null>;
  /** Toggles the whole chain at `p` between alive and dead; returns the new dead set, sorted. */
  toggle(g: Game, dead: readonly Point[], p: Point): Point[];
  /**
   * Dead stones from an ownership map (size², row-major from the top, +1 = Black owns, −1 = White):
   * a stone whose ownership is ≥ 0.7 toward the opponent is dead. null → none dead. Sorted.
   */
  propose(g: Game, ownership: Float32Array | null): Point[];
  /** The result of a count: winner by `margin2`, `by: 'score'`, margin in half points ×2. */
  result(g: Game, score: Score): Result;
}

/* ------------------------------------------------------------------------------------------------
 * Engine (DESIGN 10, PLAN 4)
 * --------------------------------------------------------------------------------------------- */

/** Lifecycle of the lazily loaded engine worker. */
export type EngineState = 'idle' | 'loading' | 'ready' | 'failed';

/** The engine's networks: `small` = b6c96 (stage 1), `large` = b10c128 (stage 2). */
export type EngineNet = 'small' | 'large';

/** A search or evaluation budget. Without `visits` and `timeMs`: one network evaluation. */
export interface EngineSearchOptions {
  readonly visits?: number;
  readonly timeMs?: number;
  /** Default `small`. */
  readonly net?: EngineNet;
}

/**
 * One root move as the engine saw it. `winrate` / `scoreLead` are from the perspective of the side
 * to move in the position searched, after this move; absent for a move the search never visited.
 */
export interface EngineCandidate {
  readonly move: Point;
  /** Network policy of the move, 0..1. */
  readonly prior: number;
  /** Search visits; 0 for the policy-only levels 1–9. */
  readonly visits: number;
  readonly winrate?: number;
  readonly scoreLead?: number;
}

/** Extra control over `genmove` (package 2C's level rules). */
export interface EngineGenmoveOptions {
  /** Points the move must not be (for example a big self-atari); pass is always allowed. */
  readonly avoid?: readonly Point[];
  /** Seed of the move pickers (self-play, tests). Default random. */
  readonly seed?: number;
}

/**
 * What `genmove` resolves with. The real engine fills every field; the FakeEngine only `move`.
 * `move` is legal by `ZengoApi.isLegal` or `tt` (pass); the engine itself never resigns (DESIGN 10.4
 * is the caller's policy, using `winrate` and `scoreLead`).
 */
export interface EngineMove {
  readonly move: Point | 'resign';
  /** Win rate 0..1 and score lead in points of the position, for the side to move. */
  readonly winrate?: number;
  readonly scoreLead?: number;
  /**
   * Root moves best first (search levels: by play selection; policy levels: by policy): every
   * visited move and every move with a policy of at least 0.1 %, at most 64.
   */
  readonly candidates?: readonly EngineCandidate[];
  /** Visits spent (1 for the policy-only levels). */
  readonly visits?: number;
}

/** What `evaluate` resolves with. */
export interface EngineEvaluation {
  /** Win rate 0..1 for the side to move in the position (`Position.turn`). */
  readonly winrate: number;
  /** Score lead in points for the side to move (negative = behind), komi and handicap compensation included. */
  readonly scoreLead: number;
  /** size², row-major from the top, −1..1, +1 = Black (what `scoring.propose` expects). */
  readonly ownership: Float32Array;
  /** size² + 1 (last = pass), row-major from the top; 0 for illegal points; sums to 1. */
  readonly policy: Float32Array;
}

/**
 * `hooks/useZengoEngine` — and the FakeEngine used in tests.
 *
 * Perspective: every `winrate` and `scoreLead` is from the side to move in the given position;
 * `ownership` is from Black's (+1 = Black).
 */
export interface EngineApi {
  readonly state: EngineState;
  /** 0..1 while a network loads. */
  readonly progress: number;
  readonly backend: 'webgpu' | 'wasm' | null;
  /** Which networks the engine has loaded: `small` = b6c96 (stage 1), `large` = b10c128 (stage 2). */
  readonly nets: { readonly small: boolean; readonly large: boolean };
  /** Stage 1 loads the small net; stage 2 also the large one. */
  load(stage: 1 | 2): Promise<void>;
  /** The computer's move at `level` (DESIGN 10.2); rejects with an `AbortError` after `stop()`. */
  genmove(pos: Position, level: number, clock?: ClockInfo, opts?: EngineGenmoveOptions): Promise<EngineMove>;
  /** Never rejects: null on failure, timeout (counted from the call) or `stop()`. */
  evaluate(pos: Position, opts: EngineSearchOptions, timeoutMs?: number): Promise<EngineEvaluation | null>;
  /**
   * The best `n` moves of a short search (default 32 visits within 1.5 s on the small net), best
   * first; only legal moves, pass included when the search likes it. Rejects with an `AbortError`
   * after `stop()`.
   */
  analyze(
    pos: Position,
    n: number,
    opts?: EngineSearchOptions,
  ): Promise<{ move: Point; winrate: number; scoreLead: number; prior?: number; visits?: number }[]>;
  stop(): void;
}

/* ------------------------------------------------------------------------------------------------
 * Persistence (DESIGN 12.1, 13.1)
 * --------------------------------------------------------------------------------------------- */

/** Room seat: 0 = creator, 1 = joiner. */
export type Seat = 0 | 1;

/** A stored game (DESIGN 12.1). */
export interface SavedGame {
  /** The code for solo games, `${code}.${n}` for room games. */
  id: string;
  code: string;
  mode: Mode;
  /** Computer level 1–12; computer games only. */
  level?: number;
  /** This device's side; `B` in pass-and-play. */
  color: Color;
  size: Size;
  rules: Rules;
  /** 0 or 2–9. */
  handicap: number;
  /** `5+7`, `20m5x30` or null. */
  tc: TcString | null;
  /** Compact encoding (DESIGN 13.2). */
  moves: string;
  /** Time used per ply. */
  ms: number[];
  /** During or after scoring. */
  scoring?: Scoring;
  result?: Result;
  /** A hint, the territory preview, an undo or the guard was used (DESIGN 7). */
  assisted: boolean;
  room?: { n: number; epoch: number };
  createdAt: number;
  lastPlayedAt: number;
}

/** A stored room record and its seat lock. */
export interface Room {
  /** Room code, e.g. `K7QW2M`. */
  code: string;
  /** 128-bit random secret, base64url; shared by both devices. */
  key: string;
  seat: Seat;
  createdAt: number;
  /** Last successful sync. */
  lastSeenAt: number;
  /** Points per seat, in half points ×2 (a win adds 2). */
  score: [number, number];
  /** Ids of this room's games (`SavedGame.id`), oldest first. */
  games: string[];
}

/** `lib/storage.ts` — every read guarded, keys of DESIGN 13.1 under the `zengo:` prefix. */
export interface Store {
  /** Saved games, newest `lastPlayedAt` first. */
  games(): SavedGame[];
  /** Upsert by id; keeps newest first and at most 100. */
  saveGame(g: SavedGame): void;
  /** Removes and returns a game, for the undo toast. */
  deleteGame(id: string): SavedGame | undefined;
  /** Puts a deleted game back (undo toast). */
  restoreGame(g: SavedGame): void;
  rooms(): Room[];
  /** Upsert by code. */
  saveRoom(r: Room): void;
  /** Removes and returns a room record, for the undo toast. */
  deleteRoom(code: string): Room | undefined;
  /** A preference by its key without prefix (see `PrefKey`), or `fallback` if missing or unreadable. */
  pref<T>(key: string, fallback: T): T;
  setPref<T>(key: string, value: T): void;
}

/** Preference keys of DESIGN 13.1 (without the `zengo:` prefix). */
export type PrefKey =
  | 'opponent'
  | 'color'
  | 'size'
  | 'rules'
  | 'handicap'
  | 'clock'
  | 'helpers'
  | 'seating'
  | 'engine-backend'
  | 'lang'
  | 'tutorial-seen'
  | 'donation-shown'
  | 'install-dismissed';

/** Opponent selector value (DESIGN 4.1), stored under `zengo:opponent`. */
export type Opponent =
  | { readonly mode: 'room' }
  | { readonly mode: 'local' }
  | { readonly mode: 'computer'; readonly level: number };

/** Color pill value (DESIGN 4.1), stored under `zengo:color`. */
export type ColorChoice = 'random' | Color;

/** Pass-and-play seating (DESIGN 5.2), stored under `zengo:seating`. */
export type Seating = 'face' | 'side';

/** UI language (DESIGN 14), stored under `zengo:lang`. */
export type Language = 'en' | 'de' | 'fr' | 'es';

/* ------------------------------------------------------------------------------------------------
 * Rooms: sync record, protocol, transport, controller (DESIGN 9)
 * --------------------------------------------------------------------------------------------- */

/**
 * Live record of one game in a room (DESIGN 9.2).
 * Additions (a device restored by `grant` must learn each game's colors and settings,
 * which the design's shape does not carry): `black`, `tc`, `size`, `rules`, `handicap`.
 */
export interface GameLog {
  /** Game number within the room, 1-based. */
  n: number;
  /** Incremented on every accepted takeback. */
  epoch: number;
  plies: Ply[];
  /** Present after two consecutive passes (and kept after a scored end). */
  scoring?: Scoring;
  end?: { result: Result; by: Termination };
  /** Seat that plays Black in this game. */
  black: Seat;
  /** Time control of this game, or null. */
  tc: TcString | null;
  size: Size;
  rules: Rules;
  handicap: number;
}

/** The request kinds of DESIGN 9.4. There is no draw request in Go. */
export type RequestKind = 'takeback' | 'rematch';

/** Current protocol version (DESIGN 9.6). */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** First message both ways. `nonce` is random, base64url. */
export interface HelloMsg { t: 'hello'; v: ProtocolVersion; hasKey: boolean; nonce: string }
/** HMAC-SHA-256(key, other side's nonce), base64url. */
export interface ProofMsg { t: 'proof'; v: ProtocolVersion; mac: string }
/** A device without a key asks for seat 1 of an open room. */
export interface JoinMsg { t: 'join'; v: ProtocolVersion }
/** Answer to `join` (DESIGN 9.1): the key, the joiner's seat and color, and the creator's game settings. */
export interface WelcomeMsg {
  t: 'welcome';
  v: ProtocolVersion;
  key: string;
  seat: Seat;
  tc: TcString | null;
  color: Color;
  size: Size;
  rules: Rules;
  handicap: number;
}
/** A device without a key asks for its seat back in a locked room. */
export interface RejoinMsg { t: 'rejoin'; v: ProtocolVersion }
/** Rejoin allowed: everything the lost device needs. `score` is per seat, half points ×2. */
export interface GrantMsg { t: 'grant'; v: ProtocolVersion; key: string; seat: Seat; score: [number, number]; games: GameLog[] }
/** Rejoin declined. */
export interface DenyMsg { t: 'deny'; v: ProtocolVersion }
/**
 * Reconcile summary of the current game. `hash` covers the plies and the scoring state.
 * `turnMs`: the ms the sender has already used on its own running turn, reported after a pause.
 */
export interface HeadMsg { t: 'head'; v: ProtocolVersion; n: number; epoch: number; len: number; hash: string; ended: boolean; turnMs?: number }
/** Reconcile payload: games the other side is missing, the current one last. */
export interface LogsMsg { t: 'logs'; v: ProtocolVersion; games: GameLog[] }
/** One live ply (DESIGN 9.6): `m` is two SGF letters or `tt` for a pass. */
export interface MoveMsg { t: 'move'; v: ProtocolVersion; n: number; epoch: number; i: number; m: Point; ms: number }
/** Acknowledges ply `i`. */
export interface AckMsg { t: 'ack'; v: ProtocolVersion; n: number; epoch: number; i: number }
/** A scoring proposal or toggle (DESIGN 9.5, 9.6). `dead` sorted. */
export interface MarkMsg { t: 'mark'; v: ProtocolVersion; n: number; epoch: number; rev: number; dead: Point[] }
/** Acceptance of the marking at `rev`. */
export interface AcceptMsg { t: 'accept'; v: ProtocolVersion; n: number; rev: number }
/** Leave scoring and play on. */
export interface ResumeMsg { t: 'resume'; v: ProtocolVersion; n: number; epoch: number }
/** A request (`n`, `epoch`, `len` let the receiver drop a stale one). */
export interface AskMsg { t: 'ask'; v: ProtocolVersion; kind: RequestKind; n: number; epoch: number; len: number }
/** Answer to `ask`, echoing its context. */
export interface ReplyMsg { t: 'reply'; v: ProtocolVersion; kind: RequestKind; ok: boolean; n: number; epoch: number; len: number }
/** Resign, time, or a round-2 score with the dead set it was counted from (DESIGN 9.6). */
export interface EndMsg { t: 'end'; v: ProtocolVersion; n: number; result: Result; by: Termination; dead?: Point[] }
/** Liveness every 5 s; three misses mark the peer disconnected. */
export interface PingMsg { t: 'ping'; v: ProtocolVersion }
export interface PongMsg { t: 'pong'; v: ProtocolVersion }

/** Every data-channel message, discriminated by `t`. JSON over the wire. */
export type Message =
  | HelloMsg
  | ProofMsg
  | JoinMsg
  | WelcomeMsg
  | RejoinMsg
  | GrantMsg
  | DenyMsg
  | HeadMsg
  | LogsMsg
  | MoveMsg
  | AckMsg
  | MarkMsg
  | AcceptMsg
  | ResumeMsg
  | AskMsg
  | ReplyMsg
  | EndMsg
  | PingMsg
  | PongMsg;

/** The `t` tags of all messages. */
export type MessageType = Message['t'];

/** State of a transport connection. */
export type TransportState = 'connecting' | 'open' | 'closed' | 'failed';

/** Why a transport failed. */
export type TransportFailure = 'broker-unreachable' | 'id-taken' | 'ice-failed' | 'timeout';

/** `lib/transport` — one reliable, ordered data channel. */
export interface Transport {
  /** Transport role only; gives no authority over the game. */
  readonly role: 'anchor' | 'dialer';
  send(msg: Message): void;
  onMessage(cb: (msg: Message) => void): void;
  onState(cb: (s: TransportState) => void): void;
  close(): void;
}
export type TransportFactory = (code: string) => Promise<Transport>;

/** Presence of the opponent as the dot shows it. */
export type Presence = 'connecting' | 'waiting' | 'connected' | 'reconnecting';

/** Room lock state as seen from this device. */
export type RoomLock = 'open' | 'locked' | 'rejoin-pending';

/** Why the board is not playable for this device right now. */
export type LockReason =
  /** Timed game while the opponent is disconnected. */
  | 'disconnected'
  /** The room is open in another tab. */
  | 'other-tab'
  /** This device has no seat yet (waiting for welcome or grant). */
  | 'no-seat'
  /** The opponent runs another protocol version. */
  | 'version'
  /** Rejoin was declined or the challenge failed. */
  | 'denied';

/** One-off events the UI turns into toasts. */
export type RoomNoticeKind =
  | 'opponent-joined'
  | 'opponent-connected'
  | 'opponent-disconnected'
  | 'reconnected'
  | 'restored-from-opponent'
  | 'sync-error'
  | 'version-mismatch'
  | 'rejoin-denied'
  | 'challenge-failed'
  | 'request-declined'
  | 'ice-failed';

export interface RoomNotice {
  /** Increases with every notice so the UI shows each one once. */
  readonly id: number;
  readonly kind: RoomNoticeKind;
  /** For `request-declined`: which request. */
  readonly request?: RequestKind;
}

/** Everything the room UI renders. Produced by `RoomController`. */
export interface RoomSnapshot {
  readonly code: string;
  readonly presence: Presence;
  readonly role: 'anchor' | 'dialer' | null;
  readonly lock: RoomLock;
  /** This device's seat; null until joined or granted. */
  readonly seat: Seat | null;
  /** Points per seat, half points ×2. */
  readonly score: readonly [number, number];
  /** Current game number and takeback epoch. */
  readonly n: number;
  readonly epoch: number;
  /** The current game (settings, plies, scoring, end). */
  readonly game: Game;
  /** This device's color in the current game. */
  readonly color: Color;
  readonly tc: TimeControl;
  /** Pending requests. `incoming` may also be a rejoin request from a new device. */
  readonly requests: {
    readonly incoming?: RequestKind | 'rejoin';
    readonly outgoing?: RequestKind;
  };
  /** Non-null while the board is locked for this device. */
  readonly locked: LockReason | null;
  /** Plies played here but not yet acknowledged by the opponent. */
  readonly unsent: number;
  /** Running-turn clock. Stopped during scoring. */
  readonly clock: { readonly paused: boolean; readonly turnStart: number | null; readonly turnUsed: number };
  /** The latest notice, if any. */
  readonly notice: RoomNotice | null;
  /** Failure of the last connection attempt, for the calm failure message. */
  readonly failure: TransportFailure | null;
}

/** `lib/room.ts` — the room controller, with Go's pass, marking, Accept and Resume (PLAN 4). */
export interface RoomController {
  readonly snapshot: RoomSnapshot;
  subscribe(cb: (s: RoomSnapshot) => void): () => void;
  move(point: Point, ms: number): void;
  pass(ms: number): void;
  /** Sends a scoring proposal or toggle (the full dead set). */
  mark(dead: Point[]): void;
  accept(): void;
  resume(): void;
  ask(kind: RequestKind): void;
  reply(kind: RequestKind | 'rejoin', ok: boolean): void;
  resign(): void;
  flag(): void;
  leave(): void;
}

/* ------------------------------------------------------------------------------------------------
 * Injected time and randomness (PLAN 4)
 * --------------------------------------------------------------------------------------------- */

/** Monotonic or wall clock in ms, injected so tests are deterministic. */
export type Now = () => number;
/** Uniform random number in [0, 1), injected so tests are deterministic. */
export type Rng = () => number;
