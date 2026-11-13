/**
 * The scoring bar (DESIGN 8.4): replaces the toolbar while dead stones are marked. **Resume**
 * (ghost) returns to play, **Accept** (primary) agrees to the count as shown.
 *
 * In face-to-face pass-and-play each side accepts on its own: the near player uses this bar
 * (with `side` set), the far player a `ScoringAccept` passed as the far `PlayerStrip`'s `action`,
 * which the strip's rotation turns 180° (DESIGN 5.2). `note` carries a short state line (in a
 * room e.g. `Scoring continues when your opponent is back`; while the engine's proposal runs
 * `Finding dead stones…`) and `disabled` locks both buttons. From `sm` up in portrait the note sits
 * inside the bar's pill, so it never reaches the near strip's row. In a room `takeback` adds the
 * Undo button (a takeback request also works during scoring, DESIGN 9.4), left of Resume.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { BOTTOM_CHROME_VAR } from '@/components/ui/toasterPlacement';
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

/**
 * The compact Accept keeps its 32 px look in the far player's strip, but its hit area reaches the
 * 44 px of DESIGN 14.1 through an invisible layer 6 px beyond its border above and below (8 px
 * beyond the padding box, inside the 2 px border), so the strip and the board do not move.
 */
const COMPACT_HIT = "relative after:absolute after:-inset-x-0.5 after:-inset-y-2 after:content-['']";

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
        variant === 'compact' ? cn('px-3 py-1 text-xs min-h-8', COMPACT_HIT) : 'min-h-11 px-6 py-2',
        className,
      )}
    >
      {accepted && <Check className="w-4 h-4" aria-hidden="true" />}
      {accepted ? t('game.accepted') : t('accept')}
    </button>
  );
}

/** The room's takeback request inside the scoring bar (DESIGN 9.4: takeback also works during scoring). */
export interface ScoringTakeback {
  /** Ask the opponent for a takeback. */
  onClick: () => void;
  /** A takeback request is outstanding: the icon pulses and the button is disabled. */
  pending?: boolean;
  /** Nothing to take back, or no opponent to ask. */
  disabled?: boolean;
}

/** A request waits for the opponent (as in the toolbar): the icon pulses. */
const PENDING = 'animate-pulse motion-reduce:animate-none';

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
  /** Room: the Undo button (takeback request), left of Resume (above it in landscape). */
  takeback?: ScoringTakeback;
  /**
   * A short room note, e.g. `Scoring continues when your opponent is back`: above the bar on
   * phones, inside the bar left of the buttons from `sm` up, above the column in landscape.
   */
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
  takeback,
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

  // Portrait: toasts sit above this bar and its note, which is taller than the toolbar they
  // otherwise clear (`components/ui/toasterPlacement.ts`). Publish the measured height while the
  // bar is on screen; the landscape rail leaves the bottom free.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || landscape) return;
    const root = document.documentElement;
    const publish = () => {
      const h = node.getBoundingClientRect().height;
      if (h > 0) root.style.setProperty(BOTTOM_CHROME_VAR, `${Math.ceil(h)}px`);
      else root.style.removeProperty(BOTTOM_CHROME_VAR);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(BOTTOM_CHROME_VAR);
    };
  }, [landscape, hasNote]);
  // Portrait from `sm` up (desktop, tablets) the note sits inside the glass pill, left of the
  // buttons, so the bar keeps the toolbar's one row. Stacked above the bar it would land in the
  // near player strip's row (count left, clock right) wherever the board fills the height. Phones
  // (below `sm`) keep it above the bar: there the board is width-bound and leaves room below it.
  const row = !landscape;

  return (
    <div
      ref={ref}
      data-testid="scoring-bar"
      aria-hidden={visible ? undefined : true}
      className={cn(
        'fixed z-chrome flex items-center gap-2 transition-[opacity,transform] duration-chrome ease-out',
        landscape
          ? cn(
              'flex-col-reverse top-1/2 right-[max(1rem,env(safe-area-inset-right))]',
              // Centered (-50% of its height), but moved up while toasts show below it, so its bottom
              // stays above the height they publish (RAIL_TOASTS_VAR, components/ui/toasterPlacement.ts);
              // never above Help (RAIL_TOP: 1.5rem or the top inset, + 2.75rem + 0.5rem).
              'translate-y-[min(-50%,max(calc(max(1.5rem,env(safe-area-inset-top))_+_3.25rem_-_50dvh),calc(50dvh_-_100%_-_var(--zigo-rail-toasts,0px))))]',
            )
          : 'flex-col left-1/2 -translate-x-1/2 bottom-[max(1rem,env(safe-area-inset-bottom))] w-max max-w-[calc(100vw-1rem)]',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
        landscape ? (visible ? 'translate-x-0' : 'translate-x-4') : visible ? 'translate-y-0' : 'translate-y-4',
      )}
    >
      <div
        data-part="row"
        // Below `sm` (and in landscape) this wrapper is `contents`: note and buttons are items of
        // the column above. From `sm` up in portrait it is the glass pill holding both.
        className={cn(
          'contents',
          row && cn('sm:flex sm:items-center sm:gap-3 sm:rounded-full sm:p-1.5 sm:bg-card/80 sm:backdrop-blur-sm sm:border sm:border-border sm:shadow-lg', hasNote && 'sm:pl-4'),
        )}
      >
        {hasNote && (
          <p
            role="status"
            data-part="note"
            className={cn(
              'text-xs text-muted-foreground text-center',
              landscape ? 'max-w-[8rem]' : 'max-w-[20rem] sm:max-w-[16rem] sm:text-left',
            )}
          >
            {note}
          </p>
        )}
        <div
          role="group"
          aria-label={t('game.scoringBar')}
          // Landscape: a column of two equal-width buttons in a rounded card (a full pill around two
          // stacked buttons of different widths would cut through the wider one).
          className={cn(
            GLASS,
            'flex gap-2 p-1.5',
            landscape ? 'flex-col items-stretch rounded-3xl' : 'items-center rounded-full',
            // From `sm` up the row wrapper carries the glass; the group inside it is bare.
            row && 'sm:p-0 sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:shadow-none sm:rounded-none',
          )}
        >
          {takeback && (
            <button
              type="button"
              onClick={takeback.onClick}
              disabled={!!takeback.pending || !!takeback.disabled}
              aria-label={takeback.pending ? t('game.takebackPending') : t('game.askTakeback')}
              title={takeback.pending ? t('game.takebackPending') : t('game.askTakeback')}
              data-slot="undo"
              data-pending={takeback.pending ? 'true' : undefined}
              className="icon-button p-0 shrink-0 w-11 h-11 self-center touch-manipulation"
            >
              <Undo2 className={cn(takeback.pending && PENDING)} aria-hidden="true" />
            </button>
          )}
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
    </div>
  );
}
