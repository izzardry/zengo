import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Color } from '@/lib/types';
import { cn } from '@/lib/utils';

/** How long a resignation can be taken back (DESIGN 8.3, Ztyle 09 undo toasts). */
export const RESIGN_UNDO_MS = 5000;
/** How long a pass can be taken back (DESIGN 6.2). */
export const PASS_UNDO_MS = 5000;

export interface UndoToastProps {
  /** The action just happened and can still be taken back. */
  open: boolean;
  /** What happened, e.g. `You passed`. */
  text: string;
  /** Undo: take the action back. */
  onUndo: () => void;
  /** The toast ran out or × was pressed: the action stays. Called once per opening. */
  onExpire?: () => void;
  durationMs?: number;
  /** For tests and styling hooks. */
  kind?: string;
  /**
   * Where it sits (Ztyle 05, 09). `start` (default): bottom center. In a game a toast never covers
   * the toolbar or the board: `game` sits above the portrait toolbar (full width on phones, bottom
   * right beside the board on wide screens), `rail` bottom right beside the board in mobile
   * landscape, as the system toasts do (`components/ui/toasterPlacement.ts`).
   */
  placement?: ToastPlacement;
}

export type ToastPlacement = 'start' | 'game' | 'rail';

const PLACEMENT: Record<ToastPlacement, string> = {
  start: 'left-1/2 -translate-x-1/2 bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))] w-[min(90vw,360px)]',
  // The toolbar's inset, its 58 px and a 0.5rem gap; beside the board from `sm` on.
  game: cn(
    'left-4 right-4 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+58px+0.5rem)]',
    'sm:left-auto sm:right-[max(1rem,env(safe-area-inset-right))]',
    'sm:w-[min(356px,calc((100vw-min(94vw,100dvh-14rem,768px))/2-1.5rem))] sm:min-w-[240px]',
  ),
  rail: cn(
    'right-[max(1rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))]',
    'w-[max(160px,min(356px,calc((100vw-clamp(272px,100dvh-3rem,608px))/2-0.75rem-max(1rem,env(safe-area-inset-right)))))]',
  ),
};

/**
 * An undo toast (Ztyle 09): text, `Undo`, and × to dismiss. Same recipe as Zudoku's
 * DeleteUndoToasts with the audit fix #12: × dismisses (settles) instead of doing nothing.
 */
export function UndoToast({ open, text, onUndo, onExpire, durationMs = RESIGN_UNDO_MS, kind, placement = 'start' }: UndoToastProps) {
  const { t } = useI18n();
  const cb = useRef({ onUndo, onExpire });
  cb.current = { onUndo, onExpire };
  /** Guards against a double settle (timer and click in the same tick). */
  const settled = useRef(false);

  useEffect(() => {
    if (!open) return;
    settled.current = false;
    const id = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      cb.current.onExpire?.();
    }, durationMs);
    return () => clearTimeout(id);
  }, [open, durationMs]);

  if (!open) return null;

  const settle = (fn: () => void) => () => {
    if (settled.current) return;
    settled.current = true;
    fn();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-toast={kind}
      data-placement={placement}
      className={cn('fixed z-[60]', PLACEMENT[placement])}
    >
      <div className="toast animate-in slide-in-from-bottom-3 fade-in zoom-in-95 [animation-duration:250ms] ease-out">
        <span className="text-sm truncate">{text}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={settle(() => cb.current.onUndo())} className="toast-action">
            {t('undo')}
          </button>
          <button
            type="button"
            onClick={settle(() => cb.current.onExpire?.())}
            aria-label={t('dismiss')}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ResignUndoToastProps {
  /** A resignation just happened and can still be taken back. */
  open: boolean;
  /** Who resigned: `you` against the computer, a color in pass-and-play. */
  who: 'you' | Color;
  /** Undo: take the resignation back (e.g. `zengo.reopen`). */
  onUndo: () => void;
  /** The toast ran out or × was pressed: the resignation is final. Called once per opening. */
  onExpire: () => void;
  durationMs?: number;
  placement?: ToastPlacement;
}

/**
 * Undo toast for a resignation in solo modes (DESIGN 8.3). In a room resignation is final, so
 * this toast is not used there.
 */
export function ResignUndoToast({ open, who, onUndo, onExpire, durationMs = RESIGN_UNDO_MS, placement }: ResignUndoToastProps) {
  const { t } = useI18n();
  const text = who === 'you' ? t('game.youResigned') : who === 'W' ? t('game.whiteResigned') : t('game.blackResigned');
  return <UndoToast open={open} text={text} onUndo={onUndo} onExpire={onExpire} durationMs={durationMs} kind="resign" placement={placement} />;
}

export interface PassUndoToastProps {
  /** A pass just happened and can still be taken back. */
  open: boolean;
  /** Who passed: `you` against the computer, a color in pass-and-play. */
  who: 'you' | Color;
  /** Undo: take the pass back. */
  onUndo: () => void;
  /** The toast ran out or × was pressed. Called once per opening. */
  onExpire?: () => void;
  durationMs?: number;
  placement?: ToastPlacement;
}

/**
 * `You passed · Undo` for 5 s against the computer and in pass-and-play (DESIGN 6.2). In a room a
 * pass is sent at once and only a takeback request undoes it, so this toast is not used there.
 */
export function PassUndoToast({ open, who, onUndo, onExpire, durationMs = PASS_UNDO_MS, placement }: PassUndoToastProps) {
  const { t } = useI18n();
  const text = who === 'you' ? t('game.youPassed') : who === 'W' ? t('game.whitePassed') : t('game.blackPassed');
  return <UndoToast open={open} text={text} onUndo={onUndo} onExpire={onExpire} durationMs={durationMs} kind="pass" placement={placement} />;
}
