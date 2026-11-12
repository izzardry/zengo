/**
 * Words for the screen reader (DESIGN 14.1): grid-cell labels (`black stone, D4`,
 * `empty, D4, star point`, `empty, D4, ko`) and move descriptions for the live region
 * (`Black: D4, captures 2`, `White passes`, `Your group at C3 is in atari`).
 */
import type { TranslationKey, TranslationVars } from '@/lib/i18n';
import type { Color, Point, Size } from '@/lib/types';
import { pointName } from './geometry';

/** The `t` of `useI18n()`. */
export type Translate = (key: TranslationKey, vars?: TranslationVars) => string;

/** What a cell shows, for its label. Only the marks actually drawn are passed. */
export interface PointInfo {
  /** 0 empty, 1 black, 2 white. */
  readonly stone: number;
  /** A star point; named only while empty. */
  readonly star?: boolean;
  readonly ko?: boolean;
  readonly lastMove?: boolean;
  readonly atari?: boolean;
  readonly dead?: boolean;
  /** Territory owner in scoring. */
  readonly territory?: Color | null;
  /** Hint: 0 none, -1 the best point, 1–3 the rank among the top three. */
  readonly hint?: number;
}

export function sideName(c: Color, t: Translate): string {
  return t(c === 'B' ? 'board.side.B' : 'board.side.W');
}

/** `black stone, D4`, `empty, D4, star point`, `empty, D4, ko`, `white stone, C3, last move, atari`. */
export function describePoint(p: Point, size: Size, info: PointInfo, t: Translate): string {
  const content = info.stone === 1 ? t('board.stone.B') : info.stone === 2 ? t('board.stone.W') : t('board.empty');
  const parts = [t('board.cell', { content, point: pointName(p, size) })];
  if (info.star && !info.stone) parts.push(t('board.state.star')); // a stone covers its star point (`black stone, D4`)
  if (info.lastMove) parts.push(t('board.state.lastMove'));
  if (info.ko) parts.push(t('board.state.ko'));
  if (info.atari) parts.push(t('board.state.atari'));
  if (info.dead) parts.push(t('board.state.dead'));
  if (info.territory) parts.push(t(info.territory === 'B' ? 'board.state.territory.B' : 'board.state.territory.W'));
  if (info.hint === -1) parts.push(t('board.state.hint'));
  else if (info.hint && info.hint > 0) parts.push(t('board.state.hintN', { n: info.hint }));
  return parts.join(', ');
}

/** `Black: D4`, `Black: D4, captures 2`, `White passes`. */
export function describeMove(side: Color, p: Point, captures: number, size: Size, t: Translate): string {
  if (p === 'tt') return t('board.say.pass', { side: sideName(side, t) });
  const point = pointName(p, size);
  return captures > 0
    ? t('board.say.capture', { side: sideName(side, t), point, n: captures })
    : t('board.say.move', { side: sideName(side, t), point });
}

/** `Your group at C3 is in atari` (the group's first stone in reading order names it). */
export function describeAtari(group: readonly Point[], size: Size, t: Translate): string {
  return t('board.say.atari', { point: pointName(group[0] ?? '', size) });
}

/**
 * Stones of `captured` removed between two boards: the points that held `captured`'s color before
 * and are empty now. 0 when the boards differ in size.
 */
export function countCaptures(before: Uint8Array, after: Uint8Array, captured: Color): number {
  if (before.length !== after.length) return 0;
  const v = captured === 'B' ? 1 : 2;
  let n = 0;
  for (let i = 0; i < before.length; i++) if (before[i] === v && after[i] === 0) n++;
  return n;
}
