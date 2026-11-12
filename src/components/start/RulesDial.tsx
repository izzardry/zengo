/**
 * Rules dial (DESIGN 4.1, 6.3, 8.2): opens on the 500 ms hold of the size pill. Two items, at 9 and
 * 3 o'clock: `CN` area scoring (komi 7.5, the default) and `JP` territory scoring (komi 6.5),
 * matching the size pill's `· JP` label. The aimed item names itself in the caption.
 */
import { useI18n } from '@/lib/i18n';
import type { Rules } from '@/lib/types';
import { RULES_CHOICES, rulesKomi } from './options';
import { RadialDial } from './RadialDial';

export interface RulesDialProps {
  /** Where the hold happened, in viewport coordinates (`PillAnchor.x / .y`). */
  readonly x: number;
  readonly y: number;
  /** The pointer that held the pill is still down: drag-to-aim is live from the start. */
  readonly dragging?: boolean;
  readonly value: Rules;
  readonly onPick: (rules: Rules) => void;
  readonly onCancel: () => void;
}

export function RulesDial({ x, y, dragging = false, value, onPick, onCancel }: RulesDialProps) {
  const { t } = useI18n();
  return (
    <RadialDial
      x={x}
      y={y}
      dragging={dragging}
      step={{
        id: 'rules',
        title: t('start.dial.rulesTitle'),
        caption: t('start.dial.rulesCaption'),
        rotation: -0.25,
        noted: RULES_CHOICES.indexOf(value),
        items: RULES_CHOICES.map((r) => {
          const komi = rulesKomi(r);
          return r === 'territory'
            ? { value: r, text: 'JP', label: t('start.dial.territory', { komi }), caption: t('start.dial.territoryCaption', { komi }) }
            : { value: r, text: 'CN', label: t('start.dial.area', { komi }), caption: t('start.dial.areaCaption', { komi }) };
        }),
      }}
      onChoose={(i) => onPick(RULES_CHOICES[i])}
      onCancel={onCancel}
      keysHint={t('start.dial.keys')}
      cancelLabel={t('start.dial.cancel')}
      testId="rules-dial"
    />
  );
}
