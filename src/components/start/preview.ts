/**
 * What the blurred start-screen board shows (DESIGN 4, 4.1): the starting position at the selected
 * size (empty, or with the selected handicap stones), or the position of the saved game the code
 * refers to. Pure, no React.
 *
 * The integrator hands the result to the board inside `BoardPreview` (`GoBoard`, not interactive),
 * so the board keeps one layout box from the start screen into the game; `PreviewBoard` draws the
 * same position as a static thumbnail where a full board is not wanted.
 */
import type { Game, Rules, SavedGame, Size } from '@/lib/types';
import { fromRecord, makeSettings, newGame } from '@/lib/zigo';

export interface PreviewSettings {
  readonly size: Size;
  readonly rules: Rules;
  readonly handicap: number;
}

/**
 * The preview position. A saved game is replayed leniently to its last ply (a damaged record
 * shows what can be read); without one, a new game of the selected settings.
 */
export function previewGame(settings: PreviewSettings, saved?: SavedGame | null): Game {
  if (saved) {
    try {
      return fromRecord(saved, { lenient: true });
    } catch {
      /* fall through to the empty board of the saved size */
      return newGame(makeSettings(saved.size, saved.rules, saved.handicap));
    }
  }
  return newGame(makeSettings(settings.size, settings.rules, settings.handicap));
}
