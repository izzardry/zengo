/**
 * Computer levels (DESIGN 10.2): the table's names, target ranks, networks and methods.
 *
 * Metadata only. The move picker (KaTrain's calibrated-rank pick, level-1 humanizing, the
 * no-big-self-atari rule from level 3, visits scaled by board area) is package 2C's, on top of the
 * KataGo engine of package 2A. The ranks shown on the start screen come from calibration, not
 * from `target` (DESIGN 10.2).
 *
 * Pure, no imports, so Node scripts can load it directly.
 */

/** Default level of a new computer game (DESIGN 10.2). */
export const DEFAULT_LEVEL = 5;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 12;

/** The computer never answers faster than this (DESIGN 10.2). Enforced by the caller, not the engine. */
export const MIN_REPLY_MS = 400;

/** First level played with the large network, b10c128 (DESIGN 10.1). Levels below use b6c96. */
export const LARGE_NET_FROM = 8;

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
  /** `search` levels: visit range on 19×19 (scaled by board area on smaller boards). */
  readonly visits?: readonly [number, number];
  /** `search` levels: think up to this long when the visits allow it. */
  readonly timeMs?: number;
  /** Level 12: think at least this fraction of the remaining clock when that is longer than `timeMs`. */
  readonly clockFraction?: number;
}

/** DESIGN 10.2, starting values to be tuned (package 2C). */
export const LEVELS: readonly LevelSpec[] = Object.freeze([
  { level: 1, name: 'Beginner', target: '30k', net: 'small', method: 'humanized' },
  { level: 2, name: 'Novice', target: '22k', net: 'small', method: 'rank', rank: 22 },
  { level: 3, name: 'Easy', target: '18k', net: 'small', method: 'rank', rank: 18 },
  { level: 4, name: 'Casual', target: '15k', net: 'small', method: 'rank', rank: 15 },
  { level: 5, name: 'Medium', target: '12k', net: 'small', method: 'rank', rank: 12 },
  { level: 6, name: 'Moderate', target: '9k', net: 'small', method: 'rank', rank: 9 },
  { level: 7, name: 'Tricky', target: '6k', net: 'small', method: 'rank', rank: 6 },
  { level: 8, name: 'Hard', target: '3k', net: 'large', method: 'rank', rank: 3 },
  { level: 9, name: 'Tough', target: '1k', net: 'large', method: 'policy' },
  { level: 10, name: 'Expert', target: '2d', net: 'large', method: 'search', visits: [16, 32] },
  { level: 11, name: 'Master', target: '4d', net: 'large', method: 'search', visits: [64, 200], timeMs: 3000 },
  { level: 12, name: 'Insane', target: '5d', net: 'large', method: 'search', timeMs: 3000, clockFraction: 1 / 30 },
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
