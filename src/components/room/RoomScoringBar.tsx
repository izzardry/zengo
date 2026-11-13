/**
 * The scoring bar in a room (DESIGN 8.4, 9.3, 9.5): 1C's `ScoringBar` with the room's state.
 * Accept is per seat: after pressing, it shows `Accepted` and the note says the device waits for the
 * opponent. While the opponent is away both buttons are locked and the note reads `Scoring
 * continues when your opponent is back`. See `roomScoringBar` for every state. The scoring bar takes
 * the toolbar's place, so it carries the takeback request too (DESIGN 9.4: also during scoring).
 */
import { ScoringBar, type ScoringTakeback } from '@/components/game/ScoringBar';
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
  /**
   * The Undo button: a takeback request (DESIGN 9.4). It is also disabled while the bar is locked
   * (the opponent away or the proposal under way), since a request needs the opponent.
   */
  takeback?: ScoringTakeback;
  /** Chrome shown. */
  visible?: boolean;
  /** Mobile landscape: a right rail. */
  landscape?: boolean;
}

export function RoomScoringBar({ scoring, onAccept, onResume, takeback, visible = true, landscape = false }: RoomScoringBarProps) {
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
      takeback={takeback && { ...takeback, disabled: !!takeback.disabled || bar.disabled }}
      note={bar.note ? t(bar.note) : undefined}
      visible={visible}
      landscape={landscape}
    />
  );
}
