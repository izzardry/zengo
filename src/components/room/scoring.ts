/**
 * Pure helpers of the scoring bar in a room (DESIGN 8.4, 9.3, 9.5): which buttons work, whether
 * the own Accept shows pending, and the one-line note above the bar.
 */
import type { RoomScoringView } from '@/hooks/useRoom';
import type { TranslationKey } from '@/lib/i18n';

export interface RoomScoringBarState {
  /** This seat accepted the current marking: Accept shows `Accepted` (pending until the opponent accepts). */
  readonly accepted: boolean;
  /** Both buttons locked: the opponent is away, the first proposal or the round-2 count is pending. */
  readonly disabled: boolean;
  /** Resume alone locked. */
  readonly resumeDisabled: boolean;
  /** The note above the bar, or null. */
  readonly note: TranslationKey | null;
}

/**
 * The scoring bar of a room for one scoring view.
 *
 * - The opponent away (DESIGN 9.3): both locked, `Scoring continues when your opponent is back`.
 *   Marks still work offline and sync through rev.
 * - No proposal yet (rev 0) in round 1: both locked, `Finding dead stones…`. Round 2 (scored at
 *   once by seat 0, no marking round): both locked, `Counting…`.
 * - Own Accept pressed: Accept shows `Accepted` and stays pressed (`aria-pressed`), with
 *   `Waiting for your opponent to accept` until the opponent accepts the same rev or anybody
 *   toggles (which clears both acceptances).
 * - The opponent accepted first: `Your opponent accepted this count`.
 */
export function roomScoringBar(s: RoomScoringView): RoomScoringBarState {
  if (s.paused) return { accepted: s.mine, disabled: true, resumeDisabled: true, note: 'game.scoringPaused' };
  if (s.round === 2) return { accepted: false, disabled: true, resumeDisabled: true, note: 'room.scoring.counting' };
  if (s.rev === 0) return { accepted: false, disabled: true, resumeDisabled: true, note: 'room.scoring.proposing' };
  const note: TranslationKey | null = s.mine && !s.theirs ? 'room.scoring.waiting' : s.theirs && !s.mine ? 'room.scoring.theyAccepted' : null;
  return {
    accepted: s.mine,
    // A pressed Accept stays at full strength (it is pending, not unavailable); its tap does nothing.
    disabled: !s.mine && !s.canAccept && !s.canResume,
    resumeDisabled: !s.canResume,
    note,
  };
}
