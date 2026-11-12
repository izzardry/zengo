/**
 * Color pill (DESIGN 4.1): tap cycles random → black → white (Black moves first in Go). Default
 * random, remembered by the caller. A 500 ms hold opens the handicap dial (`onLongPress`); with a
 * handicap the pill reads `● black · H3`.
 *
 * - Room joiner, RESUME / REVIEW: dimmed and disabled (`disabled`), the creator's or the game's
 *   choice applies.
 * - Pass-and-play: both sides sit at this device, so the color does not apply (`colorFixed`): the
 *   color part is dimmed and a tap does nothing, but the hold still sets the handicap.
 *
 * The glyph is the board's stone (`StoneGlyph`); random is a stone split into both inks.
 */
import { StoneGlyph } from '@/components/board';
import { useI18n } from '@/lib/i18n';
import type { ColorChoice } from '@/lib/types';
import { cn } from '@/lib/utils';
import { nextColor } from './options';
import { useColorName, useHandicapText } from './text';
import { useHold, type PillAnchor } from './useHold';

export interface ColorPillProps {
  value: ColorChoice;
  onChange: (value: ColorChoice) => void;
  /** Handicap stones (0 or 2 … 9); shown as `· H3` when set. */
  handicap?: number;
  /** Called after a 500 ms hold: the handicap dial. Without it the pill has no hold. */
  onLongPress?: (anchor: PillAnchor) => void;
  /** Dimmed and not changeable (room joiner, or RESUME / REVIEW). */
  disabled?: boolean;
  /** Pass-and-play: the color part is dimmed and a tap does nothing; the hold still works. */
  colorFixed?: boolean;
  className?: string;
}

/** A 12 px glyph of the color choice: the board's stone, or a stone split in both inks for random. */
export function ColorGlyph({ value, className }: { value: ColorChoice; className?: string }) {
  if (value !== 'random') return <StoneGlyph color={value} className={cn('h-3 w-3 shrink-0', className)} />;
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn('h-3 w-3 shrink-0', className)} data-glyph="random">
      <path d="M6 1 A5 5 0 0 0 6 11 Z" fill="hsl(var(--ink-dark))" />
      <path d="M6 1 A5 5 0 0 1 6 11 Z" fill="hsl(var(--ink-light))" />
      <circle cx="6" cy="6" r="5" fill="none" stroke="hsl(var(--foreground))" strokeOpacity="0.7" strokeWidth="1" />
    </svg>
  );
}

export function ColorPill({ value, onChange, handicap = 0, onLongPress, disabled = false, colorFixed = false, className }: ColorPillProps) {
  const { t } = useI18n();
  const name = useColorName(value);
  const handicapText = useHandicapText(handicap);
  const hold = useHold(onLongPress, () => !colorFixed && onChange(nextColor(value)), disabled);

  const label = disabled
    ? t('start.colorLockedAria', { value: name, handicap: handicapText })
    : colorFixed
      ? t('start.colorLocalAria', { handicap: handicapText })
      : t('start.colorAria', { value: name, handicap: handicapText });

  return (
    <button
      type="button"
      {...hold}
      disabled={disabled}
      aria-label={label}
      data-testid="color-pill"
      data-value={value}
      data-handicap={handicap}
      className={cn(
        'pill-sm min-h-9 touch-manipulation px-4 font-mono lowercase text-foreground/80 [-webkit-touch-callout:none]',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-card/80 hover:text-foreground/80',
        className,
      )}
    >
      <span className={cn('inline-flex items-center gap-[inherit]', colorFixed && !disabled && 'opacity-50')} data-part="color">
        <ColorGlyph value={value} />
        <span>{name}</span>
      </span>
      {handicap >= 2 && (
        <span className="whitespace-nowrap" data-part="handicap">
          {'· '}
          {t('start.handicapShort', { n: handicap })}
        </span>
      )}
    </button>
  );
}
