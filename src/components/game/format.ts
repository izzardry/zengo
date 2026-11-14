/**
 * Pure formatting helpers of the game chrome: move numbers and GTP labels, komi, the running
 * score line of DESIGN 8.4 and margins. No React.
 */
import { formatHalf, gtp, isPass } from '@/lib/zengo';
import type { Color, Language, Point, Score, Size } from '@/lib/types';

/** The other color. */
export function other(c: Color): Color {
  return c === 'B' ? 'W' : 'B';
}

/**
 * Move number and color of ply `i` (0-based). Go numbers every ply (`34. D4`, `35. Pass`); colors
 * alternate from `firstColor` (White with a handicap of 2 or more).
 */
export function plyInfo(i: number, firstMoveNumber = 1, firstColor: Color = 'B'): { number: number; color: Color } {
  return { number: firstMoveNumber + i, color: i % 2 === 0 ? firstColor : other(firstColor) };
}

/** GTP label of a move (`D4`), or `passLabel` for a pass. Falls back to the raw point if it is off the board. */
export function moveLabel(p: Point, size: Size, passLabel: string): string {
  if (isPass(p)) return passLabel;
  try {
    return gtp(p, size);
  } catch {
    return p;
  }
}

/** Komi as shown faint on White's strip: `+7.5`, `+0.5`. */
export function formatKomi(komi2: number): string {
  return `${komi2 >= 0 ? '+' : ''}${formatHalf(komi2)}`;
}

/** Room score in points: `1.5` → `1½`, `0.5` → `½`. */
export function formatPoints(points: number): string {
  const whole = Math.floor(points);
  const half = points - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

/** Half points ×2 as a number in the language's notation for sentences: `4.5` (EN), `4,5` (DE, FR, ES). */
export function localHalf(v2: number, lang: Language): string {
  const s = formatHalf(v2);
  return lang === 'en' ? s : s.replace('.', ',');
}

/** White's bonus in the count: komi plus, under area rules with handicap, the compensation. */
function whiteBonus2(s: Score): number {
  return s.komi2 + (s.rules === 'area' ? s.compensation2 : 0);
}

/**
 * The running score line of DESIGN 8.4, Go notation (B and W, decimal point in every language):
 * - area: `B 45 · W 40 + 7.5` (stones + territory; White's term adds komi and any handicap compensation),
 * - territory: `B 12 + 3 · W 10 + 1 + 6.5` (territory + prisoners, White adds komi).
 */
export function scoreLine(s: Score): string {
  const bonus = whiteBonus2(s);
  const komi = bonus !== 0 ? ` + ${formatHalf(bonus)}` : '';
  if (s.rules === 'territory') {
    return `B ${s.B.territory} + ${s.B.prisoners} · W ${s.W.territory} + ${s.W.prisoners}${komi}`;
  }
  return `B ${s.B.stones + s.B.territory} · W ${s.W.stones + s.W.territory}${komi}`;
}

/** Both totals as text (`45`, `47.5`), for the score line's accessible name. */
export function scoreTotals(s: Score): Record<Color, string> {
  return { B: formatHalf(s.total2.B), W: formatHalf(s.total2.W) };
}
