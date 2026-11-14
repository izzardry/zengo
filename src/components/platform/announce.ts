/**
 * Texts for the polite live region (DESIGN 14.1): `Black: D4, captures 2`, `White passes`,
 * `Your group at C3 is in atari`. Pure; the caller passes `t` from `useI18n()` and puts the text
 * into its `aria-live="polite"` region.
 */
import type { TranslationKey, TranslationVars } from '@/lib/i18n';
import { atari, gtp, isPass } from '@/lib/zengo';
import type { Color, Game, Point, Size } from '@/lib/types';

export type Translate = (key: TranslationKey, vars?: TranslationVars) => string;

/** `Black` / `White` as the live region says it. */
export function colorName(t: Translate, color: Color): string {
  return t(color === 'B' ? 'platform.live.black' : 'platform.live.white');
}

/** `Black: D4`, `Black: D4, captures 2`. */
export function moveAnnouncement(t: Translate, color: Color, point: Point, size: Size, captures = 0): string {
  const move = t('platform.live.move', { color: colorName(t, color), point: gtp(point, size) });
  if (captures <= 0) return move;
  return captures === 1 ? t('platform.live.capturesOne', { move }) : t('platform.live.captures', { move, count: captures });
}

/** `White passes`. */
export function passAnnouncement(t: Translate, color: Color): string {
  return t('platform.live.pass', { color: colorName(t, color) });
}

/**
 * `Your group at C3 is in atari` (`owner: 'you'`), or `Black's group at C3 is in atari` in
 * pass-and-play. `point` is any stone of the group; name the group by its first stone.
 */
export function atariAnnouncement(t: Translate, point: Point, size: Size, owner: Color | 'you'): string {
  const vars = { point: gtp(point, size) };
  if (owner === 'you') return t('platform.live.atariYours', vars);
  return t(owner === 'B' ? 'platform.live.atariBlack' : 'platform.live.atariWhite', vars);
}

/**
 * The text for the ply that turned `before` into `after` (one ply forward): a stone with its
 * captures, or a pass. Null when `after` is not exactly one ply after `before`.
 */
export function plyAnnouncement(t: Translate, before: Game, after: Game): string | null {
  if (after.cursor !== before.cursor + 1) return null;
  const ply = after.plies[after.cursor - 1];
  if (!ply) return null;
  const color = before.turn;
  if (isPass(ply.m)) return passAnnouncement(t, color);
  const captures = after.prisoners[color] - before.prisoners[color];
  return moveAnnouncement(t, color, ply.m, after.settings.size, captures);
}

/**
 * Atari texts for groups of `color` that are in atari in `after` and were not in `before`
 * (DESIGN 5.3: the atari ring pulses "when the group enters atari"). Each group is named by its
 * first stone in SGF order (a group that grows and stays in atari counts as new). `owner` is `'you'` when `color` is this
 * device's side outside pass-and-play.
 */
export function newAtariAnnouncements(
  t: Translate,
  before: Game | null,
  after: Game,
  color: Color,
  owner: Color | 'you' = color,
): string[] {
  const seen = new Set<string>();
  if (before) for (const group of atari(before, color)) seen.add([...group].sort().join(''));
  const out: string[] = [];
  for (const group of atari(after, color)) {
    const sorted = [...group].sort();
    if (seen.has(sorted.join(''))) continue;
    out.push(atariAnnouncement(t, sorted[0], after.settings.size, owner));
  }
  return out;
}
