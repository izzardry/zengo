/**
 * Pure derivations for the board layers: per-row stone codes (the memo key of a stone row) and
 * the small squares of the territory and preview layers.
 */
import { pointToIndex } from '@/lib/zigo';
import type { Color, Point, Size } from '@/lib/types';

/**
 * One character per point of a row: `.` empty, `B`/`W` a stone, `b`/`w` a dead stone (40 %),
 * `x`/`y` a stone the territory preview fades (50 %).
 */
export type RowCode = string;

/** How each row-code character is drawn. */
export const CODE_STYLE: Readonly<Record<string, { readonly color: Color; readonly opacity?: number }>> = {
  B: { color: 'B' },
  W: { color: 'W' },
  b: { color: 'B', opacity: 0.4 },
  w: { color: 'W', opacity: 0.4 },
  x: { color: 'B', opacity: 0.5 },
  y: { color: 'W', opacity: 0.5 },
};

/** Row codes of a board: `codes[row]`. */
export function rowCodes(
  board: Uint8Array,
  size: number,
  dead: ReadonlySet<number> | null,
  fade: ReadonlySet<number> | null,
): RowCode[] {
  const out: RowCode[] = [];
  for (let r = 0; r < size; r++) {
    let s = '';
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      const v = board[i];
      if (v === 1) s += dead?.has(i) ? 'b' : fade?.has(i) ? 'x' : 'B';
      else if (v === 2) s += dead?.has(i) ? 'w' : fade?.has(i) ? 'y' : 'W';
      else s += '.';
    }
    out.push(s);
  }
  return out;
}

/** Test hook: how often stone rows rendered (memoization check). */
export const renderStats = { stoneRows: 0 };

/** Territory squares of the scoring layer on empty points (≈ 0.3 of a pitch). */
export function territorySquares(territory: Readonly<Record<Point, Color | null>>, board: Uint8Array, size: Size) {
  const out: { col: number; row: number; owner: Color; side: number }[] = [];
  for (const [p, owner] of Object.entries(territory)) {
    if (!owner) continue;
    const i = pointToIndex(p, size);
    if (i < 0 || board[i] !== 0) continue;
    out.push({ col: i % size, row: Math.floor(i / size), owner, side: 0.3 });
  }
  return out;
}

/** Preview squares on empty points, sized by ownership strength (below 0.1 nothing is drawn). */
export function previewSquares(ownership: ArrayLike<number>, board: Uint8Array, size: Size) {
  const out: { col: number; row: number; owner: Color; side: number }[] = [];
  const n = Math.min(board.length, ownership.length);
  for (let i = 0; i < n; i++) {
    const v = ownership[i];
    if (board[i] !== 0 || !Number.isFinite(v) || Math.abs(v) < 0.1) continue;
    out.push({ col: i % size, row: Math.floor(i / size), owner: v > 0 ? 'B' : 'W', side: 0.4 * Math.min(1, Math.abs(v)) });
  }
  return out;
}
