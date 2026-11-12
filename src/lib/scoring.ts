/**
 * Counting (DESIGN 8.2, 8.4) over the vendored goscorer (lightvector, MIT). Pure.
 *
 * goscorer is used through this module only; its types never leave it. It takes the board as
 * `stones[y][x]` (row 0 at the top, 0 empty / 1 black / 2 white, the same encoding as `Game.board`)
 * and a `markedDead[y][x]` grid built from the agreed dead set.
 *
 * Units: counts of stones and points are whole numbers; everything that can carry a half point
 * (komi, totals, margins) is half points ×2. A result is a pure function of
 * (size, rules, komi, handicap, moves, dead stones), so both devices of a room agree.
 *
 * - Area (Chinese): own living stones + empty points reached only by own stones (dead stones are
 *   removed first, so their points count for the side around them). Seki liberties and dame reach
 *   both colors and count for nobody; stones in seki count. White adds komi and, with a handicap,
 *   1 point per handicap stone.
 * - Territory (Japanese): goscorer's territory (no territory in seki, obvious false eyes excluded)
 *   plus prisoners: stones captured during play and opponent stones marked dead. White adds komi.
 */
import {
  BLACK,
  WHITE,
  areaScoring,
  territoryScoring,
  type GoscorerColor,
} from './vendor/goscorer';
import type { Color, Game, Point, Result, Score, ScoreSide, ScoringApi } from './types';
import { groupAt, indexToPoint, pointToIndex } from './zigo';

/** Ownership at or beyond this toward the opponent makes a stone dead (OGS's threshold, DESIGN 8.4). */
export const DEAD_THRESHOLD = 0.7;

/** The board at the cursor as goscorer's `stones[y][x]`. */
function stonesOf(g: Game): GoscorerColor[][] {
  const size = g.settings.size;
  const rows: GoscorerColor[][] = [];
  for (let y = 0; y < size; y++) {
    const row: GoscorerColor[] = [];
    for (let x = 0; x < size; x++) {
      const v = g.board[y * size + x];
      row.push(v === 1 ? BLACK : v === 2 ? WHITE : 0);
    }
    rows.push(row);
  }
  return rows;
}

/** Dead indices: points of the set that hold a stone (empty, malformed and off-board points are ignored). */
function deadIndices(g: Game, dead: readonly Point[]): Set<number> {
  const size = g.settings.size;
  const out = new Set<number>();
  for (const p of dead) {
    const i = pointToIndex(p, size);
    if (i >= 0 && g.board[i] !== 0) out.add(i);
  }
  return out;
}

function deadGrid(g: Game, dead: Set<number>): boolean[][] {
  const size = g.settings.size;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(dead.has(y * size + x));
    rows.push(row);
  }
  return rows;
}

/** Owner per board index (0 nobody, 1 black, 2 white) under the game's rules. Living stones keep their own color. */
function owners(g: Game, dead: Set<number>): Uint8Array {
  const size = g.settings.size;
  const stones = stonesOf(g);
  const marked = deadGrid(g, dead);
  const out = new Uint8Array(size * size);
  if (g.settings.rules === 'area') {
    const area = areaScoring(stones, marked);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = area[y][x];
  } else {
    const terr = territoryScoring(stones, marked);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = terr[y][x].isTerritoryFor;
  }
  return out;
}

export function score(g: Game, dead: readonly Point[]): Score {
  const { rules, handicap, komi2 } = g.settings;
  const deadSet = deadIndices(g, dead);
  const own = owners(g, deadSet);
  const side = { B: { territory: 0, stones: 0, prisoners: 0 }, W: { territory: 0, stones: 0, prisoners: 0 } };
  const colorOf = (v: number): Color | null => (v === 1 ? 'B' : v === 2 ? 'W' : null);
  for (let i = 0; i < g.board.length; i++) {
    const stone = colorOf(g.board[i]);
    const alive = stone !== null && !deadSet.has(i);
    if (alive) {
      side[stone].stones++;
      // goscorer's territory count covers every point; it never credits a living own stone, and
      // credits an unmarked opponent stone only in exotic shapes. Follow it so totals match.
      const owner = rules === 'territory' ? colorOf(own[i]) : null;
      if (owner && owner !== stone) side[owner].territory++;
      continue;
    }
    if (stone !== null) side[stone === 'B' ? 'W' : 'B'].prisoners++; // dead stone: a prisoner for the other side
    const owner = colorOf(own[i]);
    if (owner) side[owner].territory++;
  }
  side.B.prisoners += g.prisoners.B;
  side.W.prisoners += g.prisoners.W;
  const compensation2 = rules === 'area' && handicap >= 2 ? 2 * handicap : 0;
  const raw = (s: ScoreSide) => 2 * (rules === 'area' ? s.stones + s.territory : s.territory + s.prisoners);
  const total2 = { B: raw(side.B), W: raw(side.W) + komi2 + compensation2 };
  return Object.freeze({
    rules,
    B: Object.freeze(side.B),
    W: Object.freeze(side.W),
    komi2,
    compensation2,
    total2: Object.freeze(total2),
    margin2: total2.B - total2.W,
  });
}

export function territory(g: Game, dead: readonly Point[]): Record<Point, Color | null> {
  const size = g.settings.size;
  const deadSet = deadIndices(g, dead);
  const own = owners(g, deadSet);
  const out: Record<Point, Color | null> = {};
  for (let i = 0; i < g.board.length; i++) {
    if (g.board[i] !== 0 && !deadSet.has(i)) continue;
    out[indexToPoint(i, size)] = own[i] === 1 ? 'B' : own[i] === 2 ? 'W' : null;
  }
  return out;
}

/** The dead set as sorted, unique points that hold stones. */
function normalize(g: Game, dead: Iterable<number>): Point[] {
  const size = g.settings.size;
  return [...new Set(dead)].map((i) => indexToPoint(i, size)).sort();
}

export function toggle(g: Game, dead: readonly Point[], p: Point): Point[] {
  const set = deadIndices(g, dead);
  const size = g.settings.size;
  const group = groupAt(g, p).map((q) => pointToIndex(q, size));
  if (group.length === 0) return normalize(g, set);
  const allDead = group.every((i) => set.has(i));
  for (const i of group) {
    if (allDead) set.delete(i);
    else set.add(i);
  }
  return normalize(g, set);
}

export function propose(g: Game, ownership: Float32Array | null): Point[] {
  if (!ownership) return [];
  // Compared in float32 precision, so an ownership of exactly 0.7 in a Float32Array counts.
  const t = Math.fround(DEAD_THRESHOLD);
  const out: number[] = [];
  for (let i = 0; i < g.board.length; i++) {
    const v = ownership[i];
    if (!Number.isFinite(v)) continue;
    if ((g.board[i] === 1 && v <= -t) || (g.board[i] === 2 && v >= t)) out.push(i);
  }
  return normalize(g, out);
}

/** Winner by the margin; a tie (impossible with half-point komi) goes to White, as OGS does. */
export function result(g: Game, s: Score): Result {
  const winner: Color = s.margin2 > 0 ? 'B' : 'W';
  return Object.freeze({ winner, by: 'score' as const, margin: Math.abs(s.margin2) });
}

/** `B 45 · W 40 + 7.5`-style numbers for the score line: totals as decimals, e.g. `{ B: '45', W: '47.5' }`. */
export function formatTotals(s: Score): Record<Color, string> {
  return { B: String(s.total2.B / 2), W: String(s.total2.W / 2) };
}

export const scoring: ScoringApi = { score, territory, toggle, propose, result };

export default scoring;
