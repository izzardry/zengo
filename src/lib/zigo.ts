/**
 * The Go rules core (DESIGN 8.1, 8.2, 8.3, 11, 13.2, 13.3). Pure: no React, no DOM.
 *
 * Board: a flat `Uint8Array(size²)`, 0 empty, 1 black, 2 white, row-major from the top
 * (index = row × size + col, row 0 = SGF row `a`). Points are two SGF letters; `tt` is a pass.
 *
 * `Game` values are frozen; every operation returns a new one. The derived state at a value's
 * cursor (board, Zobrist hash, the set of every earlier position for positional superko, prisoners,
 * ko, the count of scoring entries) is cached per value in a WeakMap. A value without a cache entry
 * (e.g. rebuilt from JSON) is replayed from its settings and plies on first use. `undo`, `redo` and
 * `goto` rebuild that state from the start, which takes well under a millisecond per 100 plies.
 *
 * Passes and scoring:
 * - `Game.passes` counts consecutive passes since the last stone or the last `resume`.
 * - The pass that makes it 2 enters scoring: `{ round, rev: 0, dead: [], accepted: [0, 0] }`.
 * - `round` is derived from the plies alone: the first time scoring is entered in a game it is 1,
 *   every later time 2. A resume is implied by any ply that follows a double pass (play is refused
 *   while scoring), so a log never needs to store it. Only a resume that has no ply after it yet is
 *   state outside the plies: `passes` 0 and no `scoring` although the last two plies are passes.
 *   Stored records express it the same way: a record ending in a double pass without `scoring` and
 *   without a result was resumed (`fromRecord`).
 * - `undo` / `redo` / `goto` derive the scoring state at the target cursor. Marks are remembered
 *   while moving the cursor away and back (`redo` after `undo` restores them); a new ply forgets them.
 */
import type {
  ClockState,
  Color,
  Game,
  GameRecordFields,
  IllegalReason,
  Ply,
  Point,
  Position,
  Result,
  Rules,
  Scoring,
  Settings,
  SgfMeta,
  Size,
  TcString,
  TimeControl,
  ZigoApi,
} from './types';

/* ---------------------------------------------------------------------------------------------- */
/* Points and coordinates                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** The pass "point". */
export const PASS: Point = 'tt';

/** Board sizes Zigo offers. */
export const SIZES: readonly Size[] = Object.freeze([9, 13, 19] as Size[]);

const A = 97; // 'a'

/** True for `tt`. */
export function isPass(p: Point): boolean {
  return p === PASS;
}

/** True for two letters `a`–`s` that lie on a board of `size` (any size up to 19 when omitted). */
export function isPoint(p: unknown, size: number = 19): p is Point {
  if (typeof p !== 'string' || p.length !== 2) return false;
  const c = p.charCodeAt(0) - A;
  const r = p.charCodeAt(1) - A;
  return c >= 0 && c < size && r >= 0 && r < size;
}

/** Board index of a point (row × size + col), or -1 for a pass or a point off this board. */
export function pointToIndex(p: Point, size: number): number {
  if (!isPoint(p, size)) return -1;
  return (p.charCodeAt(1) - A) * size + (p.charCodeAt(0) - A);
}

/** Point at a board index. Throws on an index off the board. */
export function indexToPoint(i: number, size: number): Point {
  if (!Number.isInteger(i) || i < 0 || i >= size * size) throw new RangeError(`Bad index ${i} for size ${size}`);
  return String.fromCharCode(A + (i % size), A + Math.floor(i / size));
}

/** GTP column letters (no I). */
const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';

/** `dd` on 19×19 → `D16`; `tt` → `pass`. Throws on a point off the board. */
export function gtp(p: Point, size: Size): string {
  if (isPass(p)) return 'pass';
  const i = pointToIndex(p, size);
  if (i < 0) throw new RangeError(`Bad point ${p} for size ${size}`);
  return `${GTP_COLS[i % size]}${size - Math.floor(i / size)}`;
}

/** `D4`, `d4`, ` pass ` → point; null if it is not a point on this board. */
export function fromGtp(s: string, size: Size): Point | null {
  const t = s.trim().toUpperCase();
  if (t === 'PASS') return PASS;
  const m = /^([A-HJ-T])(\d{1,2})$/.exec(t);
  if (!m) return null;
  const col = GTP_COLS.indexOf(m[1]);
  const row = Number(m[2]);
  if (col < 0 || col >= size || row < 1 || row > size) return null;
  return String.fromCharCode(A + col, A + (size - row));
}

/** A point from 1-based GTP column and row (row counted from the bottom). */
function gtpPoint(col: number, row: number, size: number): Point {
  return String.fromCharCode(A + col - 1, A + (size - row));
}

/* ---------------------------------------------------------------------------------------------- */
/* Handicap, star points, komi, settings (DESIGN 8.2)                                              */
/* ---------------------------------------------------------------------------------------------- */

/** Largest handicap per size: 5 on 9×9, 9 otherwise. */
export function maxHandicap(size: Size): number {
  return size === 9 ? 5 : 9;
}

/** A handicap as Zigo allows it: 0 or 2..max (1 and below → 0, above max → max). */
export function normalizeHandicap(size: Size, n: number): number {
  const k = Number.isFinite(n) ? Math.floor(n) : 0;
  if (k < 2) return 0;
  return Math.min(k, maxHandicap(size));
}

/**
 * Handicap stones in GTP order (DESIGN 8.2): 2 = D4 Q16; 3 adds D16; 4 adds Q4; 5 adds the
 * center; 6 = corners + D10 Q10; 7 = 6 + center; 8 = 6 + K4 K16; 9 = all nine. 9×9 uses the 3rd
 * line, 13×13 and 19×19 the 4th. Counts are normalized (`normalizeHandicap`); 0 → [].
 */
export function handicapPoints(size: Size, n: number): Point[] {
  const k = normalizeHandicap(size, n);
  if (k === 0) return [];
  const lo = size === 9 ? 3 : 4;
  const hi = size + 1 - lo;
  const mid = (size + 1) / 2;
  const P = (c: number, r: number) => gtpPoint(c, r, size);
  const corners = [P(lo, lo), P(hi, hi), P(lo, hi), P(hi, lo)];
  const center = P(mid, mid);
  const sidesLR = [P(lo, mid), P(hi, mid)];
  const sidesBT = [P(mid, lo), P(mid, hi)];
  switch (k) {
    case 2:
    case 3:
    case 4:
      return corners.slice(0, k);
    case 5:
      return [...corners, center];
    case 6:
      return [...corners, ...sidesLR];
    case 7:
      return [...corners, ...sidesLR, center];
    case 8:
      return [...corners, ...sidesLR, ...sidesBT];
    default:
      return [...corners, ...sidesLR, ...sidesBT, center];
  }
}

/** Star points (hoshi): 9×9 and 13×13 the four corners and the center, 19×19 all nine. */
export function starPoints(size: Size): Point[] {
  return handicapPoints(size, size === 19 ? 9 : 5);
}

/** Komi ×2 (DESIGN 8.2): area 7.5 → 15, territory 6.5 → 13, with a handicap 0.5 → 1. */
export function defaultKomi2(rules: Rules, handicap: number): number {
  if (handicap >= 2) return 1;
  return rules === 'territory' ? 13 : 15;
}

/** Settings with a normalized handicap and the default komi. */
export function makeSettings(size: Size, rules: Rules = 'area', handicap = 0): Settings {
  const h = normalizeHandicap(size, handicap);
  return { size, rules, handicap: h, komi2: defaultKomi2(rules, h) };
}

/** `15` → `7.5`, `1` → `0.5`, `-3` → `-1.5`. */
export function formatHalf(v2: number): string {
  return String(v2 / 2);
}

/* ---------------------------------------------------------------------------------------------- */
/* Time controls (DESIGN 11)                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Fischer → `5+7`; byo-yomi → `20m5x30`; null → null. Fractional values keep up to 2 decimals. */
export function formatTc(tc: TimeControl): TcString | null {
  if (!tc) return null;
  const min = round2(tc.baseMs / 60000);
  if (tc.kind === 'fischer') return `${min}+${round2(tc.incMs / 1000)}`;
  return `${min}m${tc.periods}x${round2(tc.periodMs / 1000)}`;
}

/**
 * `5+7` → Fischer; `20m5x30` (also `20m 5x30s`, `20m 5×30s`) → byo-yomi. Anything else
 * (including null and `off`) → null. Fischer needs a base above 0; byo-yomi needs at least one
 * period of more than 0 s (a base of 0 is pure byo-yomi).
 */
export function parseTc(s: string | null | undefined): TimeControl {
  if (!s) return null;
  const t = s.trim();
  const f = /^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)$/.exec(t);
  if (f) {
    const baseMs = Math.round(Number(f[1]) * 60000);
    const incMs = Math.round(Number(f[2]) * 1000);
    return baseMs > 0 ? { kind: 'fischer', baseMs, incMs } : null;
  }
  const b = /^(\d+(?:\.\d+)?)m\s*(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)s?$/i.exec(t);
  if (b) {
    const baseMs = Math.round(Number(b[1]) * 60000);
    const periods = Number(b[2]);
    const periodMs = Math.round(Number(b[3]) * 1000);
    return periods >= 1 && periodMs > 0 ? { kind: 'byoyomi', baseMs, periods, periodMs } : null;
  }
  return null;
}

/** A time control in either form → `TimeControl` (strings through `parseTc`). */
export function toTc(tc: TimeControl | TcString | null | undefined): TimeControl {
  if (tc === null || tc === undefined) return null;
  return typeof tc === 'string' ? parseTc(tc) : tc;
}

/* ---------------------------------------------------------------------------------------------- */
/* Zobrist hashing (positional superko)                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** Fixed seed: every device computes the same hashes. */
const ZOBRIST_SEED = 0x5a1c0de;
const MAX_POINTS = 19 * 19;

/** splitmix32: small, fast, good enough for hash keys. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Keys per (color, index): `[2 × (color − 1) × MAX + index]`, a high and a low 32-bit half. */
const Z_HI = new Uint32Array(2 * MAX_POINTS);
const Z_LO = new Uint32Array(2 * MAX_POINTS);
{
  const next = splitmix32(ZOBRIST_SEED);
  for (let i = 0; i < Z_HI.length; i++) {
    Z_HI[i] = next();
    Z_LO[i] = next();
  }
}

const zkey = (color: number, idx: number) => (color - 1) * MAX_POINTS + idx;
const hkey = (hi: number, lo: number) => `${hi >>> 0}:${lo >>> 0}`;

/* ---------------------------------------------------------------------------------------------- */
/* Board mechanics                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

const BLACK = 1;
const WHITE = 2;
const colorNum = (c: Color) => (c === 'B' ? BLACK : WHITE);
const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

/** Neighbour lists per size, built once. */
const NEIGHBOURS = new Map<number, Int16Array[]>();
function neighbours(size: number): Int16Array[] {
  let n = NEIGHBOURS.get(size);
  if (!n) {
    n = [];
    for (let i = 0; i < size * size; i++) {
      const r = Math.floor(i / size);
      const c = i % size;
      const list: number[] = [];
      if (r > 0) list.push(i - size);
      if (c > 0) list.push(i - 1);
      if (c < size - 1) list.push(i + 1);
      if (r < size - 1) list.push(i + size);
      n.push(Int16Array.from(list));
    }
    NEIGHBOURS.set(size, n);
  }
  return n;
}

/** Scratch buffers for flood fills (single-threaded, so one set is enough). */
let mark = new Uint32Array(MAX_POINTS);
let libMark = new Uint32Array(MAX_POINTS);
let stamp = 0;
const stack = new Int16Array(MAX_POINTS);
const groupBuf = new Int16Array(MAX_POINTS);

function nextStamp(): number {
  stamp++;
  if (stamp >= 0xffffffff) {
    mark = new Uint32Array(MAX_POINTS);
    libMark = new Uint32Array(MAX_POINTS);
    stamp = 1;
  }
  return stamp;
}

/**
 * Flood-fills the chain at `start` into `groupBuf[0..n)`. Returns the stone count, the number of
 * distinct liberties and one of them (the last found; the only one when `libs` is 1).
 */
function chain(board: Uint8Array, size: number, start: number): { n: number; libs: number; lastLib: number } {
  const nb = neighbours(size);
  const color = board[start];
  const s = nextStamp();
  let sp = 0;
  let n = 0;
  let libs = 0;
  let lastLib = -1;
  stack[sp++] = start;
  mark[start] = s;
  while (sp > 0) {
    const i = stack[--sp];
    groupBuf[n++] = i;
    const list = nb[i];
    for (let k = 0; k < list.length; k++) {
      const j = list[k];
      const v = board[j];
      if (v === 0) {
        if (libMark[j] !== s) {
          libMark[j] = s;
          libs++;
          lastLib = j;
        }
      } else if (v === color && mark[j] !== s) {
        mark[j] = s;
        stack[sp++] = j;
      }
    }
  }
  return { n, libs, lastLib };
}

/** Result of placing a stone on a scratch board. */
interface Placement {
  board: Uint8Array;
  hi: number;
  lo: number;
  captured: number;
  ko: number;
}

/**
 * Places `color` at `idx` on a copy of `board` and removes captured chains. Returns null with the
 * reason for occupied and suicide; superko and ko are the caller's checks.
 */
function place(
  board: Uint8Array,
  size: number,
  idx: number,
  color: number,
  hi: number,
  lo: number,
): Placement | 'occupied' | 'suicide' {
  if (board[idx] !== 0) return 'occupied';
  const nb = neighbours(size);
  const opp = 3 - color;
  const b = board.slice();
  b[idx] = color;
  let h = (hi ^ Z_HI[zkey(color, idx)]) >>> 0;
  let l = (lo ^ Z_LO[zkey(color, idx)]) >>> 0;
  let captured = 0;
  let capturedAt = -1;
  const list = nb[idx];
  for (let k = 0; k < list.length; k++) {
    const j = list[k];
    if (b[j] !== opp) continue;
    const g = chain(b, size, j);
    if (g.libs === 0) {
      for (let q = 0; q < g.n; q++) {
        const s = groupBuf[q];
        b[s] = 0;
        h = (h ^ Z_HI[zkey(opp, s)]) >>> 0;
        l = (l ^ Z_LO[zkey(opp, s)]) >>> 0;
      }
      captured += g.n;
      capturedAt = j;
    }
  }
  const own = chain(b, size, idx);
  if (own.libs === 0) return 'suicide';
  // Simple ko: a single stone captured one stone and now has exactly that one liberty.
  const ko = captured === 1 && own.n === 1 && own.libs === 1 ? capturedAt : -1;
  return { board: b, hi: h, lo: l, captured, ko };
}

/* ---------------------------------------------------------------------------------------------- */
/* Derived state per game value                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/** Everything derived from (settings, setup, plies, cursor). Never mutated once built. */
interface Core {
  readonly board: Uint8Array;
  readonly hi: number;
  readonly lo: number;
  /** Hashes of the start position and of the position after every ply up to the cursor. */
  readonly seen: ReadonlySet<string>;
  readonly prisoners: Readonly<Record<Color, number>>;
  /** Simple-ko index for the side to move, or -1. */
  readonly ko: number;
  /** Consecutive passes by the plies alone (a double pass counts as resumed when a pass follows it). */
  readonly run: number;
  /** How often scoring was entered in plies[0..cursor). */
  readonly entries: number;
}

const cores = new WeakMap<Game, Core>();
/** Scoring marks remembered while undo / redo / goto move away from the cursor they belong to. */
const parked = new WeakMap<Game, { cursor: number; scoring: Scoring }>();

/** The first mover after the start position. */
function firstMover(settings: Settings, setup?: Game['setup']): Color {
  if (setup) return setup.turn;
  return settings.handicap >= 2 ? 'W' : 'B';
}

/** The start board: the set-up board, or the empty board with the handicap stones. */
function startBoard(settings: Settings, setup?: Game['setup']): Uint8Array {
  const n = settings.size * settings.size;
  if (setup) {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = setup.board[i];
      b[i] = v === BLACK || v === WHITE ? v : 0;
    }
    return b;
  }
  const b = new Uint8Array(n);
  for (const p of handicapPoints(settings.size, settings.handicap)) b[pointToIndex(p, settings.size)] = BLACK;
  return b;
}

function hashOf(board: Uint8Array): { hi: number; lo: number } {
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (v) {
      hi = (hi ^ Z_HI[zkey(v, i)]) >>> 0;
      lo = (lo ^ Z_LO[zkey(v, i)]) >>> 0;
    }
  }
  return { hi, lo };
}

/** Builds the derived state by replaying `plies[0..cursor)`. Throws on a ply that is not legal. */
function compute(settings: Settings, setup: Game['setup'], plies: readonly Ply[], cursor: number): Core {
  const size = settings.size;
  let board = startBoard(settings, setup);
  let { hi, lo } = hashOf(board);
  const seen = new Set<string>([hkey(hi, lo)]);
  const prisoners = { B: 0, W: 0 };
  let ko = -1;
  let run = 0;
  let entries = 0;
  let color = firstMover(settings, setup);
  for (let i = 0; i < cursor; i++) {
    const m = plies[i].m;
    if (isPass(m)) {
      if (run === 2) run = 0; // a ply after a double pass implies a resume
      run++;
      if (run === 2) entries++;
      ko = -1;
    } else {
      const idx = pointToIndex(m, size);
      if (idx < 0) throw new Error(`Bad point in game record: ${m}`);
      const r = place(board, size, idx, colorNum(color), hi, lo);
      if (typeof r === 'string') throw new Error(`Illegal ply ${i} in game record: ${m} (${r})`);
      board = r.board;
      hi = r.hi;
      lo = r.lo;
      prisoners[color] += r.captured;
      ko = r.ko;
      run = 0;
      seen.add(hkey(hi, lo));
    }
    color = other(color);
  }
  return { board, hi, lo, seen, prisoners, ko, run, entries };
}

function core(g: Game): Core {
  let c = cores.get(g);
  if (!c) {
    c = compute(g.settings, g.setup, g.plies, g.cursor);
    cores.set(g, c);
  }
  return c;
}

function colorAt(g: { settings: Settings; setup?: Game['setup'] }, i: number): Color {
  const first = firstMover(g.settings, g.setup);
  return i % 2 === 0 ? first : other(first);
}

const freshScoring = (round: 1 | 2): Scoring =>
  Object.freeze({ round, rev: 0, dead: Object.freeze([]) as readonly Point[], accepted: Object.freeze([0, 0]) as readonly [number, number] });

function freezeScoring(s: Scoring): Scoring {
  const dead = Object.freeze([...new Set(s.dead)].sort());
  const accepted = Object.freeze([s.accepted[0] ?? 0, s.accepted[1] ?? 0]) as readonly [number, number];
  return Object.freeze({ round: s.round === 2 ? 2 : 1, rev: s.rev, dead, accepted });
}

interface MakeOpts {
  passes: number;
  scoring?: Scoring;
  end?: { result: Result };
}

function make(
  settings: Settings,
  setup: Game['setup'],
  plies: readonly Ply[],
  cursor: number,
  c: Core,
  o: MakeOpts,
): Game {
  const size = settings.size;
  const g: Game = Object.freeze({
    settings,
    plies,
    cursor,
    board: c.board.slice(),
    turn: colorAt({ settings, setup }, cursor),
    prisoners: Object.freeze({ B: c.prisoners.B, W: c.prisoners.W }),
    ko: c.ko >= 0 ? indexToPoint(c.ko, size) : null,
    passes: o.passes,
    ...(o.scoring ? { scoring: o.scoring } : {}),
    ...(o.end ? { end: Object.freeze({ result: freezeResult(o.end.result) }) } : {}),
    ...(setup ? { setup } : {}),
  });
  cores.set(g, c);
  return g;
}

function freezeResult(r: Result): Result {
  return Object.freeze(r.margin === undefined ? { winner: r.winner, by: r.by } : { winner: r.winner, by: r.by, margin: r.margin });
}

/** A game at `target` with the scoring state derived from the plies (and remembered marks). */
function moveTo(g: Game, target: number, keepEnd: boolean): Game {
  const c = target === g.cursor ? core(g) : compute(g.settings, g.setup, g.plies, target);
  const memo = g.scoring ? { cursor: g.cursor, scoring: g.scoring } : parked.get(g);
  let scoring: Scoring | undefined;
  if (c.run === 2) {
    scoring = memo && memo.cursor === target ? memo.scoring : freshScoring(c.entries >= 2 ? 2 : 1);
  }
  const out = make(g.settings, g.setup, g.plies, target, c, {
    passes: c.run,
    scoring,
    end: keepEnd ? g.end : undefined,
  });
  if (memo && memo.cursor !== target) parked.set(out, memo);
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* Game operations                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

export function newGame(settings: Settings, setup?: { board: Uint8Array; turn: Color }): Game {
  const size = settings.size;
  if (size !== 9 && size !== 13 && size !== 19) throw new RangeError(`Bad board size ${String(size)}`);
  const s: Settings = Object.freeze({
    size,
    rules: settings.rules === 'territory' ? 'territory' : 'area',
    handicap: normalizeHandicap(size, settings.handicap),
    komi2: Number.isFinite(settings.komi2) ? Math.round(settings.komi2) : defaultKomi2(settings.rules, settings.handicap),
  });
  let su: Game['setup'];
  if (setup) {
    if (setup.board.length !== size * size) throw new RangeError('Set-up board does not match the size');
    su = Object.freeze({ board: startBoard(s, { board: setup.board, turn: setup.turn }), turn: setup.turn === 'W' ? 'W' : 'B' });
  }
  const c = compute(s, su, [], 0);
  return make(s, su, Object.freeze([]), 0, c, { passes: 0 });
}

export function illegalReason(g: Game, p: Point): IllegalReason | null {
  if (isPass(p)) return null;
  const size = g.settings.size;
  const idx = pointToIndex(p, size);
  if (idx < 0) return 'occupied';
  const c = core(g);
  if (c.board[idx] !== 0) return 'occupied';
  if (idx === c.ko) return 'ko';
  const r = place(c.board, size, idx, colorNum(g.turn), c.hi, c.lo);
  if (typeof r === 'string') return r;
  if (c.seen.has(hkey(r.hi, r.lo))) return 'superko';
  return null;
}

export function isLegal(g: Game, p: Point): boolean {
  if (g.end || g.scoring) return false;
  if (isPass(p)) return true;
  return illegalReason(g, p) === null;
}

const cleanMs = (ms: number) => (Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0);

export function pass(g: Game, ms: number): Game {
  if (g.end) throw new Error('Game is over');
  if (g.scoring) throw new Error('Game is in scoring; resume first');
  const c = core(g);
  const passes = g.passes + 1;
  const entries = passes === 2 ? c.entries + 1 : c.entries;
  const next: Core = { ...c, ko: -1, run: passes, entries };
  const plies = Object.freeze([...g.plies.slice(0, g.cursor), Object.freeze({ m: PASS, ms: cleanMs(ms) })]);
  return make(g.settings, g.setup, plies, plies.length, next, {
    passes,
    scoring: passes === 2 ? freshScoring(entries >= 2 ? 2 : 1) : undefined,
  });
}

export function play(g: Game, p: Point, ms: number): Game {
  if (isPass(p)) return pass(g, ms);
  if (g.end) throw new Error('Game is over');
  if (g.scoring) throw new Error('Game is in scoring; resume first');
  const size = g.settings.size;
  const idx = pointToIndex(p, size);
  if (idx < 0) throw new Error(`Illegal move ${p}: not a point on ${size}×${size}`);
  const c = core(g);
  if (c.board[idx] !== 0) throw new Error(`Illegal move ${p}: occupied`);
  if (idx === c.ko) throw new Error(`Illegal move ${p}: ko`);
  const r = place(c.board, size, idx, colorNum(g.turn), c.hi, c.lo);
  if (typeof r === 'string') throw new Error(`Illegal move ${p}: ${r}`);
  const key = hkey(r.hi, r.lo);
  if (c.seen.has(key)) throw new Error(`Illegal move ${p}: superko`);
  const seen = new Set(c.seen);
  seen.add(key);
  const prisoners = { ...c.prisoners, [g.turn]: c.prisoners[g.turn] + r.captured };
  const next: Core = { board: r.board, hi: r.hi, lo: r.lo, seen, prisoners, ko: r.ko, run: 0, entries: c.entries };
  const plies = Object.freeze([...g.plies.slice(0, g.cursor), Object.freeze({ m: p, ms: cleanMs(ms) })]);
  return make(g.settings, g.setup, plies, plies.length, next, { passes: 0 });
}

export function undo(g: Game, n: number): Game {
  const target = Math.max(0, g.cursor - Math.max(0, Math.floor(n)));
  if (target === g.cursor) return g;
  return moveTo(g, target, false);
}

export function redo(g: Game, n: number): Game {
  const target = Math.min(g.plies.length, g.cursor + Math.max(0, Math.floor(n)));
  if (target === g.cursor) return g;
  return moveTo(g, target, false);
}

export function goto(g: Game, cursor: number): Game {
  const target = Math.min(g.plies.length, Math.max(0, Math.floor(cursor)));
  if (target === g.cursor) return g;
  return moveTo(g, target, true);
}

export function resume(g: Game): Game {
  if (!g.scoring || g.end) return g;
  return make(g.settings, g.setup, g.plies, g.cursor, core(g), { passes: 0 });
}

export function setScoring(g: Game, scoring: Scoring): Game {
  if (!g.scoring) throw new Error('Game is not in scoring');
  return make(g.settings, g.setup, g.plies, g.cursor, core(g), {
    passes: g.passes,
    scoring: freezeScoring(scoring),
    end: g.end,
  });
}

export function end(g: Game, result: Result): Game {
  if (g.end) return g;
  const plies = g.cursor < g.plies.length ? Object.freeze(g.plies.slice(0, g.cursor)) : g.plies;
  return make(g.settings, g.setup, plies, g.cursor, core(g), { passes: g.passes, scoring: g.scoring, end: { result } });
}

export function reopen(g: Game): Game {
  if (!g.end) return g;
  return make(g.settings, g.setup, g.plies, g.cursor, core(g), { passes: g.passes, scoring: g.scoring });
}

/**
 * Plays `plies` (or bare points, 0 ms each) from a new game. A ply that follows a double pass
 * resumes scoring first, so logs replay without storing resumes. Throws on an illegal ply.
 */
export function replay(settings: Settings, plies: readonly (Ply | Point)[]): Game {
  let g = newGame(settings);
  for (const x of plies) {
    const ply = typeof x === 'string' ? { m: x, ms: 0 } : x;
    if (g.scoring) g = resume(g);
    g = play(g, ply.m, ply.ms);
  }
  return g;
}

/**
 * Rebuilds a game from stored fields (`SavedGame`, `GameLog` plus its settings):
 * decodes `moves`, replays them with `ms`, then restores the scoring phase:
 * - a record that ends in scoring and stores `scoring` gets those marks;
 * - a record that ends in a double pass without `scoring` and without `result` was resumed;
 * - `result` ends the game (keeping the scoring marks of a scored game).
 * With `lenient`, a malformed or illegal ply stops the replay there instead of throwing
 * (for links typed or cut by hand).
 */
export function fromRecord(rec: GameRecordFields, opts: { lenient?: boolean } = {}): Game {
  const settings = makeSettings(rec.size, rec.rules, rec.handicap);
  const s: Settings = rec.komi2 !== undefined && Number.isFinite(rec.komi2) ? { ...settings, komi2: rec.komi2 } : settings;
  if (!opts.lenient && !isValidMoves(rec.moves)) throw new Error('Malformed move encoding');
  const points = decodeMoves(rec.moves);
  const ms = rec.ms ?? [];
  let g = newGame(s);
  for (let i = 0; i < points.length; i++) {
    try {
      if (g.scoring) g = resume(g);
      g = play(g, points[i], Number.isFinite(ms[i]) ? ms[i] : 0);
    } catch (e) {
      if (!opts.lenient) throw e;
      break;
    }
  }
  if (g.scoring) {
    if (rec.scoring) g = setScoring(g, rec.scoring);
    else if (!rec.result) g = resume(g);
  }
  if (rec.result) g = end(g, rec.result);
  return g;
}

/* ---------------------------------------------------------------------------------------------- */
/* Reading                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

function sortedPoints(idxs: Iterable<number>, size: number): Point[] {
  return [...idxs].map((i) => indexToPoint(i, size)).sort();
}

export function groupAt(g: Game, p: Point): Point[] {
  const size = g.settings.size;
  const idx = pointToIndex(p, size);
  const board = core(g).board;
  if (idx < 0 || board[idx] === 0) return [];
  const r = chain(board, size, idx);
  return sortedPoints(groupBuf.slice(0, r.n), size);
}

export function libertiesOf(g: Game, p: Point): number {
  const size = g.settings.size;
  const idx = pointToIndex(p, size);
  const board = core(g).board;
  if (idx < 0 || board[idx] === 0) return 0;
  return chain(board, size, idx).libs;
}

export function atari(g: Game, color: Color): Point[][] {
  const size = g.settings.size;
  const board = core(g).board;
  const want = colorNum(color);
  const done = new Uint8Array(board.length);
  const out: Point[][] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== want || done[i]) continue;
    const r = chain(board, size, i);
    const members = groupBuf.slice(0, r.n);
    for (const m of members) done[m] = 1;
    if (r.libs === 1) out.push(sortedPoints(members, size));
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function selfAtariSize(g: Game, p: Point): number {
  if (isPass(p) || g.end || g.scoring || !isLegal(g, p)) return 0;
  const after = play(g, p, 0);
  const size = g.settings.size;
  const idx = pointToIndex(p, size);
  const r = chain(core(after).board, size, idx);
  if (r.libs !== 1) return 0;
  const n = r.n;
  // Capturable at once: the opponent may legally play the last liberty (not ko, not superko).
  return illegalReason(after, indexToPoint(r.lastLib, size)) === null ? n : 0;
}

export function colorOfPly(g: Game, i: number): Color {
  return colorAt(g, i);
}

export function lastMove(g: Game): Point | null {
  return g.cursor > 0 ? g.plies[g.cursor - 1].m : null;
}

export function position(g: Game): Position {
  const size = g.settings.size;
  const start = startBoard(g.settings, g.setup);
  const B: Point[] = [];
  const W: Point[] = [];
  for (let i = 0; i < start.length; i++) {
    if (start[i] === BLACK) B.push(indexToPoint(i, size));
    else if (start[i] === WHITE) W.push(indexToPoint(i, size));
  }
  return Object.freeze({
    size,
    rules: g.settings.rules,
    komi2: g.settings.komi2,
    setup: Object.freeze({ B: Object.freeze(B.sort()), W: Object.freeze(W.sort()) }),
    first: firstMover(g.settings, g.setup),
    moves: Object.freeze(g.plies.slice(0, g.cursor).map((x) => x.m)),
    board: core(g).board.slice(),
    turn: g.turn,
    ko: g.ko,
  });
}

/* ---------------------------------------------------------------------------------------------- */
/* Move codec (DESIGN 13.2)                                                                         */
/* ---------------------------------------------------------------------------------------------- */

const MOVE_RE = /^(?:[a-s]{2}|tt)$/;

/** Two SGF letters per ply. Throws on a ply that is not a point `aa`–`ss` or `tt`. */
export function encodeMoves(plies: readonly Ply[]): string {
  let out = '';
  for (const p of plies) {
    if (!MOVE_RE.test(p.m)) throw new Error(`Bad ply: ${p.m}`);
    out += p.m;
  }
  return out;
}

/**
 * Inverse of `encodeMoves`. Never throws: returns the longest prefix of well-formed pairs
 * (`aa`–`ss` or `tt`) and ignores the rest. Whether a point lies on the board is checked when the
 * moves are played. Use `isValidMoves` to reject malformed input instead.
 */
export function decodeMoves(s: string): Point[] {
  const out: Point[] = [];
  if (typeof s !== 'string') return out;
  for (let i = 0; i + 1 < s.length; i += 2) {
    const m = s.slice(i, i + 2);
    if (!MOVE_RE.test(m)) break;
    out.push(m);
  }
  return out;
}

/** True when the whole string is well-formed (even length, every pair `aa`–`ss` or `tt`), optionally on a board of `size`. */
export function isValidMoves(s: string, size?: Size): boolean {
  if (typeof s !== 'string' || s.length % 2 !== 0) return false;
  for (let i = 0; i < s.length; i += 2) {
    const m = s.slice(i, i + 2);
    if (!MOVE_RE.test(m)) return false;
    if (size && m !== PASS && !isPoint(m, size)) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------------------------------- */
/* SGF export (DESIGN 13.3)                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** SGF text value: `\` and `]` escaped. */
function sgfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

/** `B+4.5`, `W+R`, `B+T`. */
export function formatResult(r: Result): string {
  const by = r.by === 'resign' ? 'R' : r.by === 'time' ? 'T' : formatHalf(r.margin ?? 0);
  return `${r.winner}+${by}`;
}

export function sgf(g: Game, meta: SgfMeta): string {
  const { size, rules, handicap, komi2 } = g.settings;
  const props: string[] = [
    'FF[4]',
    'GM[1]',
    'CA[UTF-8]',
    `AP[${sgfText(`Zigo:${meta.version}`)}]`,
    `SZ[${size}]`,
    `KM[${formatHalf(komi2)}]`,
    `RU[${rules === 'territory' ? 'Japanese' : 'Chinese'}]`,
  ];
  if (g.setup) {
    const pos = position(g);
    if (pos.setup.B.length) props.push(`AB${pos.setup.B.map((p) => `[${p}]`).join('')}`);
    if (pos.setup.W.length) props.push(`AW${pos.setup.W.map((p) => `[${p}]`).join('')}`);
    props.push(`PL[${g.setup.turn}]`);
  } else if (handicap >= 2) {
    props.push(`HA[${handicap}]`);
    props.push(`AB${handicapPoints(size, handicap).map((p) => `[${p}]`).join('')}`);
  }
  if (meta.black) props.push(`PB[${sgfText(meta.black)}]`);
  if (meta.white) props.push(`PW[${sgfText(meta.white)}]`);
  if (meta.date) props.push(`DT[${sgfText(meta.date)}]`);
  if (g.end) props.push(`RE[${formatResult(g.end.result)}]`);
  const tc = toTc(meta.tc);
  if (tc) {
    props.push(`TM[${round2(tc.baseMs / 1000)}]`);
    props.push(
      tc.kind === 'fischer'
        ? `OT[${sgfText(`fischer +${round2(tc.incMs / 1000)}s`)}]`
        : `OT[${sgfText(`${tc.periods}x${round2(tc.periodMs / 1000)} byo-yomi`)}]`,
    );
  }
  const count = g.end ? g.plies.length : g.cursor;
  let moves = '';
  for (let i = 0; i < count; i++) {
    const m = g.plies[i].m;
    moves += `;${colorAt(g, i)}[${isPass(m) ? '' : m}]`;
  }
  return `(;${props.join('')}${moves})`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Clocks (DESIGN 11)                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export function timeUsed(g: Game): Record<Color, number> {
  const used: Record<Color, number> = { B: 0, W: 0 };
  for (let i = 0; i < g.cursor; i++) used[colorAt(g, i)] += g.plies[i].ms;
  return used;
}

export function clockRunning(g: Game): boolean {
  for (let i = 0; i < g.cursor; i++) if (colorAt(g, i) === g.turn) return true;
  return false;
}

/**
 * Japanese byo-yomi (DESIGN 11): the periods left of `periods` after `over` ms spent in byo-yomi
 * (past the main time); 0 = out of time. A move made inside a period keeps it; overrunning a period
 * uses it up, one for each full period overrun; time is up the moment the last period reads zero
 * (as the flag, `remaining() <= 0`).
 *
 * `over` exactly one period: kept, unless it was the last one. The same rule drives the log
 * (`byoyomiStep`) and the running turn (`liveClock` in lib/clock.ts), so they always agree.
 */
export function byoyomiPeriodsLeft(periods: number, periodMs: number, over: number): number {
  if (periods <= 0 || periodMs <= 0) return 0;
  const t = Math.max(0, over);
  if (t >= periods * periodMs) return 0;
  const used = t <= 0 ? 0 : Math.ceil(t / periodMs) - 1;
  return periods - used;
}

const OUT: ClockState = Object.freeze({ mainMs: 0, periodMs: 0, periods: 0 });

/**
 * Applies one timed move of `spent` ms to a byo-yomi clock: main time first, then periods
 * (`byoyomiPeriodsLeft`). The next turn starts with a full period. Out of time is all zeros.
 */
export function byoyomiStep(
  s: ClockState,
  tc: { readonly periodMs: number },
  spent: number,
): ClockState {
  const t = Math.max(0, spent);
  const main = Math.max(0, s.mainMs);
  if (main > 0 && t <= main) return { mainMs: main - t, periodMs: tc.periodMs, periods: s.periods };
  const periods = byoyomiPeriodsLeft(s.periods, tc.periodMs, t - main);
  return periods > 0 ? { mainMs: 0, periodMs: tc.periodMs, periods } : OUT;
}

/**
 * Each side's clock at the cursor, excluding the running turn. Each side's first move is
 * untimed (it starts that side's clock). Fischer: every counted move subtracts its ms and adds the
 * increment. Byo-yomi: `byoyomiStep`. Clock off: time used per side in `mainMs`.
 * Derived from the per-ply `ms` log alone, so undo, redo, review and both devices of a room agree.
 */
export function clocks(g: Game, tc: TimeControl): Record<Color, ClockState> {
  if (!tc) {
    const used = timeUsed(g);
    return { B: { mainMs: used.B, periodMs: 0, periods: 0 }, W: { mainMs: used.W, periodMs: 0, periods: 0 } };
  }
  const init: ClockState =
    tc.kind === 'fischer'
      ? { mainMs: tc.baseMs, periodMs: 0, periods: 0 }
      : { mainMs: tc.baseMs, periodMs: tc.periodMs, periods: tc.periods };
  const left: Record<Color, ClockState> = { B: init, W: init };
  const moved: Record<Color, boolean> = { B: false, W: false };
  for (let i = 0; i < g.cursor; i++) {
    const col = colorAt(g, i);
    if (!moved[col]) {
      moved[col] = true;
      continue;
    }
    const spent = g.plies[i].ms;
    left[col] =
      tc.kind === 'fischer'
        ? { mainMs: left[col].mainMs + tc.incMs - spent, periodMs: 0, periods: 0 }
        : byoyomiStep(left[col], tc, spent);
  }
  return left;
}

/* ---------------------------------------------------------------------------------------------- */
/* Diagrams (tests and debugging)                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/** Rows from the top: `x`/`X`/`#` black, `o`/`O` white, anything else empty. Spaces are ignored. */
export function boardFromDiagram(rows: readonly string[]): { size: number; board: Uint8Array } {
  const clean = rows.map((r) => r.replace(/\s+/g, ''));
  const size = clean.length;
  const board = new Uint8Array(size * size);
  clean.forEach((r, y) => {
    if (r.length !== size) throw new Error(`Diagram row ${y} has ${r.length} points, expected ${size}`);
    for (let x = 0; x < size; x++) {
      const ch = r[x];
      board[y * size + x] = ch === 'x' || ch === 'X' || ch === '#' ? BLACK : ch === 'o' || ch === 'O' ? WHITE : 0;
    }
  });
  return { size, board };
}

/** Rows from the top: `x` black, `o` white, `.` empty. */
export function boardToDiagram(board: Uint8Array, size: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let r = '';
    for (let x = 0; x < size; x++) r += '.xo'[board[y * size + x]] ?? '?';
    rows.push(r);
  }
  return rows;
}

/** A game set up from a diagram (see `boardFromDiagram`). */
export function fromDiagram(rows: readonly string[], turn: Color = 'B', settings?: Partial<Settings>): Game {
  const { size, board } = boardFromDiagram(rows);
  if (size !== 9 && size !== 13 && size !== 19) throw new RangeError(`Diagram size ${size} is not 9, 13 or 19`);
  const s = makeSettings(size, settings?.rules ?? 'area', 0);
  return newGame({ ...s, ...settings, size }, { board, turn });
}

/* ---------------------------------------------------------------------------------------------- */
/* The API object                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export const zigo: ZigoApi = {
  newGame,
  isLegal,
  illegalReason,
  play,
  pass,
  undo,
  redo,
  goto,
  groupAt,
  libertiesOf,
  atari,
  selfAtariSize,
  resume,
  end,
  gtp,
  fromGtp,
  encodeMoves,
  decodeMoves,
  sgf,
  clocks,
  replay,
  fromRecord,
  setScoring,
  reopen,
  position,
  colorOfPly,
  lastMove,
  timeUsed,
  clockRunning,
};

export default zigo;
