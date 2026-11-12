/**
 * The static and memoized layers of the board SVG (DESIGN 5.1, 5.3, 5.4). Board units: one pitch;
 * intersection (col, row) at (col, row). Strokes that should stay 1 px use `non-scaling-stroke`.
 */
import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Color, Seating, Size } from '@/lib/types';
import { MARGIN, STAR_R, TEXT_SCALE, columnLabel, coordFontPitches, pointToCell, rowLabel, starSet } from './geometry';
import { STONE_FILL, STONE_OUTLINE } from './paint';
import { CODE_STYLE, renderStats, type RowCode } from './marks';

const NSS = 'non-scaling-stroke' as const;
const GRID: CSSProperties = { stroke: 'hsl(var(--foreground) / .4)', strokeWidth: 1, fill: 'none' };
const EDGE: CSSProperties = { stroke: 'hsl(var(--foreground) / .4)', strokeWidth: 1.75, fill: 'none' };
const STAR: CSSProperties = { fill: 'hsl(var(--foreground) / .55)' };
const COORD_FILL = 'hsl(var(--foreground) / .4)';

/** Grid lines: 1 px `foreground/40`, the outer square slightly heavier (DESIGN 5.1). */
export const GridLayer = memo(function GridLayer({ size }: { size: Size }) {
  const last = size - 1;
  let d = '';
  for (let i = 1; i < last; i++) d += `M${i} 0V${last}M0 ${i}H${last}`;
  return (
    <g data-layer="grid">
      <path d={d} style={GRID} vectorEffect={NSS} shapeRendering="crispEdges" />
      <rect x={0} y={0} width={last} height={last} style={EDGE} vectorEffect={NSS} shapeRendering="crispEdges" />
    </g>
  );
});

/** Star points: small filled dots under any stone (DESIGN 5.1). */
export const StarLayer = memo(function StarLayer({ size }: { size: Size }) {
  return (
    <g data-layer="stars" style={STAR}>
      {[...starSet(size)].map((p) => {
        const c = pointToCell(p, size);
        return c ? <circle key={p} cx={c.col} cy={c.row} r={STAR_R} data-star={p} /> : null;
      })}
    </g>
  );
});

/**
 * The rendered (layout) width of the SVG that holds `ref`, in CSS px; 0 until measured. Layout
 * size, not the transformed box: a scaled preview keeps the board's own label size.
 */
function useSvgWidth(ref: { readonly current: SVGGElement | null }): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    if (!svg) return;
    const measure = () => {
      const w = svg.clientWidth || (svg.parentElement?.clientWidth ?? 0);
      setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * GTP coordinates outside the left and bottom edge lines (DESIGN 5.4); in face-to-face seating also
 * outside the top and right edges, upside down for the far player (DESIGN 5.2). The labels are
 * 7–8 px whatever the pitch (`coordFontPx`): the layer measures its board and sizes them in pitches.
 */
export const CoordinateLayer = memo(function CoordinateLayer({ size, seating }: { size: Size; seating: Seating }) {
  const ref = useRef<SVGGElement>(null);
  const width = useSvgWidth(ref);
  const style: CSSProperties = { fill: COORD_FILL, fontSize: coordFontPitches(width, size) * TEXT_SCALE };
  const k = TEXT_SCALE;
  const off = (MARGIN - 0.16) * k;
  const last = (size - 1) * k;
  const items: JSX.Element[] = [];
  for (let i = 0; i < size; i++) {
    const at = i * k;
    items.push(
      <text key={`l${i}`} x={-off} y={at}>
        {rowLabel(i, size)}
      </text>,
      <text key={`b${i}`} x={at} y={last + off}>
        {columnLabel(i)}
      </text>,
    );
    if (seating === 'face') {
      items.push(
        <text key={`r${i}`} x={last + off} y={at} transform={`rotate(180 ${last + off} ${at})`}>
          {rowLabel(i, size)}
        </text>,
        <text key={`t${i}`} x={at} y={-off} transform={`rotate(180 ${at} ${-off})`}>
          {columnLabel(i)}
        </text>,
      );
    }
  }
  return (
    <g
      ref={ref}
      data-layer="coordinates"
      transform={`scale(${1 / TEXT_SCALE})`}
      style={style}
      textAnchor="middle"
      dominantBaseline="central"
      className="select-none font-sans"
      aria-hidden
    >
      {items}
    </g>
  );
});

/** The stones of one row, as `<use>` of the shared symbols. Re-renders only when its code changes. */
export const StoneRow = memo(function StoneRow({ row, code, defs }: { row: number; code: RowCode; defs: string }) {
  renderStats.stoneRows++;
  const items: JSX.Element[] = [];
  for (let c = 0; c < code.length; c++) {
    const st = CODE_STYLE[code[c]];
    if (!st) continue;
    const dead = code[c] === 'b' || code[c] === 'w';
    items.push(
      <use
        key={c}
        href={`#${defs}-${st.color}`}
        x={c - 0.5}
        y={row - 0.5}
        width={1}
        height={1}
        opacity={st.opacity}
        data-stone={st.color}
        data-col={c}
        data-state={dead ? 'dead' : st.opacity ? 'faded' : undefined}
      />,
    );
  }
  return <g data-row={row}>{items}</g>;
});

/** Small filled squares in the owner's ink, sized by `sizeOf` (DESIGN 5.3 territory and preview). */
export const SquaresLayer = memo(function SquaresLayer({
  squares,
  kind,
}: {
  squares: readonly { readonly col: number; readonly row: number; readonly owner: Color; readonly side: number }[];
  kind: 'territory' | 'preview';
}) {
  return (
    <g data-layer={kind}>
      {squares.map((s) => (
        <rect
          key={`${s.col},${s.row}`}
          x={s.col - s.side / 2}
          y={s.row - s.side / 2}
          width={s.side}
          height={s.side}
          style={{ fill: STONE_FILL[s.owner], stroke: STONE_OUTLINE, strokeWidth: 1 }}
          vectorEffect={NSS}
          data-mark={`${kind}-${s.owner}`}
        />
      ))}
    </g>
  );
});
