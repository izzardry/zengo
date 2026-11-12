/**
 * What the game-over overlay says, from the device player's point of view (DESIGN 8.5). Pure.
 * Go has no draws (half-point komi), so every result has a winner.
 */
import type { TranslationKey } from '@/lib/i18n';
import type { Color, Mode, Result } from '@/lib/types';

/** Outcome for this device's player; pass-and-play has no single player and reports `local`. */
export type Outcome = 'win' | 'loss' | 'local';

/** Page tint behind the overlay: `success/12` for a win, `destructive/12` for a loss, none in pass-and-play. */
export type Tint = 'success' | 'destructive' | null;

/** Winning color. */
export function winner(result: Result): Color {
  return result.winner;
}

/** Outcome for the player of `myColor`. Pass-and-play reports `local`. */
export function outcomeFor(result: Result, mode: Mode, myColor: Color): Outcome {
  if (mode === 'local') return 'local';
  return result.winner === myColor ? 'win' : 'loss';
}

/** The page tint for an ending (none in pass-and-play). */
export function tintFor(result: Result, mode: Mode, myColor: Color): Tint {
  const o = outcomeFor(result, mode, myColor);
  return o === 'win' ? 'success' : o === 'loss' ? 'destructive' : null;
}

export interface EndTexts {
  /** Show the 🎉 glyph (a win, or any pass-and-play ending). */
  glyph: boolean;
  /** Title key; the overlay fills `{margin}` (localized half points) and `{level}`. */
  title: TranslationKey;
  /** The title needs the margin (a game decided by the count). */
  margin: boolean;
}

/**
 * Glyph and title of the overlay (DESIGN 8.5 table):
 * - win: `You won by 4.5!` / `You won by resignation!` / `You won on time!` / `Level 8 resigned. You won!`
 * - loss: `Lost by 4.5` / `Resigned` / `Out of time`
 * - pass-and-play: `Black wins by 4.5!` / `White wins by resignation!` / `Black wins on time!`
 */
export function endTexts(result: Result, mode: Mode, myColor: Color): EndTexts {
  const { winner: w, by } = result;
  const margin = by === 'score';

  if (mode === 'local') {
    const black = w === 'B';
    const title: TranslationKey =
      by === 'score'
        ? black
          ? 'game.title.blackWinsBy'
          : 'game.title.whiteWinsBy'
        : by === 'resign'
          ? black
            ? 'game.title.blackWinsResign'
            : 'game.title.whiteWinsResign'
          : black
            ? 'game.title.blackWinsTime'
            : 'game.title.whiteWinsTime';
    return { glyph: true, title, margin };
  }

  if (w === myColor) {
    const title: TranslationKey =
      by === 'score'
        ? 'game.title.wonBy'
        : by === 'resign'
          ? mode === 'computer'
            ? 'game.title.levelResigned'
            : 'game.title.wonResign'
          : 'game.title.wonTime';
    return { glyph: true, title, margin };
  }

  const title: TranslationKey = by === 'score' ? 'game.title.lostBy' : by === 'resign' ? 'game.title.resigned' : 'game.title.outOfTime';
  return { glyph: false, title, margin };
}

/**
 * Ztyle's page-tint classes for the stage root: `page-tint` (1000 ms background transition) plus
 * `completion-success` / `completion-failure`. Keep `page-tint` on the root at all times so the
 * tint fades in and out.
 */
export function tintClass(tint: Tint): string {
  return tint === 'success' ? 'page-tint completion-success' : tint === 'destructive' ? 'page-tint completion-failure' : 'page-tint';
}
