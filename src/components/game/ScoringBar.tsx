/**
 * The scoring bar (DESIGN 8.4): replaces the toolbar while dead stones are marked. **Resume**
 * (ghost) returns to play, **Accept** (primary) agrees to the count as shown.
 *
 * In face-to-face pass-and-play each side accepts on its own: the near player uses this bar
 * (with `side` set), the far player a `ScoringAccept` passed as the far `PlayerStrip`'s `action`,
 * which the strip's rotation turns 180° (DESIGN 5.2). In a room `note` carries the room's text
 * (e.g. `Scoring continues when your opponent is back`) and `disabled` locks both buttons.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Color } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Floating chrome surface (Ztyle 06), as the toolbar. */
const GLASS = 'bg-card/80 backdrop-blur-sm border border-border shadow-lg';

export interface ScoringAcceptProps {
  onAccept: () => void;
  /** This side has accepted the current marking: the button shows `Accepted` with a check. */
  accepted?: boolean;
  /** Face to face: the side this Accept belongs to; it names the side in the aria-label. */
  side?: Color;
  disabled?: boolean;
  /** `bar` (default): full size in the scoring bar. `compact`: small, for a player strip. */
  variant?: 'bar' | 'compact';
  className?: string;
}

/** One Accept button. Pressed state (`aria-pressed`) shows the side has accepted. */
export function ScoringAccept({ onAccept, accepted = false, side, disabled, variant = 'bar', className }: ScoringAcceptProps) {
  const { t } = useI18n();
  const sideName = side ? (side === 'B' ? t('black') : t('white')) : undefined;
  const label = sideName ? (accepted ? t('game.acceptedFor', { side: sideName }) : t('game.acceptFor', { side: sideName })) : undefined;
  return (
    <button
      type="button"
      onClick={onAccept}
      disabled={disabled}
      aria-pressed={accepted}
      aria-label={label}
      data-action="accept"
      data-side={side}
      data-accepted={accepted ? 'true' : 'false'}
      className={cn(
        'btn-primary disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'compact' ? 'px-3 py-1 text-xs min-h-8' : 'min-h-11 px-6 py-2',
        className,
      )}
    >
      {accepted && <Check className="w-4 h-4" aria-hidden="true" />}
      {accepted ? t('game.accepted') : t('accept')}
    </button>
  );
}

export interface ScoringBarProps {
  onResume: () => void;
  onAccept: () => void;
  /** The near side has accepted the current marking. */
  accepted?: boolean;
  /** Face to face: the near player's side, so each Accept is named. Omit with one Accept. */
  side?: Color;
  /** Both buttons locked (e.g. a room whose opponent is away). */
  disabled?: boolean;
  /** Resume alone locked. */
  resumeDisabled?: boolean;
  /** One line above the bar, e.g. the room's `Scoring continues when your opponent is back`. */
  note?: ReactNode;
  /** Chrome shown. */
  visible?: boolean;
  /** Mobile landscape: a right rail. */
  landscape?: boolean;
}

/** Resume (ghost) and Accept (primary), where the toolbar was (DESIGN 8.4). */
export function ScoringBar({
  onResume,
  onAccept,
  accepted = false,
  side,
  disabled = false,
  resumeDisabled = false,
  note,
  visible = true,
  landscape = false,
}: ScoringBarProps) {
  const { t } = useI18n();
  // Hidden chrome must not take focus (`inert`, set on the node).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = !visible;
  }, [visible]);

  const hasNote = note !== undefined && note !== null && note !== false;

  return (
    <div
      ref={ref}
      data-testid="scoring-bar"
      aria-hidden={visible ? undefined : true}
      className={cn(
        'fixed z-chrome flex items-center gap-2 transition-[opacity,transform] duration-chrome ease-out',
        landscape
          ? 'flex-col-reverse top-1/2 -translate-y-1/2 right-[max(1rem,env(safe-area-inset-right))]'
          : 'flex-col left-1/2 -translate-x-1/2 bottom-[max(1rem,env(safe-area-inset-bottom))] w-max max-w-[calc(100vw-1rem)]',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
        landscape ? (visible ? 'translate-x-0' : 'translate-x-4') : visible ? 'translate-y-0' : 'translate-y-4',
      )}
    >
      {hasNote && (
        <p
          role="status"
          data-part="note"
          className={cn('text-xs text-muted-foreground text-center', landscape ? 'max-w-[8rem]' : 'max-w-[20rem]')}
        >
          {note}
        </p>
      )}
      <div
        role="group"
        aria-label={t('game.scoringBar')}
        className={cn(GLASS, 'flex items-center gap-2 rounded-full p-1.5', landscape && 'flex-col')}
      >
        <button
          type="button"
          onClick={onResume}
          disabled={disabled || resumeDisabled}
          data-action="resume"
          className="btn-ghost min-h-11 px-5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('game.resumePlay')}
        </button>
        <ScoringAccept onAccept={onAccept} accepted={accepted} side={side} disabled={disabled} />
      </div>
    </div>
  );
}
