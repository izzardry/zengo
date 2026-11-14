/**
 * Pure board geometry (DESIGN 5.1, 5.4, 6.1): intersections ↔ screen positions, hit testing,
 * coordinates, sizing. No React, no DOM beyond a `DOMRect`-like box.
 *
 * Board units: one unit is one intersection pitch. Intersection (col, row) sits at (col, row),
 * row 0 at the top (SGF row `a`). The drawing spans `-MARGIN … size - 1 + MARGIN` on both axes,
 * so the whole board is `size + 0.6` pitches wide (DESIGN 5.1).
 */
import { gtp, indexToPoint, isPoint, pointToIndex, starPoints } from '@/lib/zengo';
import type { Point, Size } from '@/lib/types';

/** Margin outside the edge lines, in pitches: `(size + 0.6 - (size - 1)) / 2`. */
export const MARGIN = 0.8;

/** Stone radius in pitches: stones fill 0.95 of the pitch (DESIGN 5.1). */
export const STONE_R = 0.475;

/**
 * SVG text is laid out at 100× and scaled down: browsers lay out sub-pixel font sizes (0.28 user
 * units) unreliably inside a scaled SVG.
 */
export const TEXT_SCALE = 100;

/**
 * Coordinate label size in CSS px (DESIGN 5.4: `text-[0.5rem]`), clamped to the space the margin
 * leaves: 0.45 of a pitch, at least 7 px (still legible) and at most 8 px (0.5rem). On 19×19 phones
 * (pitch ≈ 15–19 px) a label of 7–8 px fits between an edge stone and the board's edge; on large
 * boards it stays 8 px instead of growing with the pitch.
 */
export const COORD_PX = { min: 7, max: 8, perPitch: 0.45 } as const;

/** Coordinate label size in CSS px for a rendered pitch (px). */
export function coordFontPx(pitchPx: number): number {
  return Math.min(COORD_PX.max, Math.max(COORD_PX.min, pitchPx * COORD_PX.perPitch));
}

/** Coordinate label size in pitches before the board is measured (jsdom, first paint). */
export const COORD_FALLBACK = 0.28;

/**
 * Coordinate label size in pitches for a rendered board `widthPx` wide; the fallback when the width
 * is unknown (0 or not finite).
 */
export function coordFontPitches(widthPx: number, size: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return COORD_FALLBACK;
  const pitchPx = widthPx / extent(size);
  return coordFontPx(pitchPx) / pitchPx;
}

/** Star point radius in pitches (DESIGN 5.1: ≈ 0.12 cell). */
export const STAR_R = 0.12;

/**
 * `--board-size` in portrait (DESIGN 5.1): 14rem stays free for the chrome (a measured reserve).
 * The board element is this wide and high; the frame adds its 4 px padding outside.
 */
export const BOARD_SIZE_PORTRAIT = 'clamp(280px, min(94vw, 100dvh - 14rem), 768px)';

/** `--board-size` in the mobile-landscape rail layout (the height minus 3rem). */
export const BOARD_SIZE_LANDSCAPE = 'clamp(280px, 100dvh - 3rem, 768px)';

/**
 * How far a dragging finger floats the ghost above the touch point on 13×13 and 19×19 (DESIGN 6.1:
 * "one finger-width"), in CSS px.
 */
export const LIFT_PX = 40;

/** Pointer travel (px) before a press counts as a drag, per pointer type. */
export const DRAG_THRESHOLD: Readonly<Record<string, number>> = { mouse: 3, pen: 4, touch: 8 };

/** Width (= height) of the drawing in pitches. */
export function extent(size: number): number {
  return size + 0.6;
}

/** The SVG viewBox for a board of `size`. */
export function viewBox(size: number): string {
  const e = extent(size);
  return `${-MARGIN} ${-MARGIN} ${e} ${e}`;
}

/** The box a hit test runs against (a `DOMRect` fits). It is the board drawing itself. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Pixel pitch of a box. */
export function pitchOf(box: Box, size: number): number {
  return box.width / extent(size);
}

/** Column and row of a point; null for a pass or a point off this board. */
export function pointToCell(p: Point, size: number): { col: number; row: number } | null {
  const i = pointToIndex(p, size);
  if (i < 0) return null;
  return { col: i % size, row: Math.floor(i / size) };
}

/** Point at a column and row, or null outside the board. */
export function cellToPoint(col: number, row: number, size: number): Point | null {
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= size || row >= size) return null;
  return indexToPoint(row * size + col, size);
}

/**
 * The intersection under a client point. Strict (default): the point's own cell, i.e. within half a
 * pitch of the intersection along both axes; null in the outer margin or off the board.
 * `clamp`: the nearest intersection, clamped to the board (for drags, which never leave the board).
 */
export function pointAt(x: number, y: number, box: Box | null, size: number, clamp = false): Point | null {
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const pitch = box.width / extent(size);
  const fx = (x - box.left) / pitch - MARGIN;
  const fy = (y - box.top) / (box.height / extent(size)) - MARGIN;
  let col = Math.round(fx);
  let row = Math.round(fy);
  if (clamp) {
    col = Math.max(0, Math.min(size - 1, col));
    row = Math.max(0, Math.min(size - 1, row));
    return cellToPoint(col, row, size);
  }
  if (fx < -0.5 || fy < -0.5 || fx > size - 0.5 || fy > size - 0.5) return null;
  return cellToPoint(col, row, size);
}

/** Client center of an intersection inside the box. */
export function pointCenter(p: Point, box: Box, size: number): { x: number; y: number } {
  const c = pointToCell(p, size) ?? { col: 0, row: 0 };
  const pitch = box.width / extent(size);
  return { x: box.left + (c.col + MARGIN) * pitch, y: box.top + (c.row + MARGIN) * (box.height / extent(size)) };
}

/**
 * The ghost's hit area for the confirming tap (DESIGN 6.1): its cell plus half a pitch, i.e. within
 * one pitch of the ghost along both axes.
 */
export function inGhostHitArea(ghost: Point, x: number, y: number, box: Box | null, size: number): boolean {
  if (!box || box.width <= 0) return false;
  const c = pointCenter(ghost, box, size);
  const pitch = box.width / extent(size);
  return Math.abs(x - c.x) <= pitch && Math.abs(y - c.y) <= pitch;
}

/** Moves a point by a screen direction (arrow keys), clamped to the board. */
export function stepPoint(p: Point, dCol: number, dRow: number, size: number): Point {
  const c = pointToCell(p, size) ?? { col: Math.floor(size / 2), row: Math.floor(size / 2) };
  const col = Math.max(0, Math.min(size - 1, c.col + dCol));
  const row = Math.max(0, Math.min(size - 1, c.row + dRow));
  return cellToPoint(col, row, size) as Point;
}

/** The center point (tengen), the keyboard cursor's start. */
export function centerPoint(size: number): Point {
  const m = Math.floor(size / 2);
  return cellToPoint(m, m, size) as Point;
}

/** GTP column letters (no I). */
export const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRST';

/** Column label (`A` … `T`, no `I`) of column `col` (0 = left). */
export function columnLabel(col: number): string {
  return GTP_COLUMNS[col] ?? '';
}

/** Row label of row `row` (0 = top): rows count from the bottom, `1` … `size`. */
export function rowLabel(row: number, size: number): string {
  return String(size - row);
}

/** The GTP name of a point (`D4`), or `''` for a point off the board. */
export function pointName(p: Point, size: Size): string {
  return isPoint(p, size) ? gtp(p, size) : '';
}

const starCache = new Map<number, ReadonlySet<Point>>();

/** Star points of a size as a set (cached). */
export function starSet(size: Size): ReadonlySet<Point> {
  let s = starCache.get(size);
  if (!s) {
    s = new Set(starPoints(size));
    starCache.set(size, s);
  }
  return s;
}

/** Board sizes the board draws. A stray value falls back to 19 for the drawing (never thrown). */
export function asSize(n: number): Size {
  return n === 9 || n === 13 ? n : 19;
}
