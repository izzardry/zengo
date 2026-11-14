/**
 * Engine-side helpers on `Position` (DESIGN 10.1): the game a position describes, legality as the
 * rules core sees it, and the komi the network is shown.
 *
 * Imports carry explicit `.ts` extensions so that plain Node (type stripping) can load the engine for
 * the self-play and calibration scripts.
 */
import type { Color, Game, Point, Position } from '../types.ts';
import { PASS, indexToPoint, isLegal, newGame, play, pointToIndex, resume } from '../zengo.ts';

/**
 * The game a position describes: its setup stones, then its plies (so ko and superko are exact).
 * A position whose plies do not replay falls back to its board and side to move.
 */
export function gameFromPosition(pos: Position): Game {
  const settings = { size: pos.size, rules: pos.rules, handicap: 0, komi2: pos.komi2 };
  try {
    const board = new Uint8Array(pos.size * pos.size);
    for (const p of pos.setup.B) board[pointToIndex(p, pos.size)] = 1;
    for (const p of pos.setup.W) board[pointToIndex(p, pos.size)] = 2;
    let g = newGame(settings, { board, turn: pos.first });
    for (const m of pos.moves) {
      if (g.scoring) g = resume(g);
      g = play(g, m, 0);
    }
    return g;
  } catch {
    return newGame(settings, { board: pos.board.slice(), turn: pos.turn });
  }
}

/** The position as a game that can be played on: out of scoring, so a third pass or a stone is allowed. */
export function playableGame(pos: Position): Game {
  const g = gameFromPosition(pos);
  return g.scoring && !g.end ? resume(g) : g;
}

/** True when the side to move may play `p` (`tt` = pass) by Zengo's rules (`ZengoApi.isLegal`). */
export function isLegalInPosition(pos: Position, p: Point, game: Game = playableGame(pos)): boolean {
  if (p === PASS) return !game.end;
  return isLegal(game, p);
}

/**
 * Handicap stones of a handicap game: Black's setup stones when White has none and White moves
 * first. 0 otherwise (even games and set-up positions).
 */
export function handicapOf(pos: Position): number {
  return pos.setup.W.length === 0 && pos.setup.B.length >= 2 && pos.first === 'W' ? pos.setup.B.length : 0;
}

/**
 * White's komi as the network sees it (DESIGN 8.2): the game's komi, plus one point per handicap
 * stone under area rules (Chinese compensation, which `scoring.result` adds to White's count).
 */
export function engineKomi(pos: Position): number {
  const h = handicapOf(pos);
  return pos.komi2 / 2 + (pos.rules === 'area' && h >= 2 ? h : 0);
}

/** Point of a board index, or `tt` for `index === size²`. */
export function pointOfIndex(index: number, size: number): Point {
  return index === size * size ? PASS : indexToPoint(index, size);
}

/** Opposite color. */
export function otherColor(c: Color): Color {
  return c === 'B' ? 'W' : 'B';
}
