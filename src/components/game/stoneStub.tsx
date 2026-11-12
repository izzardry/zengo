/**
 * Test stand-in for `@/components/board` (not shipped: only loaded through `vi.mock` in the chrome's
 * tests). The chrome needs only `StoneGlyph` from the board package; the stub keeps these tests
 * independent of the board's own modules. It renders what the real glyph's contract promises: an
 * inline, decorative SVG of the given color.
 */
import type { Color } from '@/lib/types';

export function StoneGlyph({ color, className, title }: { color: Color; className?: string; title?: string }) {
  return (
    <svg data-stone={color} className={className} viewBox="0 0 10 10" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <circle cx="5" cy="5" r="4.5" />
    </svg>
  );
}
