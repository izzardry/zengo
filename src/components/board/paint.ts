/**
 * Stone paint shared by the board's layers, the thumbnails and the glyphs (DESIGN 5.1, Ztyle 03):
 * theme-stable inks, so Black is the darker and White the lighter neutral in both themes.
 */
import { useId } from 'react';
import type { Color } from '@/lib/types';

/** Fill of a stone of each color. */
export const STONE_FILL: Readonly<Record<Color, string>> = {
  B: 'hsl(var(--ink-dark))',
  W: 'hsl(var(--ink-light))',
};

/** The ink opposite a stone's: last-move ring, dead-stone × (DESIGN 5.3). */
export const STONE_CONTRAST: Readonly<Record<Color, string>> = {
  B: 'hsl(var(--ink-light))',
  W: 'hsl(var(--ink-dark))',
};

/** The thin outline. */
export const STONE_OUTLINE = 'hsl(var(--foreground) / .75)';

/** A DOM-id-safe prefix from `useId` (React ids contain colons). */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
