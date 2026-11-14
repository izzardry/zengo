/**
 * Where sonner's toasts sit (see sonner.tsx). Toasts never cover the board, its player strips or
 * the bottom bars (Ztyle 05, 09). Pure, for tests.
 *
 * - Mobile landscape: bottom right beside the board, narrowed to the space between the board and
 *   the right edge.
 * - Portrait on a wide screen whose board leaves room on its right: bottom right, narrowed to that
 *   room (at 1280×800 the board takes 576 px, so a 356 px toast would reach over its frame and the
 *   bottom strip's clock).
 * - Portrait otherwise (phones, tablets in portrait): above the bottom chrome, centered and at most
 *   356 px wide, so where the bottom player strip comes close it covers only the strip's empty
 *   middle, not its stone count or clock.
 *
 * "Above the bottom chrome" means above the toolbar, or above the scoring bar and its note while
 * dead stones are marked: the scoring bar publishes its measured height in `BOTTOM_CHROME_VAR`.
 *
 * The start screen has no toolbar but a footer of selectors and pills: while it shows, the footer
 * publishes the bottom offset that keeps a toast off it in `START_TOAST_VAR` (`StartFooter`), which
 * then replaces the portrait offset (phones and tablets) and the landscape one.
 *
 * In mobile landscape the space below the centered right rail (toolbar or scoring bar) holds a
 * one-line toast, but not a message with an action, which wraps to three or four rows there. So
 * while toasts show beside the landscape board, the Toaster publishes how much of the screen's
 * bottom they take in `RAIL_TOASTS_VAR`, and the rail moves up by that much (never above Help).
 */
import type { ComponentProps, CSSProperties } from "react";
import type { Toaster as Sonner } from "sonner";
import { BOARD_SIZE_LANDSCAPE, BOARD_SIZE_PORTRAIT } from "@/components/board/geometry";

type ToasterProps = ComponentProps<typeof Sonner>;

/**
 * CSS variable (on `<html>`) with the height of the portrait bottom chrome above its inset, when it
 * is taller than the toolbar: set by the scoring bar with its note (`ScoringBar`).
 */
export const BOTTOM_CHROME_VAR = "--zengo-bottom-chrome";
/**
 * CSS variable (on `<html>`) with the toasts' bottom offset on the start screen, set by the start
 * footer while it shows (`startToastBottomPx`); absent in game.
 */
export const START_TOAST_VAR = "--zengo-start-toast-bottom";
/**
 * CSS variable (on `<html>`) with the height the toasts take at the bottom right in mobile landscape
 * (their stack, the bottom offset and a gap), set by the Toaster while toasts show there
 * (`railToastsValue`); absent otherwise. The right rail stays above it (`railVars`, `ScoringBar`).
 */
export const RAIL_TOASTS_VAR = "--zengo-rail-toasts";
/** The portrait toolbar's height above its inset: 44 px buttons + py-1.5 + border. */
export const TOOLBAR_HEIGHT_PX = 58;

const INSET_BOTTOM = "max(1rem, env(safe-area-inset-bottom))";
/** Above the toolbar: its inset, its 58 px and a gap. */
const ABOVE_TOOLBAR = `calc(${INSET_BOTTOM} + ${TOOLBAR_HEIGHT_PX}px + 0.5rem)`;
/** Above the bottom chrome: the same with its published height (the scoring bar and its note). */
const ABOVE_CHROME = `calc(${INSET_BOTTOM} + var(${BOTTOM_CHROME_VAR}, ${TOOLBAR_HEIGHT_PX}px) + 0.5rem)`;
/**
 * Highest bottom offset that keeps a one-line toast (48 px) clear of the bottom player strip: the
 * board is centered, its strip ends about 28 px below it, then an 8 px gap (exported for tests).
 */
export const TOAST_BOTTOM_CAP = `calc(50dvh - ${BOARD_SIZE_PORTRAIT} / 2 - 88px)`;
/**
 * Portrait bottom offset: above the bottom chrome (the toolbar, or the scoring bar with its note),
 * but never so high that the toast reaches the board where only the note is below it (a 320×568
 * phone has no free row there: the toast then covers the note, never the board), and never lower
 * than above the toolbar. On the start screen the start footer's offset (`START_TOAST_VAR`) applies.
 */
export const TOAST_BOTTOM_PORTRAIT = `var(${START_TOAST_VAR}, max(${ABOVE_TOOLBAR}, min(${ABOVE_CHROME}, ${TOAST_BOTTOM_CAP})))`;
/** Landscape bottom offset: the bottom inset beside the board, or what the start footer publishes. */
export const TOAST_BOTTOM_LANDSCAPE = `var(${START_TOAST_VAR}, max(0.75rem, env(safe-area-inset-bottom)))`;
const RIGHT = "max(1rem, env(safe-area-inset-right))";
/** Sonner's gap between stacked toasts and the number it shows at once (its defaults). */
export const TOAST_GAP_PX = 14;
export const TOAST_VISIBLE = 3;

/**
 * Height in px of sonner's toast stack, the front toast first: collapsed, the toasts behind the
 * front one peek out a gap each; expanded (mouse over it), they stand one above the other.
 */
export function toastStackPx(heights: readonly number[], expanded: boolean): number {
  const shown = heights.slice(0, TOAST_VISIBLE);
  if (shown.length === 0) return 0;
  const gaps = (shown.length - 1) * TOAST_GAP_PX;
  return (expanded ? shown.reduce((sum, h) => sum + h, 0) : shown[0]) + gaps;
}

/** `RAIL_TOASTS_VAR` for a toast stack `stackPx` high: the stack, its bottom offset and a 0.5rem gap. */
export function railToastsValue(stackPx: number): string {
  return `calc(${Math.ceil(stackPx)}px + ${TOAST_BOTTOM_LANDSCAPE} + 0.5rem)`;
}
/** Space between the board and a toast beside it (the frame's 4 px padding included). */
const BESIDE_GAP = "0.75rem";
/** Landscape: the board leaves (100vw − board) / 2 on each side; the toast takes the right one. */
export const TOAST_WIDTH_LANDSCAPE = `max(160px, min(356px, calc((100vw - ${BOARD_SIZE_LANDSCAPE}) / 2 - ${BESIDE_GAP} - ${RIGHT})))`;
/** Portrait on a wide screen: the room right of the board (only used when it is at least `MIN_BESIDE_PX`). */
export const TOAST_WIDTH_BESIDE = `min(356px, calc((100vw - ${BOARD_SIZE_PORTRAIT}) / 2 - ${BESIDE_GAP} - ${RIGHT}))`;
/** Portrait without room beside the board, wider than a phone: centered, at most sonner's 356 px. */
export const TOAST_WIDTH_CENTERED = "min(356px, calc(100vw - 2rem))";
/** The same on phones (sonner's layout up to 600 px: the toast spans the screen less both side offsets). */
export const TOAST_SIDE_PHONE = "max(1rem, calc((100vw - 356px) / 2))";

/** Least toast width beside the portrait board; with less room the toast goes above the bottom chrome. */
export const MIN_BESIDE_PX = 200;
/** Sonner's phone layout (full width with the mobile offsets) holds up to this width. */
const SONNER_PHONE_MAX = 600;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** The portrait board in px for a viewport (`BOARD_SIZE_PORTRAIT`, safe areas left out). */
export function portraitBoardPx({ width, height }: Viewport): number {
  return Math.min(768, Math.max(280, Math.min(0.94 * width, height - 224)));
}

/** Width a toast right of the portrait board can take (`TOAST_WIDTH_BESIDE` without safe areas), in px. */
export function besideWidthPx(viewport: Viewport): number {
  return Math.min(356, (viewport.width - portraitBoardPx(viewport)) / 2 - 12 - 16);
}

/**
 * `TOAST_BOTTOM_PORTRAIT` in px for a viewport and a bottom chrome `chromePx` high (safe areas left
 * out), for tests.
 */
export function portraitToastBottomPx(viewport: Viewport, chromePx: number = TOOLBAR_HEIGHT_PX): number {
  const aboveToolbar = 16 + TOOLBAR_HEIGHT_PX + 8;
  const cap = viewport.height / 2 - portraitBoardPx(viewport) / 2 - 88;
  return Math.max(aboveToolbar, Math.min(16 + chromePx + 8, cap));
}

export type ToastLayout = "rail" | "beside" | "above";

/** Which portrait/landscape placement applies to a viewport. */
export function toastLayout(landscape: boolean, viewport: Viewport): ToastLayout {
  if (landscape) return "rail";
  return besideWidthPx(viewport) >= MIN_BESIDE_PX ? "beside" : "above";
}

export type ToasterPlacement = Pick<ToasterProps, "position" | "offset" | "mobileOffset" | "style" | "className"> & {
  readonly layout: ToastLayout;
};

/** Sonner's position, offsets and width for the current layout (exported for tests). */
export function toasterPlacement(landscape: boolean, viewport: Viewport = { width: 1024, height: 768 }): ToasterPlacement {
  const layout = toastLayout(landscape, viewport);
  if (layout === "rail") {
    const offset = { bottom: TOAST_BOTTOM_LANDSCAPE, right: RIGHT, left: "auto" };
    return {
      layout,
      position: "bottom-right",
      offset,
      mobileOffset: offset,
      style: { "--width": TOAST_WIDTH_LANDSCAPE } as CSSProperties,
      className: "zengo-toaster-rail",
    };
  }
  const mobileOffset = { bottom: TOAST_BOTTOM_PORTRAIT, left: TOAST_SIDE_PHONE, right: TOAST_SIDE_PHONE };
  if (layout === "beside") {
    return {
      layout,
      position: "bottom-right",
      offset: { bottom: TOAST_BOTTOM_PORTRAIT, right: RIGHT },
      mobileOffset,
      style: { "--width": TOAST_WIDTH_BESIDE } as CSSProperties,
    };
  }
  // Phones use sonner's own layout with the side offsets (the position only sets the swipe
  // direction there; bottom right keeps a sideways swipe).
  const phone = viewport.width <= SONNER_PHONE_MAX;
  return {
    layout,
    position: phone ? "bottom-right" : "bottom-center",
    offset: { bottom: TOAST_BOTTOM_PORTRAIT, right: RIGHT },
    mobileOffset,
    style: phone ? undefined : ({ "--width": TOAST_WIDTH_CENTERED } as CSSProperties),
  };
}
