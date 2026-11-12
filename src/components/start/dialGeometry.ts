/**
 * Ztyle radial dial geometry (Ztyle 08) for the start screen's three dials: the clock dial, the
 * handicap dial and the rules dial. Pure, no React.
 *
 * Distances from the gesture's start point: centre < 25 px, dead ring to 40 px, aim 40–55 px,
 * commit ≥ 55 px. Items sit on a 60 px ring, item 0 at 12 o'clock, clockwise. A `rotation` (in
 * turns) turns the whole ring: a two-item dial uses −¼ so its items sit at 9 and 3 o'clock, clear
 * of the pill under the finger.
 */

export const DIAL_GEOMETRY = Object.freeze({
  radius: 60,
  popRadius: 105,
  center: 25,
  aim: 40,
  commit: 55,
  /** Radius + half an item: how far the dial reaches from its centre. */
  reach: 80,
});

/** Most items a radial dial holds (Ztyle 08). */
export const DIAL_MAX_ITEMS = 9;

export type DialZone = 'center' | 'none' | 'aim' | 'commit';

const TAU = 2 * Math.PI;

/** What a pointer offset from the dial's start point selects on an `n`-item dial. */
export function dialAim(dx: number, dy: number, n: number, rotation = 0): { zone: DialZone; index: number | null } {
  const d = Math.hypot(dx, dy);
  // An event without coordinates (synthetic, or a pointer the browser lost) aims at nothing.
  if (!Number.isFinite(d)) return { zone: 'none', index: null };
  if (d < DIAL_GEOMETRY.center) return { zone: 'center', index: null };
  if (d <= DIAL_GEOMETRY.aim || n <= 0) return { zone: 'none', index: null };
  let a = Math.atan2(dy, dx) + Math.PI / 2 - rotation * TAU + Math.PI / n;
  a = ((a % TAU) + TAU) % TAU;
  const index = Math.floor((a / TAU) * n) % n;
  return { zone: d >= DIAL_GEOMETRY.commit ? 'commit' : 'aim', index };
}

/** Position of item `i` of `n` at radius `r` around the centre (12 o'clock + rotation first, clockwise). */
export function dialItemOffset(i: number, n: number, r: number, rotation = 0): { x: number; y: number } {
  const angle = (i / n + rotation) * TAU - Math.PI / 2;
  // Rounded to 1/100 px so 12 o'clock is exactly (0, -r).
  const round = (v: number) => Math.round(v * 100) / 100 || 0;
  return { x: round(Math.cos(angle) * r), y: round(Math.sin(angle) * r) };
}

/** Index in `list` of the value closest to `v` (ties: the earlier), for the dial's start aim. */
export function nearestIndex(list: readonly number[], v: number): number {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i;
  return best;
}
