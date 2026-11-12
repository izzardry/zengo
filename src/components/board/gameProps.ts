/**
 * The position props of `GoBoard` from a `Game` value, so a parent can write
 * `<GoBoard {...useGoBoardGame(game)} helpers … />`. Pure apart from the memo hook.
 */
import { useMemo } from 'react';
import { atari, illegalReason, lastMove } from '@/lib/zigo';
import type { Game, IllegalReason, Point } from '@/lib/types';
import type { GoBoardProps } from './types';

export type GoBoardGameProps = Pick<GoBoardProps, 'size' | 'board' | 'turn' | 'lastMove' | 'ko' | 'atari'> & {
  readonly illegalReason: (p: Point) => IllegalReason | null;
};

/** Size, board, turn, last move, ko point, the mover's groups in atari and the legality check. */
export function goBoardGameProps(game: Game): GoBoardGameProps {
  return {
    size: game.settings.size,
    board: game.board,
    turn: game.turn,
    lastMove: lastMove(game),
    ko: game.ko,
    atari: atari(game, game.turn),
    illegalReason: (p: Point) => illegalReason(game, p),
  };
}

/** `goBoardGameProps`, memoized on the game value (a new object per game, as every `ZigoApi` call returns). */
export function useGoBoardGame(game: Game): GoBoardGameProps {
  return useMemo(() => goBoardGameProps(game), [game]);
}
