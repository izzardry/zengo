import type { ReactNode } from 'react';
import { StoneGlyph } from '@/components/board';
import { useI18n } from '@/lib/i18n';
import { formatHalf } from '@/lib/zigo';
import type { Color, Score } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatKomi, other, scoreLine, scoreTotals } from './format';

/** The strip's time slot. The parent formats the reading (`formatClock` / `formatElapsed`, byo-yomi in M2). */
export interface StripClock {
  /** Formatted reading, e.g. `4:31`, `9.7`, `0:24 ·3`; a string or a preformatted element. */
  text: ReactNode;
  /** Accessible reading when `text` is an element or abbreviated (e.g. `24 seconds, 3 periods`). */
  label?: string;
  /** This clock is counting down now: drawn on a light chip. */
  running?: boolean;
  /** Below 10 s: bold (the text carries the tenths, DESIGN 11). */
  low?: boolean;
  /** Ran out: `destructive` and bold. */
  flagged?: boolean;
  /** Clock off: the slot shows the time this side used, dimmed (DESIGN 4.2). */
  untimed?: boolean;
  /** Remaining (timed) or used (clock off) ms behind `text`; exposed as `data-ms` for tests. */
  ms?: number;
  /** A short word beside the time, e.g. `Paused` in a timed room while disconnected. */
  note?: string;
}

export interface PlayerStripProps {
  /** The player this strip belongs to. */
  color: Color;
  /** Stones this player has captured (of the other color): `game.prisoners[color]`. 0 shows nothing. */
  prisoners: number;
  /** Komi ×2 (`settings.komi2`). Shown faint on White's strip only (`+7.5`, `+0.5` with handicap). */
  komi2?: number;
  /** This player's last ply was a pass (until the next stone): the `passed` badge. */
  passed?: boolean;
  clock?: StripClock;
  /** The player to move: full opacity; otherwise 50 %. Ignored during scoring (both full). */
  active: boolean;
  /**
   * Scoring phase (DESIGN 8.4): the strip shows the running score line (`B 45 · W 40 + 7.5`,
   * territory `B 12 + 3 · W 10 + 1 + 6.5`) instead of prisoners, komi and badge.
   */
  score?: Score;
  /**
   * A control at the strip's end, e.g. the far player's Accept in face-to-face scoring
   * (`ScoringAccept`): drawn in place of the clock, and rotated with the strip.
   */
  action?: ReactNode;
  /** Face-to-face seating: the far player's strip is drawn upside down (DESIGN 5.2). */
  rotated?: boolean;
  /** False while the UI is hidden: prisoners, komi and badge fade out, the clock stays (DESIGN 4). */
  details?: boolean;
  /** `row` (default): a line along the board edge. `rail`: a compact column for the landscape rail. */
  layout?: 'row' | 'rail';
  className?: string;
}

/** The small uppercase eyebrow style of Ztyle, for the badge. */
const BADGE = 'text-[10px] leading-4 uppercase tracking-wider text-muted-foreground border border-foreground/20 rounded-full px-1.5';

/**
 * One player's strip at the board edge (DESIGN 4.2): prisoners as a stone of the captured color
 * and a count, komi on White's strip, the `passed` badge, and the clock. During scoring the
 * running score line replaces the details.
 */
export function PlayerStrip({
  color,
  prisoners,
  komi2,
  passed = false,
  clock,
  active,
  score,
  action,
  rotated = false,
  details = true,
  layout = 'row',
  className,
}: PlayerStripProps) {
  const { t } = useI18n();
  const side = color === 'W' ? t('white') : t('black');
  const rail = layout === 'rail';
  const scoring = !!score;

  const info = scoring ? (
    <span data-part="score" className={cn('font-mono text-xs tabular-nums whitespace-nowrap', rail && 'whitespace-normal text-center')}>
      <span aria-hidden="true">{scoreLine(score)}</span>
      <span className="sr-only">
        {t('game.count', { black: t('black'), white: t('white'), b: scoreTotals(score).B, w: scoreTotals(score).W })}
      </span>
    </span>
  ) : (
    <>
      {prisoners > 0 && (
        <span
          data-part="prisoners"
          role="img"
          aria-label={t('game.prisoners', { side, n: prisoners })}
          className="inline-flex items-center gap-1 font-mono text-sm tabular-nums"
        >
          <StoneGlyph color={other(color)} className="w-3.5 h-3.5" />
          <span aria-hidden="true">{prisoners}</span>
        </span>
      )}
      {color === 'W' && komi2 !== undefined && komi2 > 0 && (
        <span data-part="komi" className="font-mono text-xs tabular-nums text-muted-foreground/70">
          <span aria-hidden="true">{formatKomi(komi2)}</span>
          <span className="sr-only">{t('game.komi', { komi: formatHalf(komi2) })}</span>
        </span>
      )}
      {passed && (
        <span data-part="passed" className={BADGE}>
          {t('game.passed')}
        </span>
      )}
    </>
  );

  const detailsPart = (
    <div
      data-part="details"
      className={cn(
        'flex items-center gap-2 min-w-0 transition-opacity duration-chrome ease-out',
        rail && 'flex-col gap-1 justify-center max-w-[6rem]',
        details ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden={details ? undefined : true}
    >
      {info}
    </div>
  );

  const timer = clock && (
    <span
      role="timer"
      aria-label={clock.untimed ? t('game.timeUsed', { side }) : t('game.clock', { side })}
      data-part="clock"
      data-running={clock.running ? 'true' : undefined}
      data-low={clock.low ? 'true' : undefined}
      data-flagged={clock.flagged ? 'true' : undefined}
      data-ms={typeof clock.ms === 'number' ? Math.round(clock.ms) : undefined}
      className={cn(
        'font-mono text-sm tabular-nums tracking-wider px-2 py-0.5 rounded-md shrink-0 transition-colors duration-fast',
        clock.untimed && 'text-muted-foreground',
        clock.running && !clock.untimed && 'bg-foreground/10 text-foreground',
        clock.low && 'font-bold',
        clock.flagged && 'text-destructive font-bold',
      )}
    >
      {clock.label ? (
        <>
          <span aria-hidden="true">{clock.text}</span>
          <span className="sr-only">{clock.label}</span>
        </>
      ) : (
        clock.text
      )}
    </span>
  );
  const time =
    clock && clock.note ? (
      <span className={cn('flex items-center gap-1.5 shrink-0', rail && 'flex-col gap-0.5')}>
        <span data-part="note" className="text-[10px] leading-4 uppercase tracking-wider text-muted-foreground">
          {clock.note}
        </span>
        {timer}
      </span>
    ) : (
      timer
    );
  const end = action ? (
    <span data-part="action" className="shrink-0">
      {action}
    </span>
  ) : (
    time
  );

  return (
    <div
      data-color={color}
      data-active={active ? 'true' : 'false'}
      data-scoring={scoring ? 'true' : undefined}
      className={cn(
        'flex items-center select-none transition-opacity duration-chrome ease-out',
        rail ? 'flex-col gap-1.5 text-center' : 'w-full justify-between gap-2 min-h-7',
        active || scoring ? 'opacity-100' : 'opacity-50',
        rotated && 'rotate-180',
        className,
      )}
    >
      {rail ? (
        <>
          {end}
          {detailsPart}
        </>
      ) : (
        <>
          {detailsPart}
          {end}
        </>
      )}
    </div>
  );
}
