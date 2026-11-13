/**
 * Where toasts sit on the start screen. In game they sit above the toolbar; the start screen has no
 * toolbar but its footer (opponent selector, pills, status line, install pill, chevron), and a toast
 * at the in-game offset covered the pills' lower edge on phones.
 *
 * While the footer shows, it publishes the toasts' bottom offset in `START_TOAST_VAR` on `<html>`:
 *
 * - Under the footer's content, at Ztyle's start-screen offset (`max(1.5rem, inset + 0.5rem)`), when
 *   the strip under the status line (the chevron's row) holds a one-line toast with a gap above it.
 * - Otherwise (no chevron, mobile landscape) above the footer, over the blurred board preview.
 *
 * Wide portrait screens, whose toasts sit right of the board (`toastLayout` "beside"), keep their
 * in-game offset: the footer is centered and the toast clears it there.
 */
import { useEffect, type RefObject } from 'react';
import { START_TOAST_VAR, toastLayout } from '@/components/ui/toasterPlacement';

/** A one-line toast with an action button (sonner: 16 px padding, a 24 px button). */
export const START_TOAST_ROW_PX = 56;
/** Gap between a toast and the footer's content. */
export const START_TOAST_GAP_PX = 8;

/** The footer in px, from the layout (transforms left out: the footer slides in). */
export interface StartFooterBox {
  readonly viewportHeight: number;
  /** Top of the footer (the opponent selector). */
  readonly footerTop: number;
  /** Bottom of its content: the selector, pills, status line and install pill, not the chevron. */
  readonly contentBottom: number;
  /** The footer's own bottom offset (`max(2rem, inset + 1rem)` in portrait). */
  readonly footerBottom: number;
}

/** The toasts' bottom offset on the start screen, in px (see the module comment). */
export function startToastBottomPx(box: StartFooterBox): number {
  // Ztyle's max(1.5rem, inset + 0.5rem), with the inset read off the footer's max(2rem, inset + 1rem).
  const low = Math.max(24, box.footerBottom - 8);
  const below = box.viewportHeight - box.contentBottom;
  if (below >= low + START_TOAST_ROW_PX + START_TOAST_GAP_PX) return low;
  return Math.ceil(box.viewportHeight - box.footerTop + START_TOAST_GAP_PX);
}

/** Marks the footer row a toast may cover (the chevron). */
export const START_TOAST_FREE_ATTR = 'data-start-toast-free';

/** Measures the footer element (fixed, bottom-anchored), or null when it has no layout. */
export function measureStartFooter(footer: HTMLElement, viewportHeight: number): StartFooterBox | null {
  const height = footer.offsetHeight;
  if (!height) return null;
  const footerBottom = parseFloat(getComputedStyle(footer).bottom) || 0;
  const footerTop = viewportHeight - footerBottom - height;
  let content = 0;
  for (const child of Array.from(footer.children) as HTMLElement[]) {
    if (child.hasAttribute(START_TOAST_FREE_ATTR)) continue;
    content = Math.max(content, child.offsetTop + child.offsetHeight);
  }
  return { viewportHeight, footerTop, contentBottom: footerTop + content, footerBottom };
}

/** Publishes `START_TOAST_VAR` while the footer shows; removes it otherwise. */
export function useStartToastRoom(footer: RefObject<HTMLElement | null>, visible: boolean, landscape: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.removeProperty(START_TOAST_VAR);
    const el = footer.current;
    if (!visible || !el) {
      clear();
      return;
    }
    const update = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const box = toastLayout(landscape, viewport) === 'beside' ? null : measureStartFooter(el, viewport.height);
      if (box) root.style.setProperty(START_TOAST_VAR, `${startToastBottomPx(box)}px`);
      else clear();
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      clear();
    };
  }, [footer, visible, landscape]);
}
