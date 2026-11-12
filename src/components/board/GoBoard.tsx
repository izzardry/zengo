/**
 * The Go board (DESIGN 5, 6.1, 7, 8.4, 14.1). Controlled: it draws the position it is given and
 * reports input through callbacks; it never changes a game itself.
 *
 * - One SVG per size: grid, star points, coordinates (helpers), stones as `<use>` of shared
 *   symbols (memoized per row, so a move re-renders only the rows that changed), and the point
 *   states of 5.3 in priority order. `overflow: visible`; pulse layers sit above the stones.
 * - Over the SVG, an HTML `grid` of N×N `gridcell`s carries the labels (`black stone, D4`), the
 *   roving tabindex and the focus ring, and takes the pointer input (`useBoardInput`).
 * - A polite live region announces each move (`Black: D4, captures 2`, atari).
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { indexToPoint, isPoint, pointToIndex } from '@/lib/zigo';
import { DEAD_THRESHOLD } from '@/lib/scoring';
import type { Color, Point } from '@/lib/types';
import { useBoardInput } from '@/hooks/useBoardInput';
import { BOARD_SIZE_PORTRAIT, STONE_R, TEXT_SCALE, extent, pointToCell, starSet, viewBox } from './geometry';
import { countCaptures, describeAtari, describeMove, describePoint, type PointInfo } from './describe';
import { CoordinateLayer, GridLayer, SquaresLayer, StarLayer, StoneRow } from './layers';
import { previewSquares, rowCodes, territorySquares } from './marks';
import { StoneDefs } from './stones';
import { STONE_CONTRAST, useSvgId } from './paint';
import type { GoBoardProps } from './types';
import './board.css';

const NSS = 'non-scaling-stroke' as const;
const other = (c: Color): Color => (c === 'B' ? 'W' : 'B');

/** Counts changes of a value (React's "information from previous renders" pattern). */
function useChangeCount(value: unknown, active: boolean): number {
  const [state, setState] = useState({ value, n: active ? 1 : 0 });
  if (state.value !== value) {
    const n = active ? state.n + 1 : state.n;
    setState({ value, n });
    return active ? n : 0;
  }
  return active ? state.n : 0;
}

export function GoBoard({
  size,
  board,
  turn,
  interactive = true,
  helpers,
  lastMove = null,
  ko = null,
  atari,
  illegalReason,
  onPlay,
  onIllegal,
  onPass,
  onUndo,
  onRedo,
  onGhostChange,
  scoring = null,
  onToggleGroup,
  territoryPreview = null,
  hint = null,
  blunder = null,
  blunderKey = 0,
  seating = 'side',
  farColor = null,
  captureKeys,
  announce = true,
  boardSize = BOARD_SIZE_PORTRAIT,
  className,
}: GoBoardProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const defs = useSvgId('zigo-stone');
  const scoringOn = !!scoring;

  const getBox = useCallback(() => gridRef.current?.getBoundingClientRect() ?? null, []);

  const input = useBoardInput({
    size,
    board,
    interactive,
    helpers,
    scoring: scoringOn,
    illegalReason,
    onPlay,
    onIllegal,
    onPass,
    onUndo,
    onRedo,
    onToggleGroup,
    onGhostChange,
    getBox,
    liftDown: seating === 'face' && !!farColor && farColor === turn,
    captureKeys: captureKeys ?? interactive,
    rootRef: gridRef,
  });
  const { ghost, hover, cursor, setCursor, typed, typedError } = input;

  /* ---- derived marks ---- */

  const valid = (p: Point | null | undefined): p is Point => !!p && isPoint(p, size);
  const idx = (p: Point) => pointToIndex(p, size);

  const deadSet = useMemo(() => {
    if (!scoring) return null;
    const s = new Set<number>();
    for (const p of scoring.dead) {
      const i = pointToIndex(p, size);
      if (i >= 0 && board[i] !== 0) s.add(i);
    }
    return s;
  }, [scoring, size, board]);

  const ownership = territoryPreview?.ownership ?? null;
  const fadeSet = useMemo(() => {
    if (!ownership || scoring) return null;
    const s = new Set<number>();
    const t7 = Math.fround(DEAD_THRESHOLD);
    for (let i = 0; i < board.length && i < ownership.length; i++) {
      const v = ownership[i];
      if ((board[i] === 1 && v <= -t7) || (board[i] === 2 && v >= t7)) s.add(i);
    }
    return s;
  }, [ownership, scoring, board]);

  const codes = useMemo(() => rowCodes(board, size, deadSet, fadeSet), [board, size, deadSet, fadeSet]);

  const terrSquares = useMemo(
    () => (scoring ? territorySquares(scoring.territory, board, size) : null),
    [scoring, board, size],
  );
  const prevSquares = useMemo(
    () => (ownership && !scoring ? previewSquares(ownership, board, size) : null),
    [ownership, scoring, board, size],
  );

  const showLast = helpers && valid(lastMove) && board[idx(lastMove)] !== 0 ? lastMove : null;
  const showKo = helpers && !scoringOn && valid(ko) && board[idx(ko)] === 0 ? ko : null;
  const atariPoints = useMemo(() => {
    if (!helpers || scoringOn || !atari) return [] as Point[];
    const out: Point[] = [];
    for (const g of atari) for (const p of g) if (isPoint(p, size) && board[pointToIndex(p, size)] !== 0) out.push(p);
    return out;
  }, [helpers, scoringOn, atari, size, board]);

  // Hint: the best point pulses; the top three get numbers. A new hint object replays the pulse.
  const hintKey = useChangeCount(hint, !!hint);
  const hintBest = hint && 'best' in hint && valid(hint.best) ? hint.best : null;
  const hintTop = useMemo(
    () => (hint && 'top' in hint ? hint.top.filter((p) => isPoint(p, size)).slice(0, 3) : []),
    [hint, size],
  );
  const hintFirst = hintBest ?? hintTop[0] ?? null;

  const blunderPoint = helpers && valid(blunder) ? blunder : null;
  const blunderCount = useChangeCount(`${blunderPoint ?? ''}:${blunderKey}`, !!blunderPoint);

  /* ---- labels (only the marks that are drawn) ---- */

  const labels = useMemo(() => {
    const stars = starSet(size);
    const atariSet = new Set(atariPoints);
    const terr = scoring?.territory ?? null;
    const out: string[] = new Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const p = indexToPoint(i, size);
      const info: PointInfo = {
        stone: board[i] ?? 0,
        star: stars.has(p),
        lastMove: p === showLast,
        ko: p === showKo,
        atari: atariSet.has(p),
        dead: !!deadSet?.has(i),
        territory: terr && (board[i] === 0 || deadSet?.has(i)) ? (terr[p] ?? null) : null,
        hint: p === hintBest ? -1 : hintTop.indexOf(p) + 1,
      };
      out[i] = describePoint(p, size, info, t);
    }
    return out;
  }, [size, board, showLast, showKo, atariPoints, deadSet, scoring, hintBest, hintTop, t]);

  /* ---- focus ---- */

  const focusPoint = useCallback((p: Point, visible = false) => {
    const opts = { preventScroll: true, ...(visible ? { focusVisible: true } : {}) } as FocusOptions;
    gridRef.current?.querySelector<HTMLElement>(`[data-point="${p}"]`)?.focus(opts);
  }, []);

  // Arrow keys move the DOM focus with the cursor while the board has focus.
  useEffect(() => {
    const grid = gridRef.current;
    if (grid && document.activeElement instanceof HTMLElement && grid.contains(document.activeElement)) {
      if (document.activeElement.dataset.point !== cursor) focusPoint(cursor);
    }
  }, [cursor, focusPoint]);

  // "Hints move keyboard focus to the point" (DESIGN 5.3).
  useEffect(() => {
    if (hintKey > 0 && hintFirst) {
      setCursor(hintFirst);
      focusPoint(hintFirst, true);
    }
    // Only when a new hint arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintKey]);

  // A cursor left on another size (the size changed) goes back to the center.
  const cursorOk = isPoint(cursor, size);

  /* ---- live region ---- */

  const [announcement, setAnnouncement] = useState('');
  const announced = useRef<{ lastMove: Point | null; board: Uint8Array; atari: string }>({
    lastMove,
    board,
    atari: atariPoints.join(','),
  });
  useEffect(() => {
    const prev = announced.current;
    const atariKey = atariPoints.join(',');
    announced.current = { lastMove, board, atari: atariKey };
    if (!announce) return;
    const moved = prev.lastMove !== lastMove || prev.board !== board;
    if (!moved) return;
    const parts: string[] = [];
    if (lastMove && (lastMove === 'tt' || isPoint(lastMove, size))) {
      const mover = other(turn);
      parts.push(describeMove(mover, lastMove, countCaptures(prev.board, board, turn), size, t));
    }
    if (atari && atari.length > 0 && helpers && atariKey !== prev.atari) {
      for (const g of atari) parts.push(describeAtari(g, size, t));
    }
    if (parts.length > 0) setAnnouncement(parts.join('. '));
  }, [lastMove, board, announce, turn, size, t, atari, atariPoints, helpers]);

  /* ---- drawing ---- */

  const ghostCell = ghost ? pointToCell(ghost, size) : null;
  const ghostStone = ghost ? (board[idx(ghost)] ?? 0) : 0;
  const ghostReason = ghost && helpers ? (ghostStone ? 'occupied' : (illegalReason?.(ghost) ?? null)) : null;
  const hoverCell = hover && !ghost && board[idx(hover)] === 0 ? pointToCell(hover, size) : null;
  const last = size - 1;

  const onCellFocus = useCallback((p: Point) => setCursor(p), [setCursor]);
  const rows = useMemo(() => Array.from({ length: size }, (_, r) => r), [size]);

  const rootStyle = { '--board-size': boardSize } as CSSProperties;
  const squareStyle = {
    '--pitch': `calc(var(--board-size) / ${extent(size)})`,
    width: 'var(--board-size)',
    height: 'var(--board-size)',
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={cn('relative w-fit select-none', className)}
      style={rootStyle}
      data-testid="go-board"
      data-size={size}
    >
      <div className="rounded-lg bg-foreground/10 p-1 shadow-lg">
        <div className="relative rounded-md bg-card" style={squareStyle}>
          <svg
            viewBox={viewBox(size)}
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            overflow="visible"
            aria-hidden
            focusable={false}
            data-testid="board-svg"
          >
            <StoneDefs id={defs} />
            <GridLayer size={size} />
            <StarLayer size={size} />
            {helpers && <CoordinateLayer size={size} seating={seating} />}

            {ghostCell && (
              <g data-mark="crosshair" style={{ stroke: 'hsl(var(--foreground) / .5)', strokeWidth: 1.5 }}>
                <line x1={ghostCell.col} y1={0} x2={ghostCell.col} y2={last} vectorEffect={NSS} />
                <line x1={0} y1={ghostCell.row} x2={last} y2={ghostCell.row} vectorEffect={NSS} />
              </g>
            )}

            {terrSquares && <SquaresLayer squares={terrSquares} kind="territory" />}
            {prevSquares && <SquaresLayer squares={prevSquares} kind="preview" />}

            <g data-layer="stones">
              {rows.map((r) => (
                <StoneRow key={r} row={r} code={codes[r]} defs={defs} />
              ))}
            </g>

            <g data-layer="marks" fill="none">
              {deadSet &&
                [...deadSet].map((i) => {
                  const c = i % size;
                  const r = Math.floor(i / size);
                  const d = 0.17;
                  return (
                    <path
                      key={i}
                      d={`M${c - d} ${r - d}L${c + d} ${r + d}M${c + d} ${r - d}L${c - d} ${r + d}`}
                      style={{ stroke: 'hsl(var(--foreground) / .85)', strokeWidth: 1.5 }}
                      vectorEffect={NSS}
                      data-mark="dead"
                      data-point={indexToPoint(i, size)}
                    />
                  );
                })}
              {showLast && <LastMoveRing p={showLast} size={size} color={board[idx(showLast)] === 1 ? 'B' : 'W'} />}
              {showKo && <KoMark p={showKo} size={size} />}
              {atariPoints.map((p) => {
                const c = pointToCell(p, size);
                return c ? (
                  <circle
                    key={p}
                    cx={c.col}
                    cy={c.row}
                    r={STONE_R + 0.02}
                    style={{ stroke: 'hsl(var(--destructive) / .4)', strokeWidth: 2 }}
                    vectorEffect={NSS}
                    data-mark="atari"
                    data-point={p}
                  />
                ) : null;
              })}
            </g>

            {hoverCell && (
              <use
                href={`#${defs}-${turn}`}
                x={hoverCell.col - 0.5}
                y={hoverCell.row - 0.5}
                width={1}
                height={1}
                opacity={0.3}
                data-testid="hover"
                data-point={hover ?? undefined}
              />
            )}
            {ghostCell && ghost && (
              <Ghost col={ghostCell.col} row={ghostCell.row} point={ghost} color={turn} defs={defs} illegal={!!ghostReason} occupied={ghostStone !== 0} />
            )}

            {/* Pulse layer: above every stone, so no neighbour covers a glow. */}
            <g data-layer="pulses">
              {atariPoints.map((p) => {
                const c = pointToCell(p, size);
                return c ? (
                  <circle
                    key={p}
                    className="zigo-atari-pulse"
                    cx={c.col}
                    cy={c.row}
                    r={STONE_R}
                    fill="none"
                    style={{ stroke: 'hsl(var(--destructive))', strokeWidth: 3 }}
                    vectorEffect={NSS}
                    data-mark="atari-pulse"
                  />
                ) : null;
              })}
              {hintBest && <HintPulse key={hintKey} p={hintBest} size={size} />}
              {hintTop.map((p, i) => (
                <HintNumber key={p} p={p} n={i + 1} size={size} />
              ))}
              {blunderPoint && <BlunderPulse key={blunderCount} p={blunderPoint} size={size} color={turn} defs={defs} />}
            </g>
          </svg>

          <div
            ref={gridRef}
            role="grid"
            aria-label={t('board.label', { size })}
            aria-describedby={instructionsId}
            aria-readonly={!interactive || undefined}
            aria-rowcount={size}
            aria-colcount={size}
            className={cn('zigo-points absolute inset-0 flex flex-col', interactive && 'touch-none')}
            style={
              {
                padding: 'calc(var(--pitch) * 0.3)',
                ...(interactive ? { touchAction: 'none', WebkitTouchCallout: 'none' } : {}),
              } as CSSProperties
            }
            {...input.gridHandlers}
            onContextMenu={interactive ? (e) => e.preventDefault() : undefined}
            // A press must not move DOM focus (no stray focus ring after a tap); keyboard users Tab in.
            onMouseDown={(e) => e.preventDefault()}
          >
            {rows.map((r) => (
              <div role="row" key={r} className="flex flex-1">
                {rows.map((c) => {
                  const i = r * size + c;
                  const p = indexToPoint(i, size);
                  return (
                    <PointCell
                      key={p}
                      point={p}
                      label={labels[i]}
                      focusable={cursorOk ? p === cursor : i === Math.floor((size * size) / 2)}
                      onFocus={onCellFocus}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <span id={instructionsId} className="sr-only">
        {t(scoringOn ? 'board.instructionsScoring' : 'board.instructions')}
      </span>
      {announce && (
        <div aria-live="polite" aria-atomic className="sr-only" data-testid="board-live">
          {announcement}
        </div>
      )}

      {(typed || typedError) && (
        <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/2 z-chrome -translate-x-1/2 translate-y-1/2">
          <div
            data-testid="board-typed"
            key={typedError ?? 'typing'}
            className={cn(
              'rounded-full border border-border bg-card px-3 py-0.5 font-mono text-sm shadow-lg',
              typedError && !typed && 'zigo-typed-error text-destructive line-through',
            )}
          >
            {typed || typedError}
            {typed && <span className="ml-0.5 inline-block w-px animate-pulse bg-foreground">&nbsp;</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** One intersection's grid cell: label, roving tabindex, focus ring. Transparent. */
const PointCell = memo(function PointCell({
  point,
  label,
  focusable,
  onFocus,
}: {
  point: Point;
  label: string;
  focusable: boolean;
  onFocus: (p: Point) => void;
}) {
  return (
    <div
      role="gridcell"
      aria-label={label}
      tabIndex={focusable ? 0 : -1}
      data-point={point}
      onFocus={() => onFocus(point)}
      className="zigo-point relative flex-1 rounded-full"
    />
  );
});

function LastMoveRing({ p, size, color }: { p: Point; size: number; color: Color }) {
  const c = pointToCell(p, size);
  if (!c) return null;
  return (
    <circle
      cx={c.col}
      cy={c.row}
      r={0.15}
      style={{ stroke: STONE_CONTRAST[color], strokeWidth: 1.5 }}
      vectorEffect={NSS}
      data-mark="last"
      data-point={p}
    />
  );
}

function KoMark({ p, size }: { p: Point; size: number }) {
  const c = pointToCell(p, size);
  if (!c) return null;
  const s = 0.34;
  return (
    <rect
      x={c.col - s / 2}
      y={c.row - s / 2}
      width={s}
      height={s}
      style={{ stroke: 'hsl(var(--foreground) / .75)', strokeWidth: 1.5, fill: 'hsl(var(--card))' }}
      vectorEffect={NSS}
      data-mark="ko"
      data-point={p}
    />
  );
}

/** The ghost stone at 45 %; hollow with a small × on an illegal point (helpers on). */
function Ghost({
  col,
  row,
  point,
  color,
  defs,
  illegal,
  occupied,
}: {
  col: number;
  row: number;
  point: Point;
  color: Color;
  defs: string;
  illegal: boolean;
  occupied: boolean;
}) {
  if (illegal) {
    const d = 0.14;
    return (
      <g data-testid="ghost" data-point={point} data-illegal="true" style={{ stroke: 'hsl(var(--foreground) / .7)', strokeWidth: 1.5 }} fill="none">
        <circle cx={col} cy={row} r={STONE_R - 0.03} vectorEffect={NSS} style={{ fill: 'hsl(var(--card) / .6)' }} />
        <path d={`M${col - d} ${row - d}L${col + d} ${row + d}M${col + d} ${row - d}L${col - d} ${row + d}`} vectorEffect={NSS} />
      </g>
    );
  }
  // With helpers off, an occupied point shows only the crosshairs (the tap is ignored without comment).
  if (occupied) return <g data-testid="ghost" data-point={point} data-illegal="false" />;
  return (
    <use
      href={`#${defs}-${color}`}
      x={col - 0.5}
      y={row - 0.5}
      width={1}
      height={1}
      opacity={0.45}
      data-testid="ghost"
      data-point={point}
      data-illegal="false"
    />
  );
}

/** The green hint pulse, once (DESIGN 7.3); a still mark under reduced motion. */
function HintPulse({ p, size }: { p: Point; size: number }) {
  const c = pointToCell(p, size);
  if (!c) return null;
  return (
    <circle
      className="zigo-hint-pulse"
      cx={c.col}
      cy={c.row}
      r={STONE_R}
      style={{ fill: 'hsl(var(--success) / .3)', stroke: 'hsl(var(--success))', strokeWidth: 2 }}
      vectorEffect={NSS}
      data-mark="hint"
      data-point={p}
    />
  );
}

/** A top-three candidate number in a small mono font on a card-colored disc. */
function HintNumber({ p, n, size }: { p: Point; n: number; size: number }) {
  const c = pointToCell(p, size);
  if (!c) return null;
  return (
    <g data-mark="hint-n" data-point={p} data-n={n}>
      <circle cx={c.col} cy={c.row} r={0.3} style={{ fill: 'hsl(var(--card))', stroke: 'hsl(var(--success))', strokeWidth: 1.5 }} vectorEffect={NSS} />
      <text
        x={c.col * TEXT_SCALE}
        y={c.row * TEXT_SCALE}
        transform={`scale(${1 / TEXT_SCALE})`}
        textAnchor="middle"
        dominantBaseline="central"
        className="font-mono"
        style={{ fontSize: 0.38 * TEXT_SCALE, fill: 'hsl(var(--foreground))' }}
      >
        {n}
      </text>
    </g>
  );
}

/** The bounced stone (blunder guard, DESIGN 7.2): pulses red once at its point, then disappears. */
function BlunderPulse({ p, size, color, defs }: { p: Point; size: number; color: Color; defs: string }) {
  const c = pointToCell(p, size);
  if (!c) return null;
  return (
    <g className="zigo-blunder" data-mark="blunder" data-point={p}>
      <use href={`#${defs}-${color}`} x={c.col - 0.5} y={c.row - 0.5} width={1} height={1} />
      <circle cx={c.col} cy={c.row} r={STONE_R} fill="none" style={{ stroke: 'hsl(var(--destructive))', strokeWidth: 2.5 }} vectorEffect={NSS} />
    </g>
  );
}
