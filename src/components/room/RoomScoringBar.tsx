/**
 * The scoring bar in a room (DESIGN 8.4, 9.3, 9.5): 1C's `ScoringBar` with the room's state.
 * Accept is per seat: after pressing, it shows `Accepted` and the note says the device waits for the
 * opponent. While the opponent is away both buttons are locked and the note reads `Scoring
 * continues when your opponent is back`. See `roomScoringBar` for every state.
 */
import { ScoringBar } from '@/components/game/ScoringBar';
import type { RoomScoringView } from '@/hooks/useRoom';
import { useI18n } from '@/lib/i18n';
import { roomScoringBar } from './scoring';

export interface RoomScoringBarProps {
  /** `useRoom().scoring` (render the bar only while it is set). */
  scoring: RoomScoringView;
  /** `useRoom().accept`. Not called while this seat's Accept is already pressed. */
  onAccept: () => void;
  /** `useRoom().resume`. */
  onResume: () => void;
  /** Chrome shown. */
  visible?: boolean;
  /** Mobile landscape: a right rail. */
  landscape?: boolean;
}

export function RoomScoringBar({ scoring, onAccept, onResume, visible = true, landscape = false }: RoomScoringBarProps) {
  const { t } = useI18n();
  const bar = roomScoringBar(scoring);
  return (
    <ScoringBar
      onAccept={() => {
        if (!bar.accepted) onAccept();
      }}
      onResume={onResume}
      accepted={bar.accepted}
      disabled={bar.disabled}
      resumeDisabled={bar.resumeDisabled}
      note={bar.note ? t(bar.note) : undefined}
      visible={visible}
      landscape={landscape}
    />
  );
}
