/**
 * Computer levels (DESIGN 10.2) and the rules the computer plays by on top of the engine (DESIGN
 * 10.2, 10.4).
 *
 * Who does what:
 * - The engine (`lib/engine/katago/engine.ts`) reads `levelSpec(level)` and picks a move by the
 *   level's method: level 1 samples the small net's policy at `temperature` without filling its own
 *   one-point eyes; levels 2–8 use KaTrain's calibrated-rank pick at `rank`; level 9 the large net's
 *   policy at a low temperature; levels 10–12 search (`visits`, `timeMs`, `clockFraction`). It
 *   honours `avoid` and passes when pass is its best move.
 * - This module adds the level rules the engine does not know (`pickMove`), with an injected `rng`:
 *   - level 1's humanizing: `randomShare` of its moves uniformly among the reasonable ones (policy
 *     above `REASONABLE_PRIOR`), and a group in atari captured only `captureShare` of the time;
 *   - from level 3 (`avoidSelfAtari`): never a self-atari of that many stones or more
 *     (`bigSelfAtariPoints`, handed to the engine as `avoid`, and checked again here);
 *   - passing only when nothing is contested (`openDame`, area rules);
 *   - resigning (`resignDecision`, DESIGN 10.4).
 * - The minimum reply time (`MIN_REPLY_MS`) and the clock are the caller's (`hooks/useComputer`).
 * - The ranks shown on the start screen come from calibration (`src/lib/ranks.json`), not `target`.
 *
 * Pure, no React, no DOM, no `Math.random`. Imports are relative with explicit `.ts` extensions so
 * that plain Node (type stripping) can load this file for the engine and the scripts.
 */
import type { ClockInfo, Color, EngineCandidate, Game, Point, Size, TimeControl } from './types.ts';
import { PASS, clocks, indexToPoint, isLegal, isPass, play, pointToIndex, selfAtariSize } from './zigo.ts';

/** Default level of a new computer game (DESIGN 10.2). */
export const DEFAULT_LEVEL = 5;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 12;

/** The computer never answers faster than this (DESIGN 10.2). Enforced by the caller, not the engine. */
export const MIN_REPLY_MS = 400;

/** First level played with the large network, b10c128 (DESIGN 10.1). Levels below use b6c96. */
export const LARGE_NET_FROM = 8;

/** A move is "reasonable" for level 1's random moves when its policy is above this (0.1 %). */
export const REASONABLE_PRIOR = 0.001;

/** First level that resigns (DESIGN 10.4: levels 1–4 never resign). */
export const RESIGN_FROM = 5;
/** Resign below this win rate… (DESIGN 10.4, KataGo's `resignThreshold` −0.9 in win/loss terms). */
export const RESIGN_WINRATE = 0.05;
/** …for this many of its turns in a row (KataGo's `resignConsecTurns`)… */
export const RESIGN_TURNS = 3;
/** …past this many plies per board point (KataGo's `resignMinMovesPerBoardArea`)… */
export const RESIGN_MIN_MOVES_PER_POINT = 0.4;
/** …and only when trailing by more than this many points (KataGo's `resignMinScoreDifference`, by size). */
export const RESIGN_MIN_TRAIL: Readonly<Record<Size, number>> = Object.freeze({ 9: 5, 13: 7, 19: 10 });

/** An empty point is neutral (a dame worth filling under area rules) below this ownership. */
export const DAME_OWNERSHIP = 0.3;

/**
 * How a level picks its move (DESIGN 10.2):
 * - `humanized`: b6c96 policy sampled at high temperature, with random reasonable moves (level 1);
 * - `rank`: KaTrain's calibrated-rank pick at `rank` kyu;
 * - `policy`: raw policy of the large net at low temperature;
 * - `search`: a visit-limited search (`visits`), or as many visits as fit in `timeMs`.
 */
export type LevelMethod = 'humanized' | 'rank' | 'policy' | 'search';

export interface LevelSpec {
  readonly level: number;
  /** English name, for logs and scripts. The UI uses `levelKey()` from `lib/i18n/core`. */
  readonly name: string;
  /** Target strength on 19×19 (`30k`, `2d`); a goal, not a calibration. */
  readonly target: string;
  readonly net: 'small' | 'large';
  readonly method: LevelMethod;
  /** `rank` levels: the kyu rank handed to the calibrated-rank pick. */
  readonly rank?: number;
  /** `search` levels: visit range on 19×19 (scaled by board area on smaller boards, `levelVisits`). */
  readonly visits?: readonly [number, number];
  /** `search` levels: think up to this long when the visits allow it. */
  readonly timeMs?: number;
  /** Level 12: think at least this fraction of the remaining clock when that is longer than `timeMs`. */
  readonly clockFraction?: number;
  /** `humanized`: policy temperature of the engine's sample. */
  readonly temperature?: number;
  /** `humanized`: share of moves played uniformly at random among the reasonable ones. */
  readonly randomShare?: number;
  /** `humanized`: probability of playing a capture of a group in atari when the pick is one. */
  readonly captureShare?: number;
  /** Never play a self-atari of this many stones or more (from level 3, DESIGN 10.2). */
  readonly avoidSelfAtari?: number;
  /** The level may resign (DESIGN 10.4). */
  readonly resigns: boolean;
}

/** DESIGN 10.2, starting values to be tuned. */
export const LEVELS: readonly LevelSpec[] = Object.freeze([
  {
    level: 1,
    name: 'Beginner',
    target: '30k',
    net: 'small',
    method: 'humanized',
    temperature: 2,
    randomShare: 0.3,
    captureShare: 0.5,
    resigns: false,
  },
  { level: 2, name: 'Novice', target: '22k', net: 'small', method: 'rank', rank: 22, resigns: false },
  { level: 3, name: 'Easy', target: '18k', net: 'small', method: 'rank', rank: 18, avoidSelfAtari: 4, resigns: false },
  { level: 4, name: 'Casual', target: '15k', net: 'small', method: 'rank', rank: 15, avoidSelfAtari: 4, resigns: false },
  { level: 5, name: 'Medium', target: '12k', net: 'small', method: 'rank', rank: 12, avoidSelfAtari: 4, resigns: true },
  { level: 6, name: 'Moderate', target: '9k', net: 'small', method: 'rank', rank: 9, avoidSelfAtari: 4, resigns: true },
  { level: 7, name: 'Tricky', target: '6k', net: 'small', method: 'rank', rank: 6, avoidSelfAtari: 4, resigns: true },
  { level: 8, name: 'Hard', target: '3k', net: 'large', method: 'rank', rank: 3, avoidSelfAtari: 4, resigns: true },
  { level: 9, name: 'Tough', target: '1k', net: 'large', method: 'policy', avoidSelfAtari: 4, resigns: true },
  { level: 10, name: 'Expert', target: '2d', net: 'large', method: 'search', visits: [16, 32], avoidSelfAtari: 4, resigns: true },
  {
    level: 11,
    name: 'Master',
    target: '4d',
    net: 'large',
    method: 'search',
    visits: [64, 200],
    timeMs: 3000,
    avoidSelfAtari: 4,
    resigns: true,
  },
  {
    level: 12,
    name: 'Insane',
    target: '5d',
    net: 'large',
    method: 'search',
    timeMs: 3000,
    clockFraction: 1 / 30,
    avoidSelfAtari: 4,
    resigns: true,
  },
] satisfies LevelSpec[]);

/** Clamp to 1–12 (non-numbers become the default level). */
export function normalizeLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
}

export function levelSpec(level: number): LevelSpec {
  return LEVELS[normalizeLevel(level) - 1];
}

/** True when the level plays with the large net, so it needs engine stage 2 (DESIGN 14). */
export function needsLargeNet(level: number): boolean {
  return levelSpec(level).net === 'large';
}

/**
 * The visit range of a search level on a `size` board: the table's 19×19 counts scaled by board
 * area (DESIGN 10.2), at least 1. Null for levels without a visit range (policy levels, level 12).
 * The engine scales the same way (`scaledVisits` in `lib/engine/katago/engine.ts`).
 */
export function levelVisits(level: number, size: number): readonly [number, number] | null {
  const v = levelSpec(level).visits;
  if (!v) return null;
  const scale = (n: number) => Math.max(1, Math.round((n * size * size) / 361));
  return [scale(v[0]), scale(v[1])];
}

/* ---------------------------------------------------------------------------------------------- */
/* Randomness                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

/** Seeded generator (mulberry32), 0 ≤ x < 1. The same algorithm the engine's pickers use. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit seed for the engine's own pickers (`EngineGenmoveOptions.seed`), drawn from `rng`. */
export function nextSeed(rng: () => number): number {
  return Math.floor(rng() * 4294967296) >>> 0;
}

/* ---------------------------------------------------------------------------------------------- */
/* Board facts the level rules need (rules only)                                                   */
/* ---------------------------------------------------------------------------------------------- */

function neighbours(i: number, size: number): number[] {
  const x = i % size;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < size - 1) out.push(i + 1);
  if (i >= size) out.push(i - size);
  if (i < size * size - size) out.push(i + size);
  return out;
}

const colorNum = (c: Color) => (c === 'B' ? 1 : 2);

/** True when `p` is empty and every neighbour on the board is a stone of the side to move. */
export function fillsOwnEye(g: Game, p: Point): boolean {
  if (isPass(p)) return false;
  const size = g.settings.size;
  const i = pointToIndex(p, size);
  if (i < 0 || g.board[i] !== 0) return false;
  const mine = colorNum(g.turn);
  return neighbours(i, size).every((j) => g.board[j] === mine);
}

/** True when the side to move captures at least one stone by playing `p` (false for illegal points and pass). */
export function captures(g: Game, p: Point): boolean {
  if (isPass(p) || !isLegal(g, p)) return false;
  const size = g.settings.size;
  const i = pointToIndex(p, size);
  const theirs = colorNum(g.turn) === 1 ? 2 : 1;
  // Only a point next to an opponent chain can capture; play it to be exact.
  if (!neighbours(i, size).some((j) => g.board[j] === theirs)) return false;
  return play(g, p, 0).prisoners[g.turn] > g.prisoners[g.turn];
}

/**
 * Points where the side to move would put `minStones` or more of its own stones into atari that the
 * opponent can capture at once (`zigo.selfAtariSize`), sorted. Only points next to its own stones can
 * do that, so the rest are skipped.
 */
export function bigSelfAtariPoints(g: Game, minStones: number): Point[] {
  if (g.end || g.scoring || minStones < 1) return [];
  const size = g.settings.size;
  const mine = colorNum(g.turn);
  const out: Point[] = [];
  for (let i = 0; i < size * size; i++) {
    if (g.board[i] !== 0) continue;
    // A lone new stone is 1; reaching `minStones` needs at least one own neighbour unless minStones is 1.
    if (minStones > 1 && !neighbours(i, size).some((j) => g.board[j] === mine)) continue;
    const p = indexToPoint(i, size);
    if (selfAtariSize(g, p) >= minStones) out.push(p);
  }
  return out.sort();
}

/**
 * Open dame under area rules: empty points next to stones of both colors that the engine sees as
 * nobody's (|ownership| < `DAME_OWNERSHIP`), that the side to move may play without filling its own
 * eye or putting its own stones into atari. Filling one is worth a point under area rules, so the
 * computer does not pass while one is open (DESIGN 10.4: never pass while a point is contested).
 * Under territory rules a dame is worth nothing: always []. Sorted.
 */
export function openDame(g: Game, ownership: ArrayLike<number> | null): Point[] {
  if (g.settings.rules !== 'area' || g.end || g.scoring || !ownership) return [];
  const size = g.settings.size;
  const out: Point[] = [];
  for (let i = 0; i < size * size; i++) {
    if (g.board[i] !== 0) continue;
    const own = ownership[i];
    if (!(Math.abs(own) < DAME_OWNERSHIP)) continue;
    const n = neighbours(i, size);
    if (!n.some((j) => g.board[j] === 1) || !n.some((j) => g.board[j] === 2)) continue;
    const p = indexToPoint(i, size);
    if (!isLegal(g, p) || fillsOwnEye(g, p) || selfAtariSize(g, p) > 0) continue;
    out.push(p);
  }
  return out.sort();
}

/* ---------------------------------------------------------------------------------------------- */
/* The move picker                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

/** What `pickMove` reads from the engine's answer (`EngineMove`). */
export interface EngineAnswer {
  readonly move: Point | 'resign';
  readonly candidates?: readonly EngineCandidate[];
}

/** Why the picker played what it played (logs, tests). */
export type PickReason = 'engine' | 'random' | 'spared-capture' | 'no-self-atari' | 'legal-fallback';

export interface Pick {
  /** A legal point or `tt` (pass). */
  readonly move: Point;
  readonly reason: PickReason;
}

/** One of `items` with probability ∝ prior^(1/temperature). */
function samplePrior(items: readonly EngineCandidate[], temperature: number, rng: () => number): EngineCandidate {
  const t = temperature > 0 ? temperature : 1;
  const top = Math.max(...items.map((c) => c.prior), 1e-12);
  const w = items.map((c) => Math.pow(Math.max(c.prior, 1e-12) / top, 1 / t));
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    if (r < w[i]) return items[i];
    r -= w[i];
  }
  return items[items.length - 1];
}

/**
 * The move the computer plays at `level` in `g`, given the engine's answer for that position.
 *
 * - The engine's move is kept unless a level rule below changes it; a pass stays a pass (the engine
 *   passes only when pass is its best move; `openDame` is the caller's check).
 * - Level 1 (`randomShare`): with that probability the move is replaced by one drawn uniformly from
 *   the reasonable candidates (policy above 0.1 %, legal, not filling its own eye). When the move
 *   captures, it is kept only with probability `captureShare`; otherwise a non-capturing reasonable
 *   candidate is drawn by policy at the level's temperature (if there is one).
 * - From level 3 (`avoidSelfAtari`): a move that self-ataris that many stones is replaced by the
 *   best candidate that does not (the engine was asked to avoid them; this is the second check).
 * - An illegal answer is replaced by the best legal candidate, else pass.
 *
 * `rng` is consumed in a fixed order, so a seeded `rng` repeats the same choices.
 */
export function pickMove(g: Game, level: number, answer: EngineAnswer, rng: () => number): Pick {
  const spec = levelSpec(level);
  const cands = (answer.candidates ?? []).filter((c) => !isPass(c.move));
  const usable = (p: Point) => isLegal(g, p) && !fillsOwnEye(g, p);
  let move: Point = answer.move === 'resign' ? PASS : answer.move;
  let reason: PickReason = 'engine';

  if (!isPass(move) && !isLegal(g, move)) {
    const alt = cands.find((c) => isLegal(g, c.move));
    move = alt ? alt.move : PASS;
    reason = 'legal-fallback';
  }
  if (isPass(move)) return { move: PASS, reason };

  if (spec.method === 'humanized') {
    const reasonable = cands.filter((c) => c.prior > REASONABLE_PRIOR && usable(c.move));
    const randomShare = spec.randomShare ?? 0;
    const roll = rng();
    if (reasonable.length > 0 && roll < randomShare) {
      move = reasonable[Math.min(reasonable.length - 1, Math.floor(rng() * reasonable.length))].move;
      reason = 'random';
    }
    const captureShare = spec.captureShare ?? 1;
    if (captureShare < 1 && captures(g, move)) {
      const keep = rng() < captureShare;
      if (!keep) {
        const quiet = reasonable.filter((c) => !captures(g, c.move));
        if (quiet.length > 0) {
          move = samplePrior(quiet, spec.temperature ?? 1, rng).move;
          reason = 'spared-capture';
        }
      }
    }
  }

  const limit = spec.avoidSelfAtari;
  if (limit !== undefined && selfAtariSize(g, move) >= limit) {
    const alt = cands.find((c) => usable(c.move) && selfAtariSize(g, c.move) < limit);
    move = alt ? alt.move : PASS;
    reason = 'no-self-atari';
  }
  return { move, reason };
}

/** The points the engine must not play at `level` in `g` (`EngineGenmoveOptions.avoid`). */
export function avoidFor(g: Game, level: number): Point[] {
  const limit = levelSpec(level).avoidSelfAtari;
  return limit === undefined ? [] : bigSelfAtariPoints(g, limit);
}

/* ---------------------------------------------------------------------------------------------- */
/* Clock                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * What the engine is told about its own clock at the start of its turn (`EngineApi.genmove`):
 * undefined when the clock is off or the game is over. The engine keeps to it (a share of the main
 * time plus the increment, or of a byo-yomi period; level 12 at least 1/30 of what is left).
 */
export function engineClock(g: Game, tc: TimeControl, color: Color): ClockInfo | undefined {
  if (!tc || g.end) return undefined;
  const left = clocks(g, tc)[color];
  return {
    tc,
    left: { mainMs: Math.max(0, left.mainMs), periodMs: Math.max(0, left.periodMs), periods: Math.max(0, left.periods) },
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Resigning (DESIGN 10.4)                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** The engine's view of one of the computer's turns, from the computer's side. */
export interface TurnView {
  readonly winrate?: number;
  readonly scoreLead?: number;
}

/**
 * True when the computer at `level` resigns now. `turns` are its own consecutive turns up to and
 * including this one, oldest first. It resigns when the level resigns (5–12), at least
 * `RESIGN_MIN_MOVES_PER_POINT` plies per board point have been played (`plies`), the last
 * `RESIGN_TURNS` turns all had a win rate below `RESIGN_WINRATE`, and it now trails by more than
 * `RESIGN_MIN_TRAIL` points. Unknown values never count toward resigning.
 */
export function resignDecision(level: number, size: Size, plies: number, turns: readonly TurnView[]): boolean {
  if (!levelSpec(level).resigns) return false;
  if (plies < RESIGN_MIN_MOVES_PER_POINT * size * size) return false;
  if (turns.length < RESIGN_TURNS) return false;
  const last = turns.slice(-RESIGN_TURNS);
  if (!last.every((t) => typeof t.winrate === 'number' && t.winrate < RESIGN_WINRATE)) return false;
  const now = last[last.length - 1].scoreLead;
  return typeof now === 'number' && now < -(RESIGN_MIN_TRAIL[size] ?? RESIGN_MIN_TRAIL[19]);
}
