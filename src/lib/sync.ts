/**
 * Room sync (DESIGN 9, 9.2, 9.3, 9.5, 12.1) — pure and framework-free.
 *
 * - Log hashing and the `head` summary message.
 * - `reconcile`: the five reconcile rules plus the scoring rule of DESIGN 9.2, as one function used twice
 *   per connection: first with the other side's `head`, then with any `logs` it sends. Every adopted
 *   log is validated by replaying it from the start through `ZengoApi` (positional superko included).
 * - Live-play helpers on a `GameLog`: applying a received ply (a point or `tt` for a pass),
 *   takeback, rematch, and the scoring phase (mark, accept, resume, the scored end), including the
 *   handlers of the live `mark`, `accept`, `resume` and round-2 `end` messages. Crossing scoring
 *   messages settle by the same rule 6 as the reconcile (`settleScoring`), so live play and a later
 *   reconcile always agree. Dead stones are always data: nothing here asks an engine.
 * - Room score across games (a win adds 2 half points ×2; Go has no draws).
 * - Seat key: generation, nonces and the HMAC-SHA-256 proof through WebCrypto.
 * - Conversion between `GameLog` and the stored `SavedGame`.
 *
 * Time and randomness are injected (`rng`); nothing here reads the clock, storage or the network.
 */
import type {
  Color,
  Game,
  GameLog,
  HeadMsg,
  LogsMsg,
  MoveMsg,
  Ply,
  Point,
  Result,
  Rng,
  Rules,
  SavedGame,
  Scoring,
  Seat,
  Settings,
  Size,
  Termination,
  ZengoApi,
} from './types';
import { PROTOCOL_VERSION } from './types';
import zengo, { isPoint, isValidMoves, makeSettings, MAX_PLIES, normalizeHandicap, parseTc, PASS, pointToIndex } from './zengo';
import scoringApi from './scoring';

/* ---------------------------------------------------------------------------------------------- */
/* Small helpers                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

/** How a room game ended (`GameLog.end`). */
export type LogEnd = NonNullable<GameLog['end']>;

/** The game settings a log carries. */
export type LogSettings = Pick<GameLog, 'size' | 'rules' | 'handicap'>;

/** Settings of a room created without any (an invite link opened by two newcomers): 9×9, area, no handicap. */
export const DEFAULT_LOG_SETTINGS: LogSettings = Object.freeze({ size: 9, rules: 'area', handicap: 0 });

const TERMINATIONS: ReadonlySet<string> = new Set<Termination>(['score', 'resign', 'time']);
const SIZES: ReadonlySet<unknown> = new Set<Size>([9, 13, 19]);
const RULES: ReadonlySet<unknown> = new Set<Rules>(['area', 'territory']);

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** The other seat. */
export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** The other color. */
export function otherColor(c: Color): Color {
  return c === 'B' ? 'W' : 'B';
}

/** This seat's color in a game. */
export function colorOf(log: Pick<GameLog, 'black'>, seat: Seat): Color {
  return log.black === seat ? 'B' : 'W';
}

/** The seat that plays `color` in a game. */
export function seatOf(log: Pick<GameLog, 'black'>, color: Color): Seat {
  return color === 'B' ? log.black : otherSeat(log.black);
}

/** The color that makes the first ply: White with a handicap of 2 or more, else Black. */
export function firstColor(log: Pick<GameLog, 'handicap'>): Color {
  return log.handicap >= 2 ? 'W' : 'B';
}

/** The color that made ply `i` (0-based). Room games start from the empty board plus handicap. */
export function colorOfPly(log: Pick<GameLog, 'handicap'>, i: number): Color {
  const first = firstColor(log);
  return i % 2 === 0 ? first : otherColor(first);
}

/** The rules-core settings of a log (default komi for its rules and handicap). */
export function settingsOf(log: LogSettings): Settings {
  return makeSettings(log.size, log.rules, log.handicap);
}

/** The current game: the log with the highest `n`, or undefined for an empty list. */
export function currentLog(logs: readonly GameLog[]): GameLog | undefined {
  let best: GameLog | undefined;
  for (const l of logs) if (!best || l.n > best.n) best = l;
  return best;
}

/** Sorts logs by game number, oldest first, keeping one log per `n` (the last one given wins). */
export function sortLogs(logs: readonly GameLog[]): GameLog[] {
  const byN = new Map<number, GameLog>();
  for (const l of logs) byN.set(l.n, l);
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

function samePly(a: Ply, b: Ply): boolean {
  return a.m === b.m && a.ms === b.ms;
}

function sameResult(a: Result, b: Result): boolean {
  return a.winner === b.winner && a.by === b.by && (a.margin ?? null) === (b.margin ?? null);
}

function sameEnd(a: LogEnd | undefined, b: LogEnd | undefined): boolean {
  if (!a || !b) return a === b;
  return a.by === b.by && sameResult(a.result, b.result);
}

function sameScoring(a: Scoring | undefined, b: Scoring | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.round === b.round &&
    a.rev === b.rev &&
    a.accepted[0] === b.accepted[0] &&
    a.accepted[1] === b.accepted[1] &&
    a.dead.length === b.dead.length &&
    a.dead.every((p, i) => p === b.dead[i])
  );
}

/** Length of the common prefix of two ply lists (move and time must both match). */
export function commonPrefix(a: readonly Ply[], b: readonly Ply[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && samePly(a[i], b[i])) i++;
  return i;
}

/** A plain, mutable copy of a scoring state (dead sorted and de-duplicated). */
function plainScoring(s: Scoring): Scoring {
  return { round: s.round === 2 ? 2 : 1, rev: s.rev, dead: [...new Set(s.dead)].sort(), accepted: [s.accepted[0], s.accepted[1]] };
}

/* ---------------------------------------------------------------------------------------------- */
/* Hashing and head                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

/**
 * 64-bit non-cryptographic string hash (two 32-bit multiply-xorshift lanes, cyrb53 style), as 16
 * lower-case hex digits. Stable across devices and JS engines.
 */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (x: number) => (x >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/**
 * Hash of a game's identity and its first `len` plies (default: all): `n`, `epoch`, `black`, `tc`,
 * the settings (size, rules, handicap) and every ply's point and time. Neither the scoring state nor
 * the end is included, so the hash of a prefix can be compared with the other side's `head`.
 * 16 hex digits.
 */
export function pliesHash(log: GameLog, len: number = log.plies.length): string {
  const k = Math.max(0, Math.min(log.plies.length, Math.floor(len)));
  let s = `${log.n}|${log.epoch}|${log.black}|${log.tc ?? '-'}|${log.size}|${log.rules}|${log.handicap}|`;
  for (let i = 0; i < k; i++) s += `${log.plies[i].m},${log.plies[i].ms};`;
  return hashString(s);
}

/** `B+score9`, `W+resign`: the end as it appears in a `head.hash`. */
function endTag(end: LogEnd): string {
  return `${end.result.winner}+${end.by}${end.result.margin ?? ''}`;
}

/** The scoring state as it appears in a `head.hash`: round, rev, acceptances and a hash of the dead set. */
function scoringTag(s: Scoring): string {
  return `s${s.round}r${s.rev}a${s.accepted[0]}-${s.accepted[1]}d${hashString(s.dead.join(''))}`;
}

/**
 * The `head.hash` of a log: `pliesHash`, followed by `.<scoring>` while (or after) scoring and by
 * `.<end>` when the game is over, e.g. `3f2a…9c`, `3f2a…9c.s1r2a2-0d…` or `3f2a…9c.W+resign`. Two logs
 * have the same hash exactly when they agree on the identity, every ply, the scoring state and the end.
 */
export function hashLog(log: GameLog): string {
  let h = pliesHash(log);
  if (log.scoring) h += `.${scoringTag(log.scoring)}`;
  if (log.end) h += `.${endTag(log.end)}`;
  return h;
}

/** The plies part of a `head.hash` (everything before the first `.`). */
export function headPliesHash(hash: string): string {
  const i = hash.indexOf('.');
  return i < 0 ? hash : hash.slice(0, i);
}

/**
 * The `head` reconcile summary of this device's current game. `log` is the current game, or
 * undefined when this device has no game in the room yet (then `n` is 0). `turnMs` is the time this
 * device has already used on its own running turn; pass it only when it is this device's turn.
 */
export function makeHead(log: GameLog | undefined, turnMs?: number): HeadMsg {
  const head: HeadMsg = log
    ? { t: 'head', v: PROTOCOL_VERSION, n: log.n, epoch: log.epoch, len: log.plies.length, hash: hashLog(log), ended: !!log.end }
    : { t: 'head', v: PROTOCOL_VERSION, n: 0, epoch: 0, len: 0, hash: '', ended: false };
  if (turnMs !== undefined && Number.isFinite(turnMs)) head.turnMs = Math.max(0, Math.round(turnMs));
  return head;
}

/** A `logs` message (games oldest first, the current one last). */
export function makeLogs(games: readonly GameLog[]): LogsMsg {
  return { t: 'logs', v: PROTOCOL_VERSION, games: sortLogs(games) };
}

/* ---------------------------------------------------------------------------------------------- */
/* Validation                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

export type ValidLog = { ok: true; log: GameLog; game: Game };
export type InvalidLog = { ok: false; error: string };

/** The scored result of a game in scoring with its marked dead stones (DESIGN 8.1: a pure function). */
export function scoredResult(g: Game, dead: readonly Point[]): Result {
  return scoringApi.result(g, scoringApi.score(g, dead));
}

function readResult(raw: unknown): Result | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.winner !== 'B' && r.winner !== 'W') return null;
  if (typeof r.by !== 'string' || !TERMINATIONS.has(r.by)) return null;
  const by = r.by as Termination;
  if (by === 'score') {
    if (!isCount(r.margin)) return null;
    return { winner: r.winner, by, margin: r.margin };
  }
  if (r.margin !== undefined && r.margin !== null) return null;
  return { winner: r.winner, by };
}

function readScoring(raw: unknown, size: number): Scoring | string {
  if (typeof raw !== 'object' || raw === null) return 'bad scoring';
  const s = raw as Record<string, unknown>;
  if (s.round !== 1 && s.round !== 2) return 'bad scoring round';
  if (!isCount(s.rev)) return 'bad scoring rev';
  if (!Array.isArray(s.dead) || !s.dead.every((p) => isPoint(p, size))) return 'bad dead stones';
  const acc = s.accepted;
  if (!Array.isArray(acc) || acc.length !== 2 || !acc.every((a) => isCount(a) && a <= (s.rev as number))) return 'bad acceptances';
  return { round: s.round, rev: s.rev, dead: [...new Set(s.dead as string[])].sort(), accepted: [acc[0] as number, acc[1] as number] };
}

/**
 * Checks a log received from the other device (any JSON) and replays it from the start through
 * `api` (an illegal ply, positional superko included, aborts the sync).
 *
 * Rejects: wrong shapes, `n < 1`, a negative epoch, an unknown seat, an unreadable time control,
 * a size other than 9/13/19, unknown rules, a handicap Zengo does not offer on that size, more than
 * `MAX_PLIES` plies, a point off the board, an illegal ply, a scoring state without two consecutive
 * passes at the end (or with dead points that are not stones), an end whose `by` differs from its
 * result's, a scored end that both seats did not accept, and a scored end whose result is not the
 * count of the marked dead stones.
 *
 * A ply that follows a double pass resumes scoring first (as `ZengoApi.replay`). A log that ends in a
 * double pass without `scoring` was resumed; with `scoring` it is in (or was ended in) scoring.
 *
 * The returned log is a fresh, normalized copy: whole, non-negative ms (as `api.play` stores them),
 * the scoring round derived from the plies and the dead set sorted. `game` is the replayed game with
 * its scoring state and end applied.
 */
export function validateLog(raw: unknown, api: ZengoApi = zengo): ValidLog | InvalidLog {
  const bad = (error: string): InvalidLog => ({ ok: false, error });
  if (typeof raw !== 'object' || raw === null) return bad('not an object');
  const r = raw as Record<string, unknown>;
  const { n, epoch, black, tc, plies, end, size, rules, handicap, scoring } = r;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return bad('bad n');
  if (!isCount(epoch)) return bad('bad epoch');
  if (black !== 0 && black !== 1) return bad('bad black');
  if (tc !== null && (typeof tc !== 'string' || parseTc(tc) === null)) return bad('bad tc');
  if (!SIZES.has(size)) return bad('bad size');
  if (!RULES.has(rules)) return bad('bad rules');
  const sz = size as Size;
  if (!isCount(handicap) || normalizeHandicap(sz, handicap) !== handicap) return bad('bad handicap');
  if (!Array.isArray(plies)) return bad('bad plies');
  if (plies.length > MAX_PLIES) return bad('too many plies');
  let ending: LogEnd | undefined;
  if (end !== undefined && end !== null) {
    if (typeof end !== 'object') return bad('bad end');
    const e = end as Record<string, unknown>;
    const result = readResult(e.result);
    if (!result) return bad('bad result');
    if (e.by !== result.by) return bad('bad termination');
    ending = { result, by: result.by };
  }
  let marks: Scoring | undefined;
  if (scoring !== undefined && scoring !== null) {
    const s = readScoring(scoring, sz);
    if (typeof s === 'string') return bad(s);
    marks = s;
  }

  const settings = makeSettings(sz, rules as Rules, handicap);
  let g = api.newGame(settings);
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i] as unknown;
    if (typeof p !== 'object' || p === null) return bad(`bad ply ${i}`);
    const { m, ms } = p as Record<string, unknown>;
    if (typeof m !== 'string' || (m !== PASS && !isPoint(m, sz))) return bad(`bad move at ply ${i}`);
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return bad(`bad time at ply ${i}`);
    try {
      if (g.scoring) g = api.resume(g);
      g = api.play(g, m, ms);
    } catch {
      return bad(`illegal ply ${i}: ${m}`);
    }
  }

  if (g.scoring) {
    if (marks) {
      for (const p of marks.dead) if (g.board[pointToIndex(p, sz)] === 0) return bad('dead point is not a stone');
      g = api.setScoring(g, { ...marks, round: g.scoring.round });
    } else {
      g = api.resume(g);
    }
  } else if (marks) {
    return bad('scoring without two passes');
  }

  if (ending) {
    if (ending.by === 'score') {
      if (!g.scoring) return bad('scored end without scoring');
      // DESIGN 9.5: a game ends by score only when both seats accepted the same marking (round 2
      // stores seat 0's proposal as accepted by both).
      if (g.scoring.rev < 1 || g.scoring.accepted[0] !== g.scoring.rev || g.scoring.accepted[1] !== g.scoring.rev) {
        return bad('scored end without both acceptances');
      }
      if (!sameResult(ending.result, scoredResult(g, g.scoring.dead))) return bad('score does not match the marking');
    }
    g = api.end(g, ending.result);
  }

  const log: GameLog = {
    n,
    epoch,
    plies: g.plies.map((p) => ({ m: p.m, ms: p.ms })),
    black,
    tc: (tc as string | null) ?? null,
    size: sz,
    rules: rules as Rules,
    handicap,
  };
  if (g.scoring) log.scoring = plainScoring(g.scoring);
  if (ending) log.end = { result: { ...ending.result }, by: ending.by };
  return { ok: true, log, game: g };
}

/** The game of a log (replayed, scoring and end applied). Throws on an invalid log. */
export function logToGame(log: GameLog, api: ZengoApi = zengo): Game {
  const v = validateLog(log, api);
  if (!v.ok) throw new Error(`Invalid game log: ${v.error}`);
  return v.game;
}

/** The game of a trusted log (this device's own), without the end: replay plus the scoring state. */
function playable(log: GameLog, api: ZengoApi): Game {
  let g = api.replay(settingsOf(log), log.plies);
  if (g.scoring) g = log.scoring ? api.setScoring(g, { ...log.scoring, round: g.scoring.round }) : api.resume(g);
  return g;
}

/* ---------------------------------------------------------------------------------------------- */
/* Comparing two copies of one game (rules 2–6)                                                     */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Which copy of a game wins, and whether they were a true fork (rule 4). `merged`: neither copy
 * as it is, but a settled state built from both (rule 6: crossing acceptances, or crossing toggles
 * of the same rev); both devices build the identical log.
 */
export interface Comparison {
  winner: 'local' | 'remote' | 'same' | 'merged';
  /** Rule 4 decided it: seat 0's copy won over a contradicting one. */
  fork: boolean;
  /**
   * The rule that decided (2 epoch, 3 prefix, 4 fork, 5 finished, 6 scoring), or 0 when the copies
   * are identical.
   */
  rule: 0 | 2 | 3 | 4 | 5 | 6;
  /** The settled log (`winner: 'merged'` only). */
  merged?: GameLog;
}

function sameDead(a: Scoring, b: Scoring): boolean {
  return a.dead.length === b.dead.length && a.dead.every((p, i) => p === b.dead[i]);
}

/**
 * Settles two scoring states of the same plies and the same end (rule 6, DESIGN 9.2). `s0` is seat
 * 0's copy, `s1` seat 1's; `open` is true while the game is not over. Returns the state both devices
 * keep: one of the two inputs (the same object), `undefined` (resumed), or a new merged state.
 * A pure function of the two copies, so both devices reach the same answer in any order.
 *
 * - A resumed copy (no scoring after the double pass) wins over a copy still scoring: a resume is
 *   the only way out of scoring, so it came later.
 * - The higher `rev` wins.
 * - Equal `rev` with a different dead set (two toggles that crossed on the wire): seat 0's dead set
 *   wins (DESIGN 9.2). While the game is open it is kept at `rev + 1` with both acceptances cleared,
 *   so an `accept` that either side sent for the contested `rev` is stale everywhere and can never
 *   end the game on a marking its sender did not see. After the end, seat 0's copy is kept as it is.
 * - Equal marks: the acceptances merge (each seat's higher one). An `accept` that reached one side
 *   only, and two accepts of the same rev that crossed, both converge to the union.
 */
export function settleScoring(s0: Scoring | undefined, s1: Scoring | undefined, open: boolean): Scoring | undefined {
  if (!s0 || !s1) return undefined;
  if (s0.rev !== s1.rev) return s0.rev > s1.rev ? s0 : s1;
  if (!sameDead(s0, s1)) {
    if (!open) return s0;
    return { round: s0.round, rev: s0.rev + 1, dead: [...s0.dead], accepted: [0, 0] };
  }
  const a0 = Math.max(s0.accepted[0], s1.accepted[0]);
  const a1 = Math.max(s0.accepted[1], s1.accepted[1]);
  if (a0 === s0.accepted[0] && a1 === s0.accepted[1]) return s0;
  if (a0 === s1.accepted[0] && a1 === s1.accepted[1]) return s1;
  return { round: s0.round, rev: s0.rev, dead: [...s0.dead], accepted: [a0, a1] };
}

/**
 * A copy of `log` with the settled scoring state; an open game whose marking both seats accepted
 * ends by score at once (DESIGN 9.5: each device counts the shared dead stones).
 */
function withScoring(log: GameLog, s: Scoring, api: ZengoApi): GameLog {
  const out: GameLog = { ...log, plies: log.plies.map((p) => ({ m: p.m, ms: p.ms })), scoring: plainScoring(s) };
  if (log.end) {
    out.end = { result: { ...log.end.result }, by: log.end.by };
    return out;
  }
  if (bothAccepted(out)) {
    const end = scoreEnd(out, api);
    if (end) return endLog(out, end);
  }
  return out;
}

/**
 * Compares two copies of the same game `n`. Antisymmetric: the other device, comparing the same two
 * copies from its side with its own seat, reaches the mirrored verdict (and an identical `merged`).
 *
 * 2. The higher epoch wins.
 * 3. If one ply list is a prefix of the other, the longer wins.
 * 4. Equal length with different content, or any other contradiction: seat 0's copy wins.
 * 5. Of two identical ply lists, the finished copy wins.
 * 6. Of two identical ply lists with the same end, the scoring state decides (`settleScoring`).
 *    Rule 6 never reports a fork: crossing toggles and crossing accepts happen in normal play.
 *
 * Where the design is silent (as in the original room design): a finished copy also beats a longer unfinished copy that
 * continues it (an offline resignation crossing an offline move), and two finished copies of
 * different length or with different ends are a fork (rule 4).
 */
export function compareLogs(local: GameLog, remote: GameLog, localSeat: Seat, api: ZengoApi = zengo): Comparison {
  const fork = (): Comparison => ({ winner: localSeat === 0 ? 'local' : 'remote', fork: true, rule: 4 });
  if (local.epoch !== remote.epoch) {
    return { winner: local.epoch > remote.epoch ? 'local' : 'remote', fork: false, rule: 2 };
  }
  if (
    local.black !== remote.black ||
    local.tc !== remote.tc ||
    local.size !== remote.size ||
    local.rules !== remote.rules ||
    local.handicap !== remote.handicap
  ) {
    return fork();
  }
  const lp = local.plies;
  const rp = remote.plies;
  const p = commonPrefix(lp, rp);
  if (p === lp.length && p === rp.length) {
    if (sameEnd(local.end, remote.end)) {
      if (sameScoring(local.scoring, remote.scoring)) return { winner: 'same', fork: false, rule: 0 };
      const [s0, s1] = localSeat === 0 ? [local.scoring, remote.scoring] : [remote.scoring, local.scoring];
      const s = settleScoring(s0, s1, !local.end);
      if (s === undefined) return { winner: local.scoring ? 'remote' : 'local', fork: false, rule: 6 };
      if (s === local.scoring) return { winner: 'local', fork: false, rule: 6 };
      if (s === remote.scoring) return { winner: 'remote', fork: false, rule: 6 };
      return { winner: 'merged', fork: false, rule: 6, merged: withScoring(local, s, api) };
    }
    if (local.end && remote.end) return fork();
    return { winner: local.end ? 'local' : 'remote', fork: false, rule: 5 };
  }
  if (p === Math.min(lp.length, rp.length)) {
    const localShorter = lp.length < rp.length;
    const shorter = localShorter ? local : remote;
    const longer = localShorter ? remote : local;
    if (!shorter.end) return { winner: localShorter ? 'remote' : 'local', fork: false, rule: 3 };
    if (!longer.end) return { winner: localShorter ? 'local' : 'remote', fork: false, rule: 5 };
    return fork();
  }
  return fork();
}

/* ---------------------------------------------------------------------------------------------- */
/* Reconcile                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Outcome of one reconcile step.
 *
 * - `in-sync`: nothing to do.
 * - `ahead`: this device's copy wins; `send` holds the logs to send.
 * - `behind`: the other copy wins. After a `head`: wait for its `logs` (seat 1 may still have
 *   `send` set, see below). After `logs`: store `adopt`. When rule 6 settled the scoring state
 *   from both copies (`Comparison.merged`), the settled log is in `adopt` and in `send`.
 * - `fork`: after a `head` only. The copies differ in a way the head cannot settle (a contradiction,
 *   or the same plies with another scoring state); both devices send their logs (`send`) and the
 *   `logs` step settles it.
 *
 * Whatever the status, send `send` when it is set. A fork is reported (`forked`) only by the
 * `logs` step, exactly once per device: seat 1 when it adopts seat 0's copy, seat 0 when it receives
 * seat 1's contradicting copy. To make sure seat 0 sees it, seat 1 also sends its copy after a
 * `head` whenever it cannot rule a fork out (it is shorter and unfinished).
 * - `invalid`: a received log (or head) failed validation; nothing is adopted. Show the sync error
 *   toast.
 */
export type SyncStatus = 'in-sync' | 'ahead' | 'behind' | 'fork' | 'invalid';

export interface SyncResult {
  status: SyncStatus;
  /**
   * Validated, normalized logs to store, oldest first. Each replaces the local log with the same
   * `n`; the one with the highest `n` is the current game. Only set after a `logs` message.
   */
  adopt?: GameLog[];
  /** Logs to send as a `logs` message (`makeLogs(send)`), oldest first, the current one last. */
  send?: GameLog[];
  /**
   * Show `Game restored from opponent's copy` (rule 4). Set only when a `logs` message reveals a
   * fork: on the adopting side and on seat 0, whose copy won. Never set by the `head` step.
   */
  forked: boolean;
  /** Why validation failed (`invalid` only). */
  error?: string;
  /** The rule that decided the current game (see `Comparison.rule`; 1 = game number). */
  rule?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** The other side's message: its `head`, its `logs` message, or the games of a `logs` / `grant`. */
export type RemoteSync = HeadMsg | LogsMsg | readonly GameLog[];

/**
 * The one reconcile function. Call it with every `head` and every `logs` the other device sends,
 * passing all logs of the room this device holds (any order) and its seat.
 *
 * Protocol around it: on connect (after the challenge) both devices send `makeHead(current)`.
 * On a `head`, call `reconcile`; if it returns `send`, send `makeLogs(send)`. On `logs`, call it
 * again: store `adopt`, show the toast if `forked`, and send `send` back if set (the other copy
 * lost). Two copies converge after at most one `logs` each way.
 *
 * Rule 1: the higher game number wins; the device that is behind receives every game from its
 * own current number on (its unfinished game, the finished games it missed, the current one).
 * Older games are not compared after a `head`, only when they arrive in `logs`.
 */
export function reconcile(local: readonly GameLog[], remote: RemoteSync, localSeat: Seat, api: ZengoApi = zengo): SyncResult {
  if (isHead(remote)) return reconcileHead(local, remote, localSeat);
  const games = Array.isArray(remote) ? (remote as readonly GameLog[]) : (remote as LogsMsg).games;
  return reconcileLogs(local, games, localSeat, api);
}

function isHead(r: RemoteSync): r is HeadMsg {
  return !Array.isArray(r) && (r as HeadMsg | LogsMsg).t === 'head';
}

/** Local games with `n >= from`, oldest first. */
function gamesFrom(local: readonly GameLog[], from: number): GameLog[] {
  return sortLogs(local).filter((l) => l.n >= from);
}

function reconcileHead(local: readonly GameLog[], head: HeadMsg, localSeat: Seat): SyncResult {
  if (!isCount(head.n) || !isCount(head.epoch) || !isCount(head.len) || typeof head.hash !== 'string' || typeof head.ended !== 'boolean') {
    return { status: 'invalid', forked: false, error: 'bad head' };
  }
  const cur = currentLog(local);
  const n = cur?.n ?? 0;
  const ahead = (rule: SyncResult['rule'], send: GameLog[]): SyncResult =>
    send.length ? { status: 'ahead', send, forked: false, rule } : { status: 'in-sync', forked: false, rule };
  const behind = (rule: SyncResult['rule']): SyncResult => ({ status: 'behind', forked: false, rule });
  const fork = (): SyncResult => ({ status: 'fork', send: cur ? [cur] : [], forked: false, rule: 4 });

  // Rule 1: game number.
  if (head.n > n) return behind(1);
  if (head.n < n) return ahead(1, gamesFrom(local, Math.max(1, head.n)));
  if (!cur) return { status: 'in-sync', forked: false, rule: 0 }; // neither side has a game yet
  // Rule 2: epoch.
  if (head.epoch > cur.epoch) return behind(2);
  if (head.epoch < cur.epoch) return ahead(2, [cur]);

  const len = cur.plies.length;
  const remotePlies = headPliesHash(head.hash);
  if (head.len === len) {
    if (head.hash === hashLog(cur)) return { status: 'in-sync', forked: false, rule: 0 };
    if (remotePlies !== pliesHash(cur)) return fork();
    // Same plies, different end state (rule 5), two different ends (rule 4), or another scoring
    // state (rule 6, settled by the `logs` step: both send).
    if (cur.end && !head.ended) return ahead(5, [cur]);
    if (!cur.end && head.ended) return behind(5);
    return fork();
  }
  if (head.len < len) {
    // This device is longer and can check whether the other copy is a prefix of its own.
    if (remotePlies !== pliesHash(cur, head.len)) return fork();
    if (!head.ended) return ahead(3, [cur]);
    if (!cur.end) return behind(5); // a finished copy beats a longer unfinished continuation
    return fork();
  }
  // This device is shorter and cannot check its copy against the longer one.
  if (cur.end) return head.ended ? fork() : ahead(5, [cur]);
  // Unfinished: the longer copy wins (rule 3) unless the copies fork, and the other device sends in
  // both cases. Seat 1 sends its copy as well, so that seat 0 sees a fork if there is one and both
  // devices show the toast (a fork is only ever reported by the `logs` step).
  if (localSeat === 1) return { status: 'behind', send: [cur], forked: false, rule: 3 };
  return behind(3);
}

function reconcileLogs(local: readonly GameLog[], remoteRaw: readonly GameLog[], localSeat: Seat, api: ZengoApi): SyncResult {
  if (!Array.isArray(remoteRaw)) return { status: 'invalid', forked: false, error: 'logs is not a list' };
  const remote: GameLog[] = [];
  for (const raw of remoteRaw) {
    const v = validateLog(raw, api);
    if (!v.ok) return { status: 'invalid', forked: false, error: `game ${(raw as GameLog | null)?.n ?? '?'}: ${v.error}` };
    remote.push(v.log);
  }
  const theirs = sortLogs(remote);
  const mine = new Map(sortLogs(local).map((l) => [l.n, l] as const));
  const localCur = currentLog(local);
  const remoteCur = currentLog(theirs);

  const adopt: GameLog[] = [];
  const send: GameLog[] = [];
  let forked = false;
  let rule: SyncResult['rule'];
  let curWinner: Comparison['winner'] | undefined;

  for (const r of theirs) {
    const l = mine.get(r.n);
    let c: { winner: Comparison['winner']; fork: boolean; rule: NonNullable<SyncResult['rule']>; merged?: GameLog };
    if (!l) c = { winner: 'remote', fork: false, rule: 1 };
    else c = compareLogs(l, r, localSeat, api);
    if (c.fork) forked = true;
    if (c.winner === 'remote') adopt.push(r);
    else if (c.winner === 'local' && l) send.push(l);
    else if (c.winner === 'merged' && c.merged) {
      // Both devices build the same settled log; this one also sends it, so the other side has it
      // even if it never received this device's copy.
      adopt.push(c.merged);
      send.push(c.merged);
    }
    if (r === remoteCur && localCur && r.n === localCur.n) {
      rule = c.rule;
      curWinner = c.winner;
    }
  }

  // Rule 1 seen from this side: the other device is behind on game number.
  if (localCur && (!remoteCur || localCur.n > remoteCur.n)) {
    // Every game from the other side's current one on, except those it sent (already compared).
    const sent = new Set(theirs.map((l) => l.n));
    const from = remoteCur ? remoteCur.n : 1;
    for (const l of gamesFrom(local, from)) if (!sent.has(l.n)) send.push(l);
    rule = 1;
    curWinner = 'local';
  } else if (remoteCur && (!localCur || remoteCur.n > localCur.n)) {
    rule = 1;
    curWinner = 'remote';
  }

  const result: SyncResult = { status: 'in-sync', forked, rule };
  if (adopt.length) result.adopt = sortLogs(adopt);
  if (send.length) result.send = sortLogs(send);
  if (curWinner === 'remote' || curWinner === 'merged') result.status = 'behind';
  else if (curWinner === 'local') result.status = 'ahead';
  else if (adopt.length) result.status = 'behind';
  else if (send.length) result.status = 'ahead';
  return result;
}

/**
 * Merges adopted logs into the local list: each adopted log replaces the one with its `n`.
 * Returns all logs oldest first.
 */
export function mergeLogs(local: readonly GameLog[], adopt: readonly GameLog[]): GameLog[] {
  return sortLogs([...local, ...adopt]);
}

/* ---------------------------------------------------------------------------------------------- */
/* Live play on a log                                                                               */
/* ---------------------------------------------------------------------------------------------- */

/** A fresh game: game 1 of a room, or a rematch. */
export function newLog(n: number, black: Seat, tc: string | null, settings: LogSettings = DEFAULT_LOG_SETTINGS): GameLog {
  const size = settings.size;
  return { n, epoch: 0, plies: [], black, tc, size, rules: settings.rules, handicap: normalizeHandicap(size, settings.handicap) };
}

/**
 * The rematch of a game (DESIGN 9.4): `n + 1` with the same size, rules, handicap and time control.
 * Colors swap, except in a handicap game, where the player who took Black keeps it.
 */
export function rematchLog(prev: GameLog): GameLog {
  const black = prev.handicap >= 2 ? prev.black : otherSeat(prev.black);
  return newLog(prev.n + 1, black, prev.tc, prev);
}

/** The color to move in a log (Black first, White first with a handicap). */
export function turnOf(log: Pick<GameLog, 'handicap' | 'plies'>): Color {
  return colorOfPly(log, log.plies.length);
}

/** The seat to move in a log. */
export function seatToMove(log: GameLog): Seat {
  return seatOf(log, turnOf(log));
}

/** True for a well-formed ply point on a board of `size`: two letters on the board, or `tt`. */
export function isPly(m: unknown, size: number): m is Point {
  return typeof m === 'string' && (m === PASS || isPoint(m, size));
}

/**
 * A new log with one ply played by `api` (a point, or `tt` to pass). The second consecutive pass
 * enters scoring (`scoring` round 1, or 2 after a resume, rev 0). Throws on an illegal ply, while
 * scoring (resume first) and after the end.
 */
export function appendPly(log: GameLog, m: Point, ms: number, api: ZengoApi = zengo): GameLog {
  if (log.end) throw new Error('Game is over');
  if (!isPly(m, log.size)) throw new Error(`Bad ply ${String(m)}`);
  const g = api.play(playable(log, api), m, ms);
  const out: GameLog = { ...log, plies: g.plies.map((p) => ({ m: p.m, ms: p.ms })) };
  delete out.end;
  delete out.scoring;
  if (g.scoring) out.scoring = plainScoring(g.scoring);
  return out;
}

/** A new log with the game ended (resign, time, score). A finished log is returned unchanged. */
export function endLog(log: GameLog, end: LogEnd): GameLog {
  if (log.end) return log;
  return { ...log, end: { result: { ...end.result }, by: end.by } };
}

/**
 * Outcome of a live `move` message against the local copy:
 * - `applied`: a new ply; `log` is the new copy (ack it).
 * - `duplicate`: this ply is already in the log (a resend): ack it again, change nothing.
 * - `stale`: another game or an older epoch; ignore it.
 * - `gap`: the move skips plies or the other copy is ahead in some other way; ask for a reconcile
 *   (send `head`).
 * - `conflict`: a different ply at that index, a ply after the end or during scoring, or an
 *   illegal move; reconcile.
 */
export type MoveOutcome =
  | { kind: 'applied'; log: GameLog }
  | { kind: 'duplicate' }
  | { kind: 'stale' }
  | { kind: 'gap' }
  | { kind: 'conflict'; error: string };

/** Applies a live `move` message (`{n, epoch, i, m, ms}`) to the local copy of the game. */
export function applyMoveMsg(log: GameLog, msg: Pick<MoveMsg, 'n' | 'epoch' | 'i' | 'm' | 'ms'>, api: ZengoApi = zengo): MoveOutcome {
  if (msg.n < log.n || (msg.n === log.n && msg.epoch < log.epoch)) return { kind: 'stale' };
  if (msg.n > log.n || msg.epoch > log.epoch) return { kind: 'gap' };
  if (!Number.isInteger(msg.i) || msg.i < 0) return { kind: 'conflict', error: 'bad index' };
  if (msg.i < log.plies.length) {
    const have = log.plies[msg.i];
    if (have.m === msg.m && have.ms === Math.max(0, Math.round(msg.ms))) return { kind: 'duplicate' };
    return { kind: 'conflict', error: `different ply at ${msg.i}` };
  }
  if (msg.i > log.plies.length) return { kind: 'gap' };
  if (log.end) return { kind: 'conflict', error: 'game is over' };
  if (!isPly(msg.m, log.size)) return { kind: 'conflict', error: 'bad move' };
  if (typeof msg.ms !== 'number' || !Number.isFinite(msg.ms) || msg.ms < 0) return { kind: 'conflict', error: 'bad time' };
  try {
    return { kind: 'applied', log: appendPly(log, msg.m, msg.ms, api) };
  } catch {
    return { kind: 'conflict', error: log.scoring ? 'game is in scoring' : `illegal move ${msg.m}` };
  }
}

/**
 * The takeback (DESIGN 9.4): the log cut back to before `requester`'s last ply, `epoch + 1`.
 * During scoring it cuts the second pass (or more), which ends scoring. Null when that seat has not
 * played yet or the game is over.
 */
export function takebackLog(log: GameLog, requester: Seat): GameLog | null {
  if (log.end) return null;
  const color = colorOf(log, requester);
  for (let i = log.plies.length - 1; i >= 0; i--) {
    if (colorOfPly(log, i) === color) {
      return { ...newLog(log.n, log.black, log.tc, log), epoch: log.epoch + 1, plies: log.plies.slice(0, i) };
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Scoring on a log (DESIGN 9.5)                                                                    */
/* ---------------------------------------------------------------------------------------------- */

/** The log is in scoring and not over: marks, acceptances and a resume are possible. */
export function isScoring(log: GameLog | undefined): log is GameLog & { scoring: Scoring } {
  return !!log && !!log.scoring && !log.end;
}

/**
 * A new log with the marking replaced (a proposal or a toggle): `rev` (default `rev + 1`) and the
 * dead set (whole groups are the caller's business; only stones are kept), both acceptances
 * cleared. Null when the log is not in scoring or `rev` is not higher than the current one.
 */
export function markLog(log: GameLog, dead: readonly Point[], rev?: number, api: ZengoApi = zengo): GameLog | null {
  if (!isScoring(log)) return null;
  const next = rev ?? log.scoring.rev + 1;
  if (!isCount(next) || next <= log.scoring.rev) return null;
  const g = playable(log, api);
  const stones = [...new Set(dead)].filter((p) => isPoint(p, log.size) && g.board[pointToIndex(p, log.size)] !== 0).sort();
  return { ...log, scoring: { round: log.scoring.round, rev: next, dead: stones, accepted: [0, 0] } };
}

/** A new log with `seat`'s acceptance of the current marking. Null when not scoring. */
export function acceptLog(log: GameLog, seat: Seat): GameLog | null {
  if (!isScoring(log)) return null;
  const accepted: [number, number] = [log.scoring.accepted[0], log.scoring.accepted[1]];
  accepted[seat] = log.scoring.rev;
  return { ...log, scoring: { ...log.scoring, dead: [...log.scoring.dead], accepted } };
}

/** Both seats accepted the current marking (a marking with `rev` ≥ 1: rev 0 is "nothing proposed yet"). */
export function bothAccepted(log: GameLog): boolean {
  const s = log.scoring;
  return !!s && s.rev >= 1 && s.accepted[0] === s.rev && s.accepted[1] === s.rev;
}

/** A new log that left scoring: play continues with the player to move. Null when not scoring. */
export function resumeLog(log: GameLog): GameLog | null {
  if (!isScoring(log)) return null;
  const out: GameLog = { ...log };
  delete out.scoring;
  return out;
}

/** The scored end of a log in scoring, counted from its marking. Null when not scoring. */
export function scoreEnd(log: GameLog, api: ZengoApi = zengo): LogEnd | null {
  if (!isScoring(log)) return null;
  const result = scoredResult(playable(log, api), log.scoring.dead);
  return { result, by: 'score' };
}

/**
 * The round-2 end (DESIGN 9.5): scored at once from `dead` (seat 0's proposal; all alive without an
 * engine). The marking is stored as rev 1, accepted by both, so both devices hold the same log.
 * Null when the log is not in round-2 scoring.
 */
export function roundTwoEnd(log: GameLog, dead: readonly Point[], api: ZengoApi = zengo): GameLog | null {
  if (!isScoring(log) || log.scoring.round !== 2) return null;
  const marked = markLog(log, dead, Math.max(1, log.scoring.rev + 1), api);
  if (!marked) return null;
  const done: GameLog = { ...marked, scoring: { ...(marked.scoring as Scoring), accepted: [marked.scoring!.rev, marked.scoring!.rev] } };
  const end = scoreEnd(done, api);
  return end ? endLog(done, end) : null;
}

/**
 * A new log with `seat`'s acceptance of the current marking; when both seats have now accepted the
 * same rev, the game ends by score from the shared dead stones (DESIGN 9.5). Null when not scoring,
 * in round 2 (no marking round) or before a proposal (rev 0).
 */
export function acceptMarking(log: GameLog, seat: Seat, api: ZengoApi = zengo): GameLog | null {
  if (!isScoring(log) || log.scoring.round === 2 || log.scoring.rev < 1) return null;
  const next = acceptLog(log, seat);
  if (!next) return null;
  if (!bothAccepted(next)) return next;
  const end = scoreEnd(next, api);
  return end ? endLog(next, end) : null;
}

/**
 * Outcome of a live scoring message (`mark`, `accept`, `resume`) against the local copy:
 * - `applied`: store `log`.
 * - `settled`: two toggles of the same rev crossed (rule 6): store `log` (seat 0's dead stones at
 *   `rev + 1`, acceptances cleared) and send it as a `mark`.
 * - `duplicate`: nothing new; change nothing.
 * - `older`: the message is behind this copy (a toggle crossed it): send this copy's current marking
 *   as a `mark`, so the other side catches up. Nothing else changes.
 * - `stale`: another (older) game or epoch, a finished game, or a malformed message: ignore it.
 * - `reconcile`: the copies differ in a way the message cannot settle (a newer game or epoch, a
 *   newer rev that only an accept names, scoring that one side left or never reached): send `head`.
 */
export type ScoringOutcome =
  | { kind: 'applied'; log: GameLog }
  | { kind: 'settled'; log: GameLog }
  | { kind: 'duplicate' }
  | { kind: 'older' }
  | { kind: 'stale' }
  | { kind: 'reconcile' };

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

/** Stale, newer or same game and epoch. `epoch` undefined: compare the game number only. */
function placeMsg(log: GameLog, n: unknown, epoch?: unknown): 'stale' | 'reconcile' | 'same' {
  if (!isInt(n) || (epoch !== undefined && !isInt(epoch))) return 'stale';
  if (n < log.n) return 'stale';
  if (n > log.n) return 'reconcile';
  if (epoch === undefined) return 'same';
  const e = epoch as number;
  if (e < log.epoch) return 'stale';
  if (e > log.epoch) return 'reconcile';
  return 'same';
}

/** The sorted, de-duplicated stones of a received dead list (anything else is dropped). */
function deadStones(log: GameLog, dead: readonly unknown[], api: ZengoApi): Point[] {
  const g = playable(log, api);
  const pts = dead.filter((p): p is Point => typeof p === 'string' && isPoint(p, log.size));
  return [...new Set(pts)].filter((p) => g.board[pointToIndex(p, log.size)] !== 0).sort();
}

/**
 * Applies a live `mark {n, epoch, rev, dead}` from the other seat (DESIGN 9.5). A newer rev
 * replaces the marking and clears both acceptances. The same rev with other dead stones is the
 * crossing-toggles case of rule 6 and settles exactly as `reconcile` would: seat 0's dead stones at
 * `rev + 1`. An older rev answers with this copy's marking. Never consults an engine: the dead
 * stones are data.
 */
export function applyMarkMsg(
  log: GameLog,
  msg: { n: unknown; epoch: unknown; rev: unknown; dead: unknown },
  localSeat: Seat,
  api: ZengoApi = zengo,
): ScoringOutcome {
  const at = placeMsg(log, msg.n, msg.epoch);
  if (at !== 'same') return { kind: at };
  if (!isCount(msg.rev) || msg.rev < 1 || !Array.isArray(msg.dead)) return { kind: 'stale' };
  if (log.end) return { kind: 'stale' };
  if (!log.scoring || log.scoring.round === 2) return { kind: 'reconcile' };
  const s = log.scoring;
  if (msg.rev < s.rev) return { kind: 'older' };
  const dead = deadStones(log, msg.dead, api);
  if (msg.rev > s.rev) {
    const next = markLog(log, dead, msg.rev, api);
    return next ? { kind: 'applied', log: next } : { kind: 'stale' };
  }
  const theirs: Scoring = { round: s.round, rev: msg.rev, dead, accepted: [0, 0] };
  if (sameDead(s, theirs)) return { kind: 'duplicate' };
  const settled = localSeat === 0 ? settleScoring(s, theirs, true) : settleScoring(theirs, s, true);
  const next = settled ? markLog(log, settled.dead, settled.rev, api) : null;
  return next ? { kind: 'settled', log: next } : { kind: 'stale' };
}

/**
 * Applies a live `accept {n, rev}` from the other seat (`fromSeat`). An accept of the current rev
 * is recorded, and ends the game by score when this seat had accepted it too. An accept of an older
 * rev is stale (a toggle crossed it and cleared it on both sides); one of a newer rev means this
 * copy missed a marking: reconcile.
 */
export function applyAcceptMsg(log: GameLog, msg: { n: unknown; rev: unknown }, fromSeat: Seat, api: ZengoApi = zengo): ScoringOutcome {
  const at = placeMsg(log, msg.n);
  if (at !== 'same') return { kind: at };
  if (!isCount(msg.rev) || msg.rev < 1 || log.end) return { kind: 'stale' };
  if (!log.scoring || log.scoring.round === 2) return { kind: 'reconcile' };
  if (msg.rev < log.scoring.rev) return { kind: 'stale' };
  if (msg.rev > log.scoring.rev) return { kind: 'reconcile' };
  if (log.scoring.accepted[fromSeat] === msg.rev) return { kind: 'duplicate' };
  const next = acceptMarking(log, fromSeat, api);
  return next ? { kind: 'applied', log: next } : { kind: 'stale' };
}

/**
 * Applies a live `resume {n, epoch}`: scoring is dropped and play continues. A copy that already
 * left scoring (or never reached it) has nothing to do; a finished copy ignores it.
 */
export function applyResumeMsg(log: GameLog, msg: { n: unknown; epoch: unknown }): ScoringOutcome {
  const at = placeMsg(log, msg.n, msg.epoch);
  if (at !== 'same') return { kind: at };
  if (log.end) return { kind: 'stale' };
  if (!log.scoring) return { kind: 'duplicate' };
  const next = resumeLog(log);
  return next ? { kind: 'applied', log: next } : { kind: 'stale' };
}

/**
 * Seat 1's side of the round-2 end (DESIGN 9.5): seat 0 scored the game from its proposal and sent
 * `end {n, result, by: 'score', dead}`. The dead stones are taken as data (this device's own engine
 * is never asked) and the claimed result must equal their count. Null when the log is not in
 * round-2 scoring or the result does not match (then reconcile).
 */
export function applyScoredEnd(log: GameLog, dead: readonly unknown[], claimed: unknown, api: ZengoApi = zengo): GameLog | null {
  if (!Array.isArray(dead) || !isScoring(log) || log.scoring.round !== 2) return null;
  const want = readResult(claimed);
  if (!want || want.by !== 'score') return null;
  const next = roundTwoEnd(log, deadStones(log, dead, api), api);
  if (!next?.end || !sameResult(next.end.result, want)) return null;
  return next;
}

/* ---------------------------------------------------------------------------------------------- */
/* Score                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/** Points a finished game adds per seat, in half points ×2: a win 2, a loss 0 (no draws in Go). */
export function gamePoints(log: Pick<GameLog, 'black' | 'end'>): [number, number] {
  const out: [number, number] = [0, 0];
  if (!log.end) return out;
  out[seatOf(log, log.end.result.winner)] = 2;
  return out;
}

/** Room score per seat (half points ×2) over the given games; unfinished games count nothing. */
export function roomScore(logs: readonly Pick<GameLog, 'black' | 'end'>[]): [number, number] {
  const s: [number, number] = [0, 0];
  for (const l of logs) {
    const p = gamePoints(l);
    s[0] += p[0];
    s[1] += p[1];
  }
  return s;
}

/** A score (half points ×2 per seat) from this seat's point of view, in points: `[mine, theirs]`. */
export function scoreView(score: readonly [number, number], seat: Seat): [number, number] {
  return [score[seat] / 2, score[otherSeat(seat)] / 2];
}

/* ---------------------------------------------------------------------------------------------- */
/* base64url and the seat key                                                                       */
/* ---------------------------------------------------------------------------------------------- */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bytes → base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[v >> 18] + B64URL[(v >> 12) & 63] + B64URL[(v >> 6) & 63] + B64URL[v & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const v = bytes[i] << 16;
    out += B64URL[v >> 18] + B64URL[(v >> 12) & 63];
  } else if (rest === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64URL[v >> 18] + B64URL[(v >> 12) & 63] + B64URL[(v >> 6) & 63];
  }
  return out;
}

/** base64url (padding optional) → bytes. Throws on any other character or an impossible length. */
export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/=+$/, '');
  if (t.length % 4 === 1) throw new Error('Bad base64url length');
  const out = new Uint8Array(Math.floor((t.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < t.length; i++) {
    const v = B64URL.indexOf(t[i]);
    if (v < 0) throw new Error('Bad base64url character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Bytes in a seat key (128 bits) and in a challenge nonce. */
export const KEY_BYTES = 16;
export const NONCE_BYTES = 16;

/**
 * `n` random bytes: from `rng` when given (tests), else from `crypto.getRandomValues`.
 * Without either (no WebCrypto), falls back to `Math.random`.
 */
export function randomBytes(n: number, rng?: Rng): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  if (!rng) {
    const c = globalThis.crypto;
    if (c?.getRandomValues) {
      c.getRandomValues(out);
      return out;
    }
    rng = Math.random;
  }
  for (let i = 0; i < n; i++) out[i] = Math.min(255, Math.max(0, Math.floor(rng() * 256)));
  return out;
}

/** A new room key: 128 random bits, base64url (22 characters). */
export function generateKey(rng?: Rng): string {
  return toBase64Url(randomBytes(KEY_BYTES, rng));
}

/** A new challenge nonce for `hello`: 128 random bits, base64url. */
export function generateNonce(rng?: Rng): string {
  return toBase64Url(randomBytes(NONCE_BYTES, rng));
}

/** True for a well-formed room key (base64url of exactly 16 bytes). */
export function isValidKey(key: unknown): key is string {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(key)) return false;
  try {
    return fromBase64Url(key).length === KEY_BYTES;
  } catch {
    return false;
  }
}

/**
 * The bytes a proof signs: the challenge nonce, the room code (UTF-8), and the prover's seat.
 * The seat is an addition to `HMAC(key, nonce)` (an addition to the design): without it a device without the key
 * could echo a device's own nonce back and replay that device's proof to it.
 */
export function proofMessage(nonce: string, code: string, proverSeat: Seat): Uint8Array<ArrayBuffer> {
  const n = fromBase64Url(nonce);
  if (n.length < 8) throw new Error('Nonce too short');
  const c = new TextEncoder().encode(code);
  const out = new Uint8Array(n.length + c.length + 1);
  out.set(n, 0);
  out.set(c, n.length);
  out[out.length - 1] = proverSeat;
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available');
  return s;
}

async function hmacKey(key: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (!isValidKey(key)) throw new Error('Bad room key');
  return subtle().importKey('raw', fromBase64Url(key), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/**
 * The `proof.mac` answering the other side's `hello.nonce`:
 * base64url(HMAC-SHA-256(key, nonce ‖ code ‖ proverSeat)), where `proverSeat` is this device's seat.
 * Rejects on a malformed key or nonce, or without WebCrypto.
 */
export async function proveSeat(key: string, nonce: string, code: string, proverSeat: Seat): Promise<string> {
  const k = await hmacKey(key, 'sign');
  const mac = await subtle().sign('HMAC', k, proofMessage(nonce, code, proverSeat));
  return toBase64Url(new Uint8Array(mac));
}

/**
 * Checks the other side's `proof.mac` against the nonce this device sent. `proverSeat` is the seat
 * the other device must hold (the other seat of this room). Constant-time through WebCrypto.
 * Never rejects: anything malformed is simply false.
 */
export async function verifySeat(key: string, nonce: string, code: string, proverSeat: Seat, mac: string): Promise<boolean> {
  try {
    const k = await hmacKey(key, 'verify');
    const sig = fromBase64Url(mac);
    if (sig.length !== 32) return false;
    return await subtle().verify('HMAC', k, sig, proofMessage(nonce, code, proverSeat));
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Stored games (DESIGN 12.1)                                                                       */
/* ---------------------------------------------------------------------------------------------- */

/** `SavedGame.id` of a room game: `${code}.${n}`. */
export function roomGameId(code: string, n: number): string {
  return `${code}.${n}`;
}

/**
 * A `SavedGame` for a room game as this device stores it. `prev` (the stored copy, if any) keeps
 * `createdAt` and `assisted`; `lastPlayedAt` defaults to `now`.
 */
export function logToSaved(
  log: GameLog,
  opts: { code: string; seat: Seat; now: number; prev?: SavedGame; lastPlayedAt?: number },
  api: ZengoApi = zengo,
): SavedGame {
  const s: SavedGame = {
    id: roomGameId(opts.code, log.n),
    code: opts.code,
    mode: 'room',
    color: colorOf(log, opts.seat),
    size: log.size,
    rules: log.rules,
    handicap: log.handicap,
    tc: log.tc,
    moves: api.encodeMoves(log.plies),
    ms: log.plies.map((p) => p.ms),
    assisted: opts.prev?.assisted ?? false,
    room: { n: log.n, epoch: log.epoch },
    createdAt: opts.prev?.createdAt ?? opts.now,
    lastPlayedAt: opts.lastPlayedAt ?? opts.now,
  };
  if (log.scoring) s.scoring = plainScoring(log.scoring);
  if (log.end) s.result = { ...log.end.result };
  return s;
}

/**
 * The `GameLog` of a stored room game, for this device's `seat`. Null when the record is not a room
 * game or does not replay.
 */
export function savedToLog(saved: SavedGame, seat: Seat, api: ZengoApi = zengo): GameLog | null {
  if (saved.mode !== 'room' || !saved.room) return null;
  if (typeof saved.moves !== 'string' || !isValidMoves(saved.moves)) return null;
  const points = api.decodeMoves(saved.moves);
  const raw: Record<string, unknown> = {
    n: saved.room.n,
    epoch: saved.room.epoch,
    plies: points.map((m, i) => ({ m, ms: Number.isFinite(saved.ms?.[i]) ? saved.ms[i] : 0 })),
    black: saved.color === 'B' ? seat : otherSeat(seat),
    tc: saved.tc ?? null,
    size: saved.size,
    rules: saved.rules,
    handicap: saved.handicap,
  };
  if (saved.scoring) raw.scoring = saved.scoring;
  if (saved.result) raw.end = { result: saved.result, by: saved.result.by };
  const v = validateLog(raw, api);
  return v.ok ? v.log : null;
}
