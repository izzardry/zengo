import { useEffect, useRef } from 'react';
import { StoneGlyph } from '@/components/board';
import { useI18n } from '@/lib/i18n';
import type { Color, Point, Size } from '@/lib/types';
import { cn } from '@/lib/utils';
import { moveLabel, plyInfo } from './format';

export interface MoveListProps {
  /** Every recorded ply as an SGF point (`tt` = pass), including plies after the cursor (review, redo tail). */
  moves: readonly Point[];
  /** Board size, for GTP coordinates. */
  size: Size;
  /** Plies applied; the ply at `cursor - 1` is marked current. */
  cursor: number;
  /** Number of the first ply (1 unless the game started from a set-up position). */
  firstMoveNumber?: number;
  /** Color of the first ply: Black, or White in a handicap game. */
  firstColor?: Color;
  /**
   * Tap on a move: jump to the position after it. Receives the new cursor (`ply index + 1`; 0 for
   * the start position). Without it the list is read-only.
   */
  onJump?: (cursor: number) => void;
  className?: string;
}

/**
 * All moves, numbered per ply, with a stone of the mover's color and the GTP coordinate or `Pass`
 * (DESIGN 4.2, 12.3). Two columns, so the colors line up. Shown in the info pill's popover.
 */
export function MoveList({ moves, size, cursor, firstMoveNumber = 1, firstColor = 'B', onJump, className }: MoveListProps) {
  const { t } = useI18n();
  const currentRef = useRef<HTMLElement | null>(null);
  const current = Math.min(cursor, moves.length) - 1;
  const pass = t('game.passMove');

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const items = moves.map((m, ply) => {
    const { number, color } = plyInfo(ply, firstMoveNumber, firstColor);
    const label = moveLabel(m, size, pass);
    const isCurrent = ply === current;
    const future = ply >= cursor;
    const cls = cn(
      'flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm whitespace-nowrap',
      isCurrent && 'bg-foreground/10 font-semibold',
      future && 'text-foreground/50',
    );
    const content = (
      <>
        <span className="w-7 text-right text-xs text-muted-foreground tabular-nums">{number}</span>
        <StoneGlyph color={color} className="w-3 h-3 shrink-0" />
        <span>{label}</span>
      </>
    );
    const ref = isCurrent ? (el: HTMLElement | null) => void (currentRef.current = el) : undefined;
    return (
      <li key={ply} className="contents">
        {onJump ? (
          <button
            type="button"
            ref={ref}
            className={cn(cls, 'hover:bg-foreground/5 transition-colors duration-fast')}
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={t('game.goToMove', { n: number, side: color === 'B' ? t('black') : t('white'), move: label })}
            data-ply={ply}
            data-color={color}
            onClick={() => onJump(ply + 1)}
          >
            {content}
          </button>
        ) : (
          <span ref={ref} className={cls} aria-current={isCurrent ? 'step' : undefined} data-ply={ply} data-color={color}>
            {content}
          </span>
        )}
      </li>
    );
  });

  return (
    <div className={cn('font-mono', className)}>
      {onJump && (
        <button
          type="button"
          onClick={() => onJump(0)}
          aria-current={current < 0 ? 'step' : undefined}
          className={cn(
            'w-full mb-1 px-2 py-1 rounded-md text-left text-xs uppercase tracking-wider text-muted-foreground hover:bg-foreground/5',
            current < 0 && 'bg-foreground/10 text-foreground',
          )}
        >
          {t('game.startPosition')}
        </button>
      )}
      <ol aria-label={t('game.moves')} className="grid grid-cols-2 gap-x-1 gap-y-0.5 items-center">
        {items}
      </ol>
    </div>
  );
}
