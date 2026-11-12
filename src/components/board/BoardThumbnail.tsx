/**
 * Small static board for history cards (DESIGN 12.2): grid, star points and stones only, no
 * coordinates, no input, no state. One SVG with the board's stone symbols; strokes are thinner so
 * a 19×19 position still reads at thumbnail size.
 */
import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { Size } from '@/lib/types';
import { STAR_R, asSize, pointToCell, starSet, viewBox } from './geometry';
import { StoneDefs } from './stones';
import { useSvgId } from './paint';

export interface BoardThumbnailProps {
  /** Board size (9, 13 or 19). */
  readonly size: Size;
  /** size², 0 empty, 1 black, 2 white, row-major from the top. A short array draws what it has. */
  readonly board: Uint8Array;
  /** Edge length in px. Default 64. */
  readonly px?: number;
  /** Accessible name; without it the thumbnail is decorative. */
  readonly label?: string;
  readonly className?: string;
}

export const BoardThumbnail = memo(function BoardThumbnail({ size: rawSize, board, px = 64, label, className }: BoardThumbnailProps) {
  const size = asSize(rawSize);
  const id = useSvgId('zigo-thumb');
  const last = size - 1;
  let grid = '';
  for (let i = 0; i <= last; i++) grid += `M${i} 0V${last}M0 ${i}H${last}`;
  const stones: JSX.Element[] = [];
  const n = Math.min(board.length, size * size);
  for (let i = 0; i < n; i++) {
    const v = board[i];
    if (v !== 1 && v !== 2) continue;
    const c = v === 1 ? 'B' : 'W';
    stones.push(
      <use
        key={i}
        href={`#${id}-${c}`}
        x={(i % size) - 0.5}
        y={Math.floor(i / size) - 0.5}
        width={1}
        height={1}
        data-stone={c}
      />,
    );
  }
  return (
    <svg
      viewBox={viewBox(size)}
      width={px}
      height={px}
      className={cn('shrink-0 rounded-sm bg-card', className)}
      data-testid="board-thumbnail"
      data-size={size}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      <StoneDefs id={id} strokeWidth={0.5} />
      <path d={grid} fill="none" style={{ stroke: 'hsl(var(--foreground) / .35)', strokeWidth: 0.5 }} vectorEffect="non-scaling-stroke" />
      <g style={{ fill: 'hsl(var(--foreground) / .5)' }}>
        {[...starSet(size)].map((p) => {
          const c = pointToCell(p, size);
          return c ? <circle key={p} cx={c.col} cy={c.row} r={STAR_R * 1.2} /> : null;
        })}
      </g>
      {stones}
    </svg>
  );
});
