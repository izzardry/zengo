import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Color } from '@/lib/types';

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
}

/**
 * An undo toast (Ztyle 09): text, `Undo`, and × to dismiss. Same recipe as Zudoku's
 * DeleteUndoToasts with the audit fix #12: × dismisses (settles) instead of doing nothing.
 */
export function UndoToast({ open, text, onUndo, onExpire, durationMs = RESIGN_UNDO_MS, kind }: UndoToastProps) {
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
      className="fixed left-1/2 -translate-x-1/2 z-[60] bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))] w-[min(90vw,360px)]"
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
  /** Undo: take the resignation back (e.g. `zigo.reopen`). */
  onUndo: () => void;
  /** The toast ran out or × was pressed: the resignation is final. Called once per opening. */
  onExpire: () => void;
  durationMs?: number;
}

/**
 * Undo toast for a resignation in solo modes (DESIGN 8.3). In a room resignation is final, so
 * this toast is not used there.
 */
export function ResignUndoToast({ open, who, onUndo, onExpire, durationMs = RESIGN_UNDO_MS }: ResignUndoToastProps) {
  const { t } = useI18n();
  const text = who === 'you' ? t('game.youResigned') : who === 'W' ? t('game.whiteResigned') : t('game.blackResigned');
  return <UndoToast open={open} text={text} onUndo={onUndo} onExpire={onExpire} durationMs={durationMs} kind="resign" />;
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
}

/**
 * `You passed · Undo` for 5 s against the computer and in pass-and-play (DESIGN 6.2). In a room a
 * pass is sent at once and only a takeback request undoes it, so this toast is not used there.
 */
export function PassUndoToast({ open, who, onUndo, onExpire, durationMs = PASS_UNDO_MS }: PassUndoToastProps) {
  const { t } = useI18n();
  const text = who === 'you' ? t('game.youPassed') : who === 'W' ? t('game.whitePassed') : t('game.blackPassed');
  return <UndoToast open={open} text={text} onUndo={onUndo} onExpire={onExpire} durationMs={durationMs} kind="pass" />;
}
