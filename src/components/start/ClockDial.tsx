/**
 * Custom time control dial (DESIGN 4.1, 6.3, 11): opens on the 500 ms hold of the clock pill. The
 * radial dial (`RadialDial`) walks through the steps:
 *
 *   system (Fischer · byo-yomi) → minutes → increment seconds          → `5+3`
 *                                         → period seconds → periods   → `20m5x30`
 *
 * Backspace goes one step back; the step that is left is aimed again. The current clock is marked
 * on every step it matches.
 */
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import type { TcString, TimeControl } from '@/lib/types';
import { nearestIndex } from './dialGeometry';
import { byoyomiTc, fischerTc } from './options';
import { RadialDial, type DialItem, type DialStep } from './RadialDial';

/**
 * Minutes on the custom dial, clockwise from 12 o'clock. Nine items: the Ztyle radial dial holds
 * at most nine values (Ztyle 08). The same list serves as Fischer base and byo-yomi main time.
 */
export const DIAL_MINUTES: readonly number[] = Object.freeze([1, 2, 3, 5, 10, 15, 20, 30, 60]);
/** Fischer increment seconds. */
export const DIAL_INCREMENTS: readonly number[] = Object.freeze([0, 1, 2, 3, 5, 10, 15, 20, 30]);
/** Byo-yomi period seconds. */
export const DIAL_PERIOD_SECONDS: readonly number[] = Object.freeze([5, 10, 15, 20, 30, 45, 60, 90, 120]);
/** Byo-yomi periods (DESIGN 11). */
export const DIAL_PERIODS: readonly number[] = Object.freeze([1, 3, 5, 10]);
/** The systems, item 0 at 9 o'clock, item 1 at 3 o'clock. */
export const DIAL_SYSTEMS = Object.freeze(['fischer', 'byoyomi'] as const);

type System = (typeof DIAL_SYSTEMS)[number];
type StepId = 'system' | 'minutes' | 'increment' | 'period' | 'periods';

export interface ClockDialProps {
  /** Where the hold happened, in viewport coordinates (`PillAnchor.x / .y`). */
  readonly x: number;
  readonly y: number;
  /**
   * The pointer that held the pill is still down: drag-to-aim is live from the start (touch and
   * mouse). False when opened from the keyboard.
   */
  readonly dragging?: boolean;
  /** The current clock; its values are marked and aimed first from the keyboard. */
  readonly value?: TimeControl;
  /** The custom time control was chosen, e.g. `20+5` or `20m5x30`. */
  readonly onPick: (tc: TcString) => void;
  /** Closed without a choice. */
  readonly onCancel: () => void;
}

interface Picks {
  system?: System;
  minutes?: number;
  period?: number;
}

const exact = (list: readonly number[], v: number | null) => (v === null ? null : list.findIndex((x) => Math.abs(x - v) < 1e-9));
const orNull = (i: number | null) => (i === null || i < 0 ? null : i);
const near = (list: readonly number[], v: number | null) => (v === null ? null : nearestIndex(list, v));

export function ClockDial({ x, y, dragging = false, value = null, onPick, onCancel }: ClockDialProps) {
  const { t } = useI18n();
  const [stepId, setStepId] = useState<StepId>('system');
  const [picks, setPicks] = useState<Picks>({});
  const [aimBack, setAimBack] = useState<number | null>(null);

  const curMinutes = value ? value.baseMs / 60_000 : null;
  const curInc = value?.kind === 'fischer' ? value.incMs / 1000 : null;
  const curPeriod = value?.kind === 'byoyomi' ? value.periodMs / 1000 : null;
  const curPeriods = value?.kind === 'byoyomi' ? value.periods : null;

  const numbered = (list: readonly number[], text: (v: number) => string, label: (v: number) => string): DialItem[] =>
    list.map((v) => ({ value: String(v), text: text(v), label: label(v) }));

  const step = ((): DialStep => {
    const m = picks.minutes ?? '';
    switch (stepId) {
      case 'system': {
        const noted = value ? DIAL_SYSTEMS.indexOf(value.kind) : null;
        return {
          id: 'system',
          title: t('start.dial.systemTitle'),
          caption: t('start.dial.systemCaption'),
          rotation: -0.25,
          noted,
          items: [
            { value: 'fischer', text: 'm+s', label: t('start.dial.fischer'), caption: t('start.dial.fischerCaption') },
            { value: 'byoyomi', text: 'byo', label: t('start.dial.byoyomi'), caption: t('start.dial.byoyomiCaption') },
          ],
        };
      }
      case 'minutes':
        return {
          id: 'minutes',
          title: t('start.dial.minutesTitle'),
          caption: t('start.dial.minutesCaption'),
          noted: orNull(exact(DIAL_MINUTES, curMinutes)),
          start: near(DIAL_MINUTES, curMinutes),
          items: numbered(DIAL_MINUTES, String, (v) => (v === 1 ? t('start.dial.minuteOne') : t('start.dial.minutes', { n: v }))),
        };
      case 'increment':
        return {
          id: 'increment',
          title: t('start.dial.incrementTitle', { minutes: m }),
          caption: `${m}+ · ${t('start.dial.incrementCaption')}`,
          noted: orNull(exact(DIAL_INCREMENTS, curInc)),
          start: near(DIAL_INCREMENTS, curInc),
          items: numbered(
            DIAL_INCREMENTS,
            (v) => `+${v}`,
            (v) =>
              v === 0 ? t('start.dial.incrementNone') : v === 1 ? t('start.dial.incrementOne') : t('start.dial.increment', { n: v }),
          ),
        };
      case 'period':
        return {
          id: 'period',
          title: t('start.dial.periodTitle', { minutes: m }),
          caption: `${m}m · ${t('start.dial.periodCaption')}`,
          noted: orNull(exact(DIAL_PERIOD_SECONDS, curPeriod)),
          start: near(DIAL_PERIOD_SECONDS, curPeriod),
          items: numbered(DIAL_PERIOD_SECONDS, (v) => `${v}s`, (v) => t('start.dial.period', { n: v })),
        };
      case 'periods':
        return {
          id: 'periods',
          title: t('start.dial.periodsTitle', { seconds: picks.period ?? '' }),
          caption: `${m}m ${picks.period ?? ''}s · ${t('start.dial.periodsCaption')}`,
          noted: orNull(exact(DIAL_PERIODS, curPeriods)),
          start: near(DIAL_PERIODS, curPeriods),
          items: numbered(
            DIAL_PERIODS,
            (v) => `×${v}`,
            (v) => (v === 1 ? t('start.dial.periodOne') : t('start.dial.periods', { n: v })),
          ),
        };
    }
  })();

  const go = (next: StepId, aim: number | null = null) => {
    setAimBack(aim);
    setStepId(next);
  };

  const onChoose = (i: number) => {
    switch (stepId) {
      case 'system':
        setPicks({ system: DIAL_SYSTEMS[i] });
        return go('minutes');
      case 'minutes':
        setPicks((p) => ({ ...p, minutes: DIAL_MINUTES[i] }));
        return go(picks.system === 'byoyomi' ? 'period' : 'increment');
      case 'increment':
        return onPick(fischerTc(picks.minutes ?? DIAL_MINUTES[0], DIAL_INCREMENTS[i]));
      case 'period':
        setPicks((p) => ({ ...p, period: DIAL_PERIOD_SECONDS[i] }));
        return go('periods');
      case 'periods':
        return onPick(byoyomiTc(picks.minutes ?? DIAL_MINUTES[0], DIAL_PERIODS[i], picks.period ?? DIAL_PERIOD_SECONDS[0]));
    }
  };

  const onBack = () => {
    const idx = (list: readonly number[], v: number | undefined) => (v === undefined ? null : orNull(list.indexOf(v)));
    switch (stepId) {
      case 'minutes':
        return go('system', picks.system ? DIAL_SYSTEMS.indexOf(picks.system) : null);
      case 'increment':
      case 'period':
        return go('minutes', idx(DIAL_MINUTES, picks.minutes));
      case 'periods':
        return go('period', idx(DIAL_PERIOD_SECONDS, picks.period));
      default:
        return undefined;
    }
  };

  return (
    <RadialDial
      x={x}
      y={y}
      dragging={dragging}
      step={{ ...step, aim: aimBack }}
      onChoose={onChoose}
      onBack={onBack}
      onCancel={onCancel}
      keysHint={t('start.dial.keys')}
      cancelLabel={t('start.dial.cancel')}
      testId="clock-dial"
    />
  );
}
