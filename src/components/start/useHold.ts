/**
 * The 500 ms hold of the start-screen pills (DESIGN 6.3, Ztyle 08 long-press ladder): the color
 * pill opens the handicap dial, the size pill the rules dial, the clock pill the custom clock.
 *
 * A hold calls `onLongPress` with where it happened, and suppresses the click that follows the
 * release. Keyboard twin: Shift+Enter, Shift+F10 or the ContextMenu key.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

/** Hold time that opens a pill's dial (Ztyle long-press ladder, 500 ms tier). */
export const HOLD_MS = 500;

/** Where a pill was held, so its dial can open at the finger. */
export interface PillAnchor {
  /** Viewport coordinates of the pointer (or of the pill's center for the keyboard path). */
  x: number;
  y: number;
  /** The pill's bounding rectangle. */
  rect: DOMRect;
  /**
   * How the hold happened: `pointer` (the finger or mouse is still down, so the dial aims by
   * dragging) or `keyboard` (Shift+Enter, Shift+F10, ContextMenu).
   */
  source: 'pointer' | 'keyboard';
}

/** Handlers to spread on the pill's `<button>`, plus its ref. */
export function useHold(onLongPress: ((anchor: PillAnchor) => void) | undefined, onTap: () => void, disabled = false) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const ref = useRef<HTMLButtonElement>(null);
  const holdable = !!onLongPress && !disabled;

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const anchorAt = (source: PillAnchor['source'], x?: number, y?: number): PillAnchor => {
    const rect = ref.current?.getBoundingClientRect() ?? new DOMRect();
    return { x: x ?? rect.left + rect.width / 2, y: y ?? rect.top + rect.height / 2, rect, source };
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    held.current = false;
    if (!holdable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    clear();
    const { clientX, clientY } = e;
    timer.current = setTimeout(() => {
      timer.current = null;
      held.current = true;
      onLongPress?.(anchorAt('pointer', clientX, clientY));
    }, HOLD_MS);
  };

  const onClick = () => {
    if (held.current) {
      // The click that ends a hold is not a tap.
      held.current = false;
      return;
    }
    if (!disabled) onTap();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!holdable) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && (e.key === 'Enter' || e.key === 'F10'))) {
      e.preventDefault();
      onLongPress?.(anchorAt('keyboard'));
    }
  };

  const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (holdable) e.preventDefault();
  };

  return {
    ref,
    onPointerDown,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu,
    onClick,
    onKeyDown,
  };
}
