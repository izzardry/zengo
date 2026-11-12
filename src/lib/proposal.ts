/**
 * The engine's dead-stone proposal for the scoring phase (DESIGN 8.4 steps 1 and 5, 9.5).
 *
 * A short search (`PROPOSAL_VISITS`, about 100 visits, within `PROPOSAL_TIME_MS`) on the large net
 * when it is loaded, else the small net, gives an ownership map averaged over the search;
 * `scoring.propose` turns it into dead stones (ownership of 0.7 or more toward the opponent).
 * Without an answer (no engine, failed, offline without the networks, too slow) the proposal is
 * null: every stone alive.
 *
 * `createDeadStoneProposer(engine)` is `useGameState`'s `proposeDead` option (round 1: the initial
 * marking; round 2: the final count) and the room controller's injected `propose(game)`.
 *
 * The proposal is data: the players see it and accept it, and in a room it is sent with `mark` or
 * `end`. No result is ever computed from a device's own engine output alone (DESIGN 8.1).
 */
import scoring from './scoring';
import type { EngineApi, EngineNet, Game, Point } from './types';
import zigo from './zigo';

/** Visits of the proposal search (DESIGN 8.4: about 100). */
export const PROPOSAL_VISITS = 100;
/** The search stops after this long even before its visits are done. */
export const PROPOSAL_TIME_MS = 3000;
/** No answer within this long (loading included): every stone alive. */
export const PROPOSAL_TIMEOUT_MS = 20_000;

export interface ProposalOptions {
  /** Default `PROPOSAL_VISITS`. */
  visits?: number;
  /** Default `PROPOSAL_TIME_MS`. */
  timeMs?: number;
  /** Default `PROPOSAL_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** The net of the proposal: the large one when the engine has it loaded, else the small one. */
export function proposalNet(engine: Pick<EngineApi, 'nets'>): EngineNet {
  return engine.nets.large ? 'large' : 'small';
}

/**
 * Dead stones of `g` (a game in scoring, or any position) proposed by the engine, sorted; null when
 * the engine gives no answer (every stone alive). Never rejects.
 */
export async function proposeDeadStones(engine: EngineApi, g: Game, opts: ProposalOptions = {}): Promise<Point[] | null> {
  if (engine.state === 'failed') return null;
  try {
    const e = await engine.evaluate(
      zigo.position(g),
      { visits: opts.visits ?? PROPOSAL_VISITS, timeMs: opts.timeMs ?? PROPOSAL_TIME_MS, net: proposalNet(engine) },
      opts.timeoutMs ?? PROPOSAL_TIMEOUT_MS,
    );
    if (!e || e.ownership.length < g.board.length) return null;
    return scoring.propose(g, e.ownership);
  } catch {
    return null;
  }
}

/**
 * A `DeadStoneProposer` (`useGameState`'s `proposeDead`) on an engine. `getEngine` is read at call
 * time, so a hook can pass `() => engineRef.current` and keep the proposer stable.
 */
export function createDeadStoneProposer(
  getEngine: EngineApi | (() => EngineApi | null),
  opts: ProposalOptions = {},
): (game: Game) => Promise<Point[] | null> {
  return (game: Game) => {
    const engine = typeof getEngine === 'function' ? getEngine() : getEngine;
    return engine ? proposeDeadStones(engine, game, opts) : Promise.resolve(null);
  };
}
