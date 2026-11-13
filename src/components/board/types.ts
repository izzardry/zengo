/**
 * Types of the board package (1A). Cross-package shapes live in `src/lib/types.ts`; these are
 * local to the board and re-exported from `components/board/index.ts`.
 */
import type { Color, IllegalReason, Point, Seating, Size } from '@/lib/types';

/** The scoring layer (DESIGN 8.4, 5.3): dead stones and the territory of the current marking. */
export interface BoardScoring {
  /** Dead stones (any order). Drawn at 40 % with a small ×. */
  readonly dead: readonly Point[];
  /**
   * Owner of each empty or dead point (`ScoringApi.territory`); `null` = seki or dame, unmarked.
   * Territory is drawn as small filled squares in the owner's ink on empty points.
   */
  readonly territory: Readonly<Record<Point, Color | null>>;
}

/** The territory preview while the hint bulb is held (DESIGN 7.3). */
export interface TerritoryPreview {
  /** size², row-major from the top, +1 = Black owns, −1 = White owns. */
  readonly ownership: Float32Array | readonly number[];
}

/** The hint of the bulb (DESIGN 7.3): the best point pulses, or the top three get numbers. */
export type BoardHint = { readonly best: Point } | { readonly top: readonly Point[] } | null;

export interface GoBoardProps {
  /** Board size; the board draws `size × size` intersections. */
  readonly size: Size;
  /** size², 0 empty, 1 black, 2 white, row-major from the top (`Game.board`). Never mutated. */
  readonly board: Uint8Array;
  /** Side to move: the color of the ghost and of a placed stone. */
  readonly turn: Color;
  /** Accept input at all. False for previews, review, game over, the opponent's turn. Default true. */
  readonly interactive?: boolean;
  /** Helpers bundle (DESIGN 7.1): last-move ring, atari, ko marker, coordinates, blunder pulse, the illegal ghost. */
  readonly helpers: boolean;
  /** The last ply's point (`zigo.lastMove`); `tt` or null draws no ring. */
  readonly lastMove?: Point | null;
  /** The simple-ko point the side to move may not retake (`Game.ko`). */
  readonly ko?: Point | null;
  /**
   * The mover's own groups with one liberty (`zigo.atari(game, game.turn)`). Each gets a ring; a
   * group pulses once, when it first appears in its color's list (not again while it stays in atari).
   */
  readonly atari?: readonly (readonly Point[])[];
  /**
   * Why the side to move may not play `p` (`zigo.illegalReason`), or null when legal. Without it
   * every empty point is legal and an occupied one is `occupied`.
   */
  readonly illegalReason?: (p: Point) => IllegalReason | null;
  /** A legal stone was placed (tap, click, confirmed ghost, keyboard or typed coordinate). */
  readonly onPlay?: (p: Point) => void;
  /**
   * A placement on an illegal point was refused (helpers on only; with helpers off the attempt is
   * ignored without comment, DESIGN 6.1). The parent toasts `ko` / `superko` once per game.
   */
  readonly onIllegal?: (p: Point, reason: IllegalReason) => void;
  /** `P` + Enter or `pass` + Enter typed (DESIGN 6.1). */
  readonly onPass?: () => void;
  /** `Z` pressed. When given, the board takes the key (and calls `preventDefault`). */
  readonly onUndo?: () => void;
  /** `Shift+Z` pressed. When given, the board takes the key (and calls `preventDefault`). */
  readonly onRedo?: () => void;
  /** The ghost stone moved, appeared (point) or went away (null): the info pill previews `D4?`. */
  readonly onGhostChange?: (p: Point | null) => void;
  /** The scoring layer (memoize it); while set, a tap or Enter on a stone calls `onToggleGroup` instead of playing. */
  readonly scoring?: BoardScoring | null;
  /** Toggle the group at `p` between alive and dead (scoring). */
  readonly onToggleGroup?: (p: Point) => void;
  /** Ownership map while the hint bulb is held, else null. */
  readonly territoryPreview?: TerritoryPreview | null;
  /**
   * The hint to show. A new object replays the pulse and moves keyboard focus to its first point,
   * so keep the object stable (memoized) between hints.
   */
  readonly hint?: BoardHint;
  /** Point where a bounced stone (blunder guard) pulses red once; shown only with helpers on. */
  readonly blunder?: Point | null;
  /** Bump to replay the blunder pulse on the same point. */
  readonly blunderKey?: number;
  /** Pass-and-play seating (DESIGN 5.2). `face` also draws coordinates on the far edges, upside down. */
  readonly seating?: Seating;
  /**
   * The player at the far edge in face-to-face seating: on that player's turn a dragging finger
   * lifts the ghost downwards (their "above"). Ignored for `side` seating.
   */
  readonly farColor?: Color | null;
  /** Listen for typed coordinates on the whole window, not only while the board has focus. Default: `interactive`. */
  readonly captureKeys?: boolean;
  /** Announce each new move in a polite live region (DESIGN 14.1). Default true. */
  readonly announce?: boolean;
  /** CSS length for `--board-size`. Default `BOARD_SIZE_PORTRAIT`; use `BOARD_SIZE_LANDSCAPE` on the rails. */
  readonly boardSize?: string;
  /** Extra classes on the outer wrapper (e.g. the blur of the start-screen preview). */
  readonly className?: string;
}
