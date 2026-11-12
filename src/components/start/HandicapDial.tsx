/**
 * Handicap dial (DESIGN 4.1, 6.3, 8.2): opens on the 500 ms hold of the color pill. Offers `0`
 * (none) and `2` … `9` on 13×13 and 19×19, `0` and `2` … `5` on 9×9, clockwise from 12 o'clock.
 * Black receives the stones; the caller remembers the pick per board size.
 *
 * DESIGN 15.3 lists `HandicapDial` under `components/board/`; it lives here because the start
 * screen owns its dials (with the clock and rules dials).
 */
import { StoneGlyph } from '@/components/board';
import { useI18n } from '@/lib/i18n';
import type { Size } from '@/lib/types';
import { handicapOptions } from './options';
import { RadialDial } from './RadialDial';

export interface HandicapDialProps {
  /** Where the hold happened, in viewport coordinates (`PillAnchor.x / .y`). */
  readonly x: number;
  readonly y: number;
  /** The pointer that held the pill is still down: drag-to-aim is live from the start. */
  readonly dragging?: boolean;
  /** Board size: sets the largest handicap. */
  readonly size: Size;
  /** The current handicap (0 or 2 … 9). */
  readonly value: number;
  readonly onPick: (handicap: number) => void;
  readonly onCancel: () => void;
}

export function HandicapDial({ x, y, dragging = false, size, value, onPick, onCancel }: HandicapDialProps) {
  const { t } = useI18n();
  const options = handicapOptions(size);
  const noted = options.indexOf(value);
  const board = `${size}×${size}`;
  return (
    <RadialDial
      x={x}
      y={y}
      dragging={dragging}
      step={{
        id: 'handicap',
        title: t('start.dial.handicapTitle', { size: board }),
        caption: (
          <>
            <StoneGlyph color="B" className="h-2.5 w-2.5" />
            <span>
              {t('start.dial.handicapCaption')} · {board}
            </span>
          </>
        ),
        noted: noted >= 0 ? noted : null,
        items: options.map((n) => ({
          value: String(n),
          text: String(n),
          label: n === 0 ? t('start.dial.handicapNone') : t('start.handicapStones', { n }),
        })),
      }}
      onChoose={(i) => onPick(options[i])}
      onCancel={onCancel}
      keysHint={t('start.dial.keys')}
      cancelLabel={t('start.dial.cancel')}
      testId="handicap-dial"
    />
  );
}
