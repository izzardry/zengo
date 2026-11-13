/**
 * The opponent's toggle, shown live (DESIGN 9.5: every toggle appears on both boards at once): a
 * short ring around each stone whose status the opponent's mark changed, once per change
 * (`RoomToggle.key`), and a polite screen-reader line (`Your opponent marked the group at D4 dead`).
 * The board itself already shows the new marking; this only draws the eye to what changed.
 *
 * It is an overlay, not part of the board: render it right after `GoBoard`, inside the element that
 * wraps exactly the board (Index's `relative` board wrapper). It covers that element (`absolute
 * inset-0`), steps in by the board frame's 4 px padding (`p-1`, as GoBoard draws its frame) and
 * draws in the board's own viewBox, so each ring sits on its intersection. `overflow: visible` and
 * no pointer events: the glow is never clipped and taps reach the board.
 * Reduced motion: a still ring for twice the pulse time (room.css).
 */
import { useEffect, useState } from 'react';
import { STONE_R, pointToCell, viewBox } from '@/components/board/geometry';
import type { RoomToggle } from '@/hooks/useRoom';
import { useI18n } from '@/lib/i18n';
import type { Size } from '@/lib/types';
import { cn } from '@/lib/utils';
import { gtp, isPoint } from '@/lib/zigo';
import './room.css';

export interface ToggleFlashProps {
  /** Board size of the room's game. */
  size: Size;
  /** `useRoom().lastToggle`. */
  toggle: RoomToggle | null;
  className?: string;
}

export function ToggleFlash({ size, toggle, className }: ToggleFlashProps) {
  const { t } = useI18n();
  const [said, setSaid] = useState('');
  const key = toggle?.key ?? 0;

  // One sentence per change: dead first, then alive (a change from a reconcile can hold both).
  useEffect(() => {
    if (!toggle) {
      setSaid('');
      return;
    }
    const parts: string[] = [];
    const firstDead = toggle.dead.find((p) => isPoint(p, size));
    const firstAlive = toggle.alive.find((p) => isPoint(p, size));
    if (firstDead) parts.push(t('room.scoring.toggledDead', { point: gtp(firstDead, size) }));
    if (firstAlive) parts.push(t('room.scoring.toggledAlive', { point: gtp(firstAlive, size) }));
    setSaid(parts.join('. '));
    // Only a new change speaks; a language switch does not repeat it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);

  const points = toggle ? toggle.points.filter((p) => isPoint(p, size)) : [];

  return (
    <div className={cn('pointer-events-none absolute inset-0 p-1', className)} data-testid="toggle-flash">
      <svg viewBox={viewBox(size)} className="h-full w-full overflow-visible" overflow="visible" aria-hidden focusable={false}>
        {/* A new key remounts the group, so the same stones flash again. */}
        <g key={key}>
          {points.map((p) => {
            const c = pointToCell(p, size);
            return c ? (
              <circle
                key={p}
                className="zigo-toggle-flash"
                cx={c.col}
                cy={c.row}
                r={STONE_R + 0.04}
                fill="none"
                style={{ stroke: 'hsl(var(--foreground) / .75)', strokeWidth: 2.5 }}
                vectorEffect="non-scaling-stroke"
                data-mark="toggle"
                data-point={p}
              />
            ) : null;
          })}
        </g>
      </svg>
      <div aria-live="polite" aria-atomic className="sr-only" data-testid="toggle-said">
        {said}
      </div>
    </div>
  );
}
