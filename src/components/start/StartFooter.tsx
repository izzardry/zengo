/**
 * Bottom block of the start screen (DESIGN 4.1): opponent stepper, then the color, size and clock
 * pills, the computer's offline state, an optional extra (the install pill), and the bounce chevron.
 *
 * Portrait stacks them; mobile landscape puts them in one row and drops the chevron, as Zudoku
 * does, so the short viewport keeps the board clear. The pills row may wrap to two lines on a
 * 320 px phone; the footer is fixed, so the board's layout box never moves, and `BoardPreview`
 * shrinks the blurred preview to the space that is left (`previewFit`).
 */
import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useInert } from './useInert';

export interface StartFooterProps {
  visible: boolean;
  landscape?: boolean;
  /** The `OpponentSelector`. */
  selector: ReactNode;
  /** The `ColorPill`, `SizePill` and `ClockPill`. */
  pills?: ReactNode;
  /** Offline state of the computer (`EngineStatus`), under the pills. */
  status?: ReactNode;
  /** Low-priority offers under the pills (the install pill). */
  extra?: ReactNode;
  /** The `ScrollChevron`; not shown in landscape. */
  chevron?: ReactNode;
  className?: string;
}

export function StartFooter({ visible, landscape = false, selector, pills, status, extra, chevron, className }: StartFooterProps) {
  const ref = useRef<HTMLDivElement>(null);
  useInert(ref, !visible);
  return (
    <div
      ref={ref}
      data-testid="start-footer"
      data-start-edge="bottom"
      data-visible={visible}
      className={cn(
        'fixed inset-x-0 z-20 flex px-4 transition-all duration-500 ease-out',
        landscape
          ? 'bottom-[max(1rem,env(safe-area-inset-bottom))] flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2'
          : 'bottom-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))] flex-col items-center',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-8 opacity-0',
        className,
      )}
    >
      {selector}
      {pills && (
        <div className={cn('flex max-w-full flex-wrap items-center justify-center gap-2', !landscape && 'mt-3')} data-testid="start-pills">
          {pills}
        </div>
      )}
      {/* The status line's height is kept while it is empty (still checking the cache), so the pills
          never jump when it appears (a hold on a pill would slip off it). */}
      {status && <div className={cn(!landscape && 'mt-2 min-h-6')}>{status}</div>}
      {extra && <div className={cn(!landscape && 'mt-4')}>{extra}</div>}
      {chevron && !landscape && <div className="mt-6">{chevron}</div>}
    </div>
  );
}
