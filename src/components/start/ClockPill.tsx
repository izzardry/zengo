/**
 * Clock pill (DESIGN 4.1, 11): tap cycles the presets of the current board size, e.g. on 9×9
 * off · 2+7 · 3+10 · 5m 5×30s. Remembered per size by the caller.
 *
 * A 500 ms hold calls `onLongPress` (the custom clock dial). The hold suppresses the click that
 * follows release (Ztyle 08 ladder). Keyboard path for the hold: Shift+Enter, Shift+F10 or the
 * ContextMenu key.
 */
import { Timer } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Size, TimeControl } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatTc } from '@/lib/zigo';
import { nextClock } from './options';
import { useClockText } from './text';
import { HOLD_MS, useHold, type PillAnchor } from './useHold';

/** Hold time that opens the custom dial (Ztyle long-press ladder, 500 ms tier). */
export const CLOCK_HOLD_MS = HOLD_MS;

/** Where the hold happened (the same anchor every start pill reports). */
export type ClockPillAnchor = PillAnchor;

export interface ClockPillProps {
  /** Board size: picks the presets the tap cycles through. */
  size: Size;
  value: TimeControl;
  onChange: (value: TimeControl) => void;
  /** Called after a 500 ms hold. When omitted, the pill has no hold behavior. */
  onLongPress?: (anchor: PillAnchor) => void;
  /** Dimmed and not changeable (RESUME / REVIEW). */
  disabled?: boolean;
  className?: string;
}

export function ClockPill({ size, value, onChange, onLongPress, disabled = false, className }: ClockPillProps) {
  const { t } = useI18n();
  const text = useClockText(value);
  const hold = useHold(onLongPress, () => onChange(nextClock(size, value)), disabled);

  const label = disabled
    ? t('start.clockLockedAria', { value: text })
    : onLongPress
      ? t('start.clockHoldAria', { value: text })
      : t('start.clockAria', { value: text });

  return (
    <button
      type="button"
      {...hold}
      disabled={disabled}
      aria-label={label}
      data-testid="clock-pill"
      data-value={formatTc(value) ?? 'off'}
      className={cn(
        'pill-sm min-h-9 touch-manipulation px-4 font-mono lowercase text-foreground/80 [-webkit-touch-callout:none]',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-card/80 hover:text-foreground/80',
        className,
      )}
    >
      <Timer aria-hidden="true" />
      <span className="whitespace-nowrap tabular-nums">{text}</span>
    </button>
  );
}
