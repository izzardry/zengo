/**
 * Types for the vendored goscorer (./goscorer.js, MIT, lightvector/goscorer@0ac5f59).
 * Written for Zigo from the JSDoc in that file; only src/lib/scoring.ts should import it.
 *
 * Boards are row-major: `stones[y][x]`, y from the top. All arrays must be ysize × xsize.
 */

export type GoscorerColor = 0 | 1 | 2;

export const EMPTY: 0;
export const BLACK: 1;
export const WHITE: 2;

/** How one point scores under territory rules (see goscorer's Python version for details). */
export class LocScore {
  /** EMPTY, BLACK or WHITE: whose territory this point is. */
  isTerritoryFor: GoscorerColor;
  /** EMPTY, or the color of the seki group this point belongs to. */
  belongsToSekiGroup: GoscorerColor;
  isFalseEye: boolean;
  isUnscorableFalseEye: boolean;
  isDame: boolean;
  eyeValue: number;
}

/**
 * Territory score: territory + captures + stones marked dead of the opponent; komi added to white.
 * `scoreFalseEyes` (default false) also scores territory in unscorable false eyes.
 */
export function finalTerritoryScore(
  stones: readonly (readonly GoscorerColor[])[],
  markedDead: readonly (readonly boolean[])[],
  blackPointsFromCaptures: number,
  whitePointsFromCaptures: number,
  komi: number,
  scoreFalseEyes?: boolean,
): { black: number; white: number };

/** Area score: stones + surrounded points, after removing the stones marked dead; komi added to white. */
export function finalAreaScore(
  stones: readonly (readonly GoscorerColor[])[],
  markedDead: readonly (readonly boolean[])[],
  komi: number,
): { black: number; white: number };

/** Per-point territory scoring, with seki, dame and false-eye detection. */
export function territoryScoring(
  stones: readonly (readonly GoscorerColor[])[],
  markedDead: readonly (readonly boolean[])[],
  scoreFalseEyes?: boolean,
): LocScore[][];

/** Per-point area ownership: EMPTY, BLACK or WHITE. */
export function areaScoring(
  stones: readonly (readonly GoscorerColor[])[],
  markedDead: readonly (readonly boolean[])[],
): GoscorerColor[][];

export function getOpp(pla: 1 | 2): 1 | 2;
export function isOnBoard(y: number, x: number, ysize: number, xsize: number): boolean;
export function isOnBorder(y: number, x: number, ysize: number, xsize: number): boolean;
export function print2d<T>(board: T[][], f: (value: T) => string): void;
export function string2d<T>(board: T[][], f: (value: T) => string): string;
export function string2d2<T, U>(board1: T[][], board2: U[][], f: (a: T, b: U) => string): string;
export function colorToStr(color: GoscorerColor): string;
