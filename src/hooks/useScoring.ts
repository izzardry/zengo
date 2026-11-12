/**
 * The scoring phase as the board, the player strips and the scoring bar see it (DESIGN 8.4).
 *
 * Derived from the game value the board shows: whether it is in scoring, the round, the dead set,
 * the territory map, the count (`scoring.score`), the score line of each strip and the result that
 * Accept would give. The actions are passed in: `useGameState` passes its solo actions (toggle a
 * group, accept, resume), and a room (milestone 3) can pass its controller's `mark` / `accept` /
 * `resume` instead. Without an action the matching function returns false.
 *
 * The count of a position is computed once per game value and marking (memoized).
 */
import { useMemo } from 'react';
import scoringApi from '@/lib/scoring';
import type { Color, Game, Point, Result, Score } from '@/lib/types';
import { formatHalf } from '@/lib/zigo';

/** What the scoring bar and the board can do. Each returns whether it applied. */
export interface ScoringActions {
  /** Toggle the whole group at `p` between alive and dead. */
  toggle?(p: Point): boolean;
  /**
   * Accept the marking. Without `side`: the game ends at once (computer, side-by-side
   * pass-and-play). With `side`: that side's Accept (face-to-face pass-and-play); the game ends
   * when both have accepted.
   */
  accept?(side?: Color): boolean;
  /** Leave scoring and play on; the next scoring is round 2. */
  resume?(): boolean;
}

/** The terms of one side's count, as the score line shows them (DESIGN 8.4 step 3). */
export interface ScoreTerms {
  /** Area: stones + territory. Territory: territory. Whole points. */
  readonly points: number;
  /** Territory rules: prisoners (captures and dead stones). Absent under area rules. */
  readonly prisoners?: number;
  /** White only: komi, plus 1 per handicap stone under area rules. Half points ×2. */
  readonly komi2?: number;
  /** White only, area rules with a handicap: the compensation part of `komi2`, ×2. */
  readonly compensation2?: number;
  /** The side's total, half points ×2. */
  readonly total2: number;
  /** The terms as text: `45`, `40 + 7.5`, `12 + 3`, `10 + 1 + 6.5`. */
  readonly text: string;
}

export interface UseScoring {
  /** The shown position is a scoring position (live scoring, or a scored game's final position). */
  readonly active: boolean;
  /** Marking is open: live scoring, round 1, not over, not reviewing, with a toggle action. */
  readonly editable: boolean;
  /** 1 = marking round, 2 = after a resume (scored at once). Null when not active. */
  readonly round: 1 | 2 | null;
  /** Marking revision (0 = never marked). */
  readonly rev: number;
  /** Dead stones, sorted. Empty when not active. */
  readonly dead: readonly Point[];
  /** `dead` as a set, for the board's per-point lookups. */
  readonly deadSet: ReadonlySet<Point>;
  /** Which side has accepted the current `rev` (face-to-face pass-and-play). */
  readonly acceptedBy: Readonly<Record<Color, boolean>>;
  /** Owner of every empty or dead point (null = dame / seki). Null when not active. */
  readonly territory: Readonly<Record<Point, Color | null>> | null;
  /** The count of the current marking. Null when not active. */
  readonly score: Score | null;
  /** Each side's terms for its strip. Null when not active. */
  readonly terms: Readonly<Record<Color, ScoreTerms>> | null;
  /** The whole line: `B 45 · W 40 + 7.5`, `B 12 + 3 · W 10 + 1 + 6.5`. Empty when not active. */
  readonly line: string;
  /** What Accept gives now (or the stored result of a scored game). Null when not active. */
  readonly result: Result | null;
  /** A dead-stone proposal is being computed (the scoring bar may show a spinner). */
  readonly pending: boolean;
  toggle(p: Point): boolean;
  accept(side?: Color): boolean;
  resume(): boolean;
}

const NO_POINTS: readonly Point[] = Object.freeze([]);
const NO_SET: ReadonlySet<Point> = new Set<Point>();
const NOBODY: Readonly<Record<Color, boolean>> = Object.freeze({ B: false, W: false });

/** The score line terms of each side (DESIGN 8.4 step 3). */
export function scoreTerms(s: Score): Record<Color, ScoreTerms> {
  const side = (c: Color): ScoreTerms => {
    const x = s[c];
    const points = s.rules === 'area' ? x.stones + x.territory : x.territory;
    const parts = [String(points)];
    const out: { -readonly [K in keyof ScoreTerms]: ScoreTerms[K] } = { points, total2: s.total2[c], text: '' };
    if (s.rules === 'territory') {
      out.prisoners = x.prisoners;
      parts.push(String(x.prisoners));
    }
    if (c === 'W') {
      if (s.compensation2 > 0) {
        out.compensation2 = s.compensation2;
        parts.push(formatHalf(s.compensation2));
      }
      out.komi2 = s.komi2 + s.compensation2;
      parts.push(formatHalf(s.komi2));
    }
    out.text = parts.join(' + ');
    return out;
  };
  return { B: side('B'), W: side('W') };
}

/** `B 45 · W 40 + 7.5`. */
export function scoreLine(s: Score): string {
  const t = scoreTerms(s);
  return `B ${t.B.text} · W ${t.W.text}`;
}

/**
 * Scoring view of `game` (the position the board shows) with the given actions.
 * `opts.live` says the game is the live one (not a review position); `opts.pending` passes the
 * proposer's state through.
 */
export function useScoring(
  game: Game | null,
  actions: ScoringActions = {},
  opts: { live?: boolean; pending?: boolean } = {},
): UseScoring {
  const sc = game?.scoring;
  const dead = sc?.dead ?? NO_POINTS;
  const active = !!sc;
  const ended = !!game?.end;

  const derived = useMemo(() => {
    if (!game || !game.scoring) return null;
    const d = game.scoring.dead;
    const score = scoringApi.score(game, d);
    return {
      score,
      territory: scoringApi.territory(game, d),
      terms: scoreTerms(score),
      line: scoreLine(score),
      result: game.end && game.end.result.by === 'score' ? game.end.result : scoringApi.result(game, score),
    };
  }, [game]);

  const deadSet = useMemo(() => (dead.length ? new Set(dead) : NO_SET), [dead]);
  const live = opts.live ?? true;
  const { toggle: doToggle, accept: doAccept, resume: doResume } = actions;

  const rev = sc?.rev ?? 0;
  const acceptedBy = useMemo(
    () => (sc && rev > 0 ? { B: sc.accepted[0] === rev, W: sc.accepted[1] === rev } : NOBODY),
    [sc, rev],
  );

  const editable = active && !ended && live && sc?.round === 1 && !!doToggle;

  return {
    active,
    editable,
    round: sc ? sc.round : null,
    rev,
    dead,
    deadSet,
    acceptedBy,
    territory: derived?.territory ?? null,
    score: derived?.score ?? null,
    terms: derived?.terms ?? null,
    line: derived?.line ?? '',
    result: derived?.result ?? null,
    pending: !!opts.pending,
    toggle: (p: Point) => (editable && doToggle ? doToggle(p) : false),
    accept: (side?: Color) => (active && !ended && live && doAccept ? doAccept(side) : false),
    resume: () => (active && !ended && live && doResume ? doResume() : false),
  };
}

export default useScoring;
