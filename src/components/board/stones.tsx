/**
 * The stone symbol (DESIGN 5.1), shared by the board, the thumbnails and every glyph in text:
 * filled with the theme-stable ink (`--ink-dark` Black, `--ink-light` White, Ztyle 03), a thin
 * `foreground` outline so a stone contrasts with the board in both themes, and a soft radial
 * shading: a highlight toward the top left on Black, a shade toward the bottom right on White.
 * No drop shadow.
 */
import { memo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { Color } from '@/lib/types';
import { STONE_R } from './geometry';
import { STONE_FILL, STONE_OUTLINE, useSvgId } from './paint';

/**
 * Highest alpha of the shading. DESIGN 5.1 gives `foreground/6` and `foreground/8`; built from the
 * theme-stable inks so the highlight stays light and the shade dark in both themes.
 */
const HIGHLIGHT_ALPHA = 0.06;
const SHADE_ALPHA = 0.08;

/** The two radial gradients of the shading, under ids `${id}-hl` (Black) and `${id}-sh` (White). */
export function StoneGradients({ id }: { id: string }) {
  return (
    <>
      <radialGradient id={`${id}-hl`} cx="0.35" cy="0.3" r="0.55">
        <stop offset="0" style={{ stopColor: 'hsl(var(--ink-light))', stopOpacity: HIGHLIGHT_ALPHA }} />
        <stop offset="1" style={{ stopColor: 'hsl(var(--ink-light))', stopOpacity: 0 }} />
      </radialGradient>
      <radialGradient id={`${id}-sh`} cx="0.35" cy="0.3" r="0.9">
        <stop offset="0.45" style={{ stopColor: 'hsl(var(--ink-dark))', stopOpacity: 0 }} />
        <stop offset="1" style={{ stopColor: 'hsl(var(--ink-dark))', stopOpacity: SHADE_ALPHA }} />
      </radialGradient>
    </>
  );
}

/** The parts of one stone centered at (0, 0) with radius `r`. `id` names the gradients. */
export function StoneShape({ color, id, r = STONE_R, strokeWidth = 1 }: { color: Color; id: string; r?: number; strokeWidth?: number }) {
  const outline: CSSProperties = { fill: STONE_FILL[color], stroke: STONE_OUTLINE, strokeWidth };
  return (
    <>
      <circle r={r} style={outline} vectorEffect="non-scaling-stroke" />
      <circle r={r} fill={`url(#${id}-${color === 'B' ? 'hl' : 'sh'})`} />
    </>
  );
}

/**
 * `<defs>` with the gradients and one `<symbol>` per color, ids `${id}-B` and `${id}-W`, each a
 * 1×1 box centered on the stone: draw a stone with `<use href="#id-B" x={c - .5} y={r - .5} width={1} height={1} />`.
 */
export function StoneDefs({ id, strokeWidth = 1 }: { id: string; strokeWidth?: number }) {
  return (
    <defs>
      <StoneGradients id={id} />
      {(['B', 'W'] as const).map((c) => (
        <symbol key={c} id={`${id}-${c}`} viewBox="-0.5 -0.5 1 1" overflow="visible">
          <StoneShape color={c} id={id} strokeWidth={strokeWidth} />
        </symbol>
      ))}
    </defs>
  );
}

export interface StoneGlyphProps {
  readonly color: Color;
  readonly className?: string;
  /** Accessible name; without it the glyph is decorative (`aria-hidden`). */
  readonly title?: string;
}

/**
 * A small inline stone with the board's symbol style, for prisoners, the color pill, history, the
 * move list and the tutorial. Sized by CSS: 1em by default (`className="h-3 w-3"` to change).
 */
export const StoneGlyph = memo(function StoneGlyph({ color, className, title }: StoneGlyphProps) {
  const id = useSvgId('zigo-glyph');
  return (
    <svg
      viewBox="-0.5 -0.5 1 1"
      className={cn('inline-block h-[1em] w-[1em] shrink-0 overflow-visible align-[-0.125em]', className)}
      data-stone={color}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false })}
    >
      {title && <title>{title}</title>}
      <defs>
        <StoneGradients id={id} />
      </defs>
      <StoneShape color={color} id={id} />
    </svg>
  );
});
