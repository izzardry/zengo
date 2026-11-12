/**
 * Size pill (DESIGN 4.1): tap cycles 9×9 → 13×13 → 19×19. Default 9×9, remembered by the caller.
 * A 500 ms hold opens the rules dial (`onLongPress`); the pill shows `9×9` for area rules and
 * `9×9 · JP` for territory rules. RESUME / REVIEW show the saved game's size dimmed (`disabled`).
 */
import { Grid3x3 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Rules, Size } from '@/lib/types';
import { cn } from '@/lib/utils';
import { nextSize, sizeLabel } from './options';
import { useRulesName } from './text';
import { useHold, type PillAnchor } from './useHold';

export interface SizePillProps {
  size: Size;
  rules: Rules;
  onChange: (size: Size) => void;
  /** Called after a 500 ms hold: the rules dial. Without it the pill has no hold. */
  onLongPress?: (anchor: PillAnchor) => void;
  /** Dimmed and not changeable (RESUME / REVIEW). */
  disabled?: boolean;
  className?: string;
}

export function SizePill({ size, rules, onChange, onLongPress, disabled = false, className }: SizePillProps) {
  const { t } = useI18n();
  const rulesName = useRulesName(rules);
  const hold = useHold(onLongPress, () => onChange(nextSize(size)), disabled);
  const text = sizeLabel(size, rules);
  const vars = { size: `${size}×${size}`, rules: rulesName };

  return (
    <button
      type="button"
      {...hold}
      disabled={disabled}
      aria-label={disabled ? t('start.sizeLockedAria', vars) : t('start.sizeAria', vars)}
      data-testid="size-pill"
      data-value={size}
      data-rules={rules}
      className={cn(
        'pill-sm min-h-9 touch-manipulation px-4 font-mono text-foreground/80 [-webkit-touch-callout:none]',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-card/80 hover:text-foreground/80',
        className,
      )}
    >
      <Grid3x3 aria-hidden="true" />
      <span className="whitespace-nowrap tabular-nums">{text}</span>
    </button>
  );
}
