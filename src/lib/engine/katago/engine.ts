/**
 * The engine core shared by the Web Worker and the Node runner: positions in, evaluations and moves
 * out (DESIGN 10.1, 10.2). Framework-free and host-free: the host supplies the networks (`getNet`),
 * a way to yield to its event loop, and a stop flag.
 *
 * Perspective: every `winrate` and `scoreLead` here is from the side to move in the given position
 * (`Position.turn`); `ownership` is +1 = Black, size² row-major from the top (what
 * `scoring.propose` expects); `policy` is size² + 1 (last = pass), 0 for illegal points, sums to 1.
 *
 * Level methods (the engine side of DESIGN 10.2, parameters from `lib/levels.ts`):
 * - `humanized` (level 1): small-net policy sampled at a high temperature (`temperature`, default
 *   2) among legal moves that do not fill the mover's own one-point eyes;
 * - `rank` (2–8): KaTrain's calibrated-rank pick at `rank` kyu on the level's net;
 * - `policy` (9): large-net policy at a low temperature (0.3 for the first tenth of the board's
 *   points in plies, then the top move);
 * - `search` (10–12): PUCT search; `visits` [min, max] scaled by board area (on 19×19 as listed),
 *   stopping at max visits, or after `timeMs` (default 2 s) once min visits are done; level 12 thinks
 *   `clockFraction` of its remaining clock when that is longer than `timeMs`. In timed games every
 *   search is capped by the clock (`clockCapMs`). Without a clock, no search runs past 10 s.
 * Every method passes when pass is its best move. The engine never resigns; that is the caller's
 * policy (DESIGN 10.4), using `winrate` and `scoreLead` of the result.
 *
 * Imports carry explicit `.ts` extensions so that plain Node can load this file.
 */
import { levelSpec } from '../../levels.ts';
import type {
  ClockInfo,
  EngineCandidate,
  EngineEvaluation,
  EngineGenmoveOptions,
  EngineNet,
  EngineSearchOptions,
  Point,
  Position,
} from '../../types.ts';
import { PASS, pointToIndex } from '../../zigo.ts';
import { engineKomi, isLegalInPosition, playableGame, pointOfIndex } from '../position.ts';
import { PASS_MOVE, playMove, setBoardSize, type SimPosition, type StoneColor } from './fastBoard.ts';
import { KATA_RULES, type RecentMove } from './features.ts';
import type { NetRunner } from './net.ts';
import { Search, hashKey, hashStones, type SearchCandidate, type SearchResult, type SearchRoot } from './search.ts';
import { ownEyes, rankPick, seededRng, temperaturePick } from './strategy.ts';

export type NetKind = EngineNet;
export type { EngineCandidate, EngineEvaluation };
export type SearchOptions = EngineSearchOptions;
export type GenmoveOptions = EngineGenmoveOptions;

export interface GenmoveInfo {
  /** Always legal by `ZigoApi.isLegal`, or `tt` (pass). */
  readonly move: Point;
  /** The position's win rate and score lead for the side to move (root of the search, or the raw network). */
  readonly winrate: number;
  readonly scoreLead: number;
  /**
   * Root moves best first: for search levels by play selection, else by policy. Lists every visited
   * move and every move with a policy of at least 0.1 %, at most 64.
   */
  readonly candidates: readonly EngineCandidate[];
  readonly visits: number;
  readonly net: NetKind;
  readonly method: 'humanized' | 'rank' | 'policy' | 'search';
}

/** How the host lets the engine pause and stop. */
export interface EngineControl {
  stopped(): boolean;
  yieldNow(): Promise<void>;
}

export interface KataEngineOptions {
  /** The network of a kind, loaded (and cached) by the host. */
  getNet(kind: NetKind): Promise<NetRunner>;
  /** Leaves evaluated per network call. Default 1. */
  batchSize?: () => number;
  now?: () => number;
}

/** Default think time of a visit-limited search level once its minimum visits are done. */
export const DEFAULT_SEARCH_MS = 2000;
/** No search runs longer than this without a clock. */
export const MAX_THINK_MS = 10_000;
/** `analyze` defaults: visits and time. */
export const ANALYZE_VISITS = 32;
export const ANALYZE_TIME_MS = 1500;
const MIN_CANDIDATE_PRIOR = 0.001;
const MAX_CANDIDATES = 64;

/** Visits on a `size` board for a count given for 19×19 (DESIGN 10.2: scaled by board area). */
export function scaledVisits(visits19: number, size: number): number {
  return Math.max(1, Math.round((visits19 * size * size) / 361));
}

/** The longest a search may think on this clock: a 20th of the main time plus half the increment (or 40 % of a period). */
export function clockCapMs(clock?: ClockInfo | null): number {
  if (!clock) return Infinity;
  const { tc, left } = clock;
  const main = Math.max(0, left.mainMs);
  if (tc.kind === 'fischer') return Math.max(100, Math.floor(main / 20 + Math.max(0, tc.incMs) / 2));
  const period = left.periods > 0 ? Math.max(0, left.periodMs || tc.periodMs) : 0;
  if (main > 0) return Math.max(100, Math.floor(main / 20 + period * 0.4));
  return Math.max(100, Math.floor(period * 0.4));
}

/** The clock time left to the engine, for level 12's fraction: main time, or the current period. */
function remainingMs(clock?: ClockInfo | null): number {
  if (!clock) return 0;
  return clock.left.mainMs > 0 ? clock.left.mainMs : clock.left.periods > 0 ? clock.left.periodMs : 0;
}

/** Replays a position onto fastBoard arrays (sets the board size). */
export function searchRoot(pos: Position): SearchRoot {
  const size = pos.size;
  setBoardSize(size);
  const area = size * size;
  const rules = KATA_RULES[pos.rules];
  const komi = engineKomi(pos);
  const turn: StoneColor = pos.turn === 'B' ? 1 : 2;
  try {
    const stones = new Uint8Array(area);
    for (const p of pos.setup.B) stones[pointToIndex(p, size)] = 1;
    for (const p of pos.setup.W) stones[pointToIndex(p, size)] = 2;
    const sim: SimPosition = { stones, koPoint: -1 };
    const history = new Set<number>([hashKey(...hashStones(stones, area))]);
    const boards: { stones: Uint8Array; ko: number }[] = [];
    const recent: RecentMove[] = [];
    const captures: number[] = [];
    let pla: StoneColor = pos.first === 'B' ? 1 : 2;
    for (const m of pos.moves) {
      const idx = m === PASS ? PASS_MOVE : pointToIndex(m, size);
      if (idx < 0) throw new Error(`bad move ${m}`);
      boards.push({ stones: sim.stones.slice(), ko: sim.koPoint });
      captures.length = 0;
      playMove(sim, idx, pla, captures, false);
      if (idx !== PASS_MOVE) history.add(hashKey(...hashStones(sim.stones, area)));
      recent.push({ move: idx, player: pla });
      pla = pla === 1 ? 2 : 1;
    }
    for (let i = 0; i < area; i++) if (sim.stones[i] !== pos.board[i]) throw new Error('board mismatch');
    const prev = boards[boards.length - 1] ?? { stones, ko: sim.koPoint };
    const prevPrev = boards[boards.length - 2] ?? prev;
    return {
      stones: sim.stones,
      koPoint: sim.koPoint,
      player: turn,
      recentMoves: recent,
      prevStones: prev.stones,
      prevKoPoint: prev.ko,
      prevPrevStones: prevPrev.stones,
      prevPrevKoPoint: prevPrev.ko,
      history,
      komi,
      rules,
    };
  } catch {
    const stones = new Uint8Array(area);
    for (let i = 0; i < area; i++) stones[i] = pos.board[i] === 1 || pos.board[i] === 2 ? pos.board[i] : 0;
    const ko = pos.ko ? pointToIndex(pos.ko, size) : -1;
    return {
      stones,
      koPoint: ko,
      player: turn,
      recentMoves: [],
      prevStones: stones,
      prevKoPoint: ko,
      prevPrevStones: stones,
      prevPrevKoPoint: ko,
      history: new Set([hashKey(...hashStones(stones, area))]),
      komi,
      rules,
    };
  }
}

function avoidMask(pos: Position, avoid: readonly Point[] | undefined): Uint8Array | null {
  if (!avoid || avoid.length === 0) return null;
  const area = pos.size * pos.size;
  const m = new Uint8Array(area);
  for (const p of avoid) {
    const i = pointToIndex(p, pos.size);
    if (i >= 0 && i < area) m[i] = 1;
  }
  return m;
}

function candidatesOf(pos: Position, res: SearchResult, root: SearchCandidate[] = [...res.candidates]): EngineCandidate[] {
  const area = pos.size * pos.size;
  return root
    .filter((c) => c.visits > 0 || c.prior >= MIN_CANDIDATE_PRIOR)
    .slice(0, MAX_CANDIDATES)
    .map((c) => {
      const move = pointOfIndex(c.move === PASS_MOVE ? area : c.move, pos.size);
      return c.winrate === undefined
        ? { move, prior: c.prior, visits: c.visits }
        : { move, prior: c.prior, visits: c.visits, winrate: c.winrate, scoreLead: c.scoreLead };
    });
}

export class KataEngine {
  private readonly getNet: (kind: NetKind) => Promise<NetRunner>;
  private readonly batchSize: () => number;
  private readonly now: () => number;

  constructor(opts: KataEngineOptions) {
    this.getNet = opts.getNet;
    this.batchSize = opts.batchSize ?? (() => 1);
    this.now = opts.now ?? (() => performance.now());
  }

  private async search(
    pos: Position,
    net: NetKind,
    ctl: EngineControl,
    l: { maxVisits: number; minVisits?: number; softTimeMs?: number; hardTimeMs?: number; avoid?: Uint8Array | null; rng?: () => number },
  ): Promise<SearchResult> {
    const runner = await this.getNet(net);
    const root = searchRoot(pos);
    const s = new Search(runner, root);
    return s.run({
      maxVisits: Math.max(1, l.maxVisits),
      minVisits: l.minVisits ?? 1,
      softTimeMs: l.softTimeMs ?? Infinity,
      hardTimeMs: l.hardTimeMs ?? Infinity,
      batchSize: l.maxVisits > 1 ? Math.max(1, this.batchSize()) : 1,
      stopped: () => ctl.stopped(),
      yieldNow: () => ctl.yieldNow(),
      rng: l.rng ?? Math.random,
      avoid: l.avoid ?? null,
      now: this.now,
    });
  }

  /** `EngineApi.evaluate`: one network evaluation by default, or a search of `visits` / `timeMs`. */
  async evaluate(pos: Position, opts: SearchOptions, ctl: EngineControl): Promise<EngineEvaluation> {
    const visits = opts.visits ?? (opts.timeMs ? 1_000_000 : 1);
    const res = await this.search(pos, opts.net ?? 'small', ctl, {
      maxVisits: visits,
      hardTimeMs: opts.timeMs ?? MAX_THINK_MS,
    });
    return { winrate: res.winrate, scoreLead: res.scoreLead, ownership: res.ownership, policy: res.policy };
  }

  /** `EngineApi.analyze`: the best `n` root moves of a short search (default 32 visits within 1.5 s, small net). */
  async analyze(pos: Position, n: number, opts: SearchOptions, ctl: EngineControl): Promise<EngineCandidate[]> {
    const res = await this.search(pos, opts.net ?? 'small', ctl, {
      maxVisits: opts.visits ?? ANALYZE_VISITS,
      hardTimeMs: opts.timeMs ?? ANALYZE_TIME_MS,
    });
    const game = playableGame(pos);
    const list = candidatesOf(pos, res).filter((c) => isLegalInPosition(pos, c.move, game));
    return list.slice(0, Math.max(0, n)).map((c) => ({
      ...c,
      winrate: c.winrate ?? res.winrate,
      scoreLead: c.scoreLead ?? res.scoreLead,
    }));
  }

  /** `EngineApi.genmove` with the level methods above. Always a legal move or `tt`. */
  async genmove(pos: Position, level: number, clock: ClockInfo | undefined, opts: GenmoveOptions, ctl: EngineControl): Promise<GenmoveInfo> {
    const spec = levelSpec(level);
    const rng = opts.seed !== undefined ? seededRng(opts.seed) : Math.random;
    const avoid = avoidMask(pos, opts.avoid);
    const area = pos.size * pos.size;
    const net: NetKind = spec.net;
    let res: SearchResult;
    let index: number;

    if (spec.method === 'search') {
      const [min19, max19] = spec.visits ?? [1, 1_000_000];
      const capped = spec.visits !== undefined;
      const minVisits = capped ? scaledVisits(min19, pos.size) : 1;
      const maxVisits = capped ? scaledVisits(max19, pos.size) : 1_000_000;
      let soft = spec.timeMs ?? DEFAULT_SEARCH_MS;
      if (spec.clockFraction && clock) soft = Math.max(soft, remainingMs(clock) * spec.clockFraction);
      const cap = clockCapMs(clock);
      const hard = Math.min(clock ? cap : MAX_THINK_MS, Math.max(soft, MAX_THINK_MS));
      res = await this.search(pos, net, ctl, {
        maxVisits,
        // With an explicit time budget the time rules; otherwise the minimum visits do.
        minVisits: spec.timeMs !== undefined ? 1 : minVisits,
        softTimeMs: Math.min(soft, hard),
        hardTimeMs: hard,
        avoid,
        rng,
      });
      const best = res.candidates.find((c) => c.move === PASS_MOVE || !avoid || !avoid[c.move]);
      index = best ? (best.move === PASS_MOVE ? area : best.move) : area;
    } else {
      res = await this.search(pos, net, ctl, { maxVisits: 1, rng });
      const policy = res.policy;
      if (spec.method === 'rank') {
        index = rankPick(policy, area, spec.rank ?? 12, rng, avoid);
      } else if (spec.method === 'policy') {
        const early = pos.moves.length < Math.round(area * 0.1);
        index = temperaturePick(policy, area, early ? 0.3 : 0, rng, avoid);
      } else {
        const root = searchRoot(pos);
        const exclude = ownEyes(root.stones, pos.size, root.player);
        if (avoid) for (let i = 0; i < area; i++) if (avoid[i]) exclude[i] = 1;
        const t = (spec as { temperature?: number }).temperature ?? 2;
        index = temperaturePick(policy, area, t, rng, exclude);
      }
    }

    const ordered: SearchCandidate[] =
      spec.method === 'search' ? [...res.candidates] : [...res.candidates].sort((a, b) => b.prior - a.prior);
    const candidates = candidatesOf(pos, res, ordered);
    const game = playableGame(pos);
    let move = pointOfIndex(index, pos.size);
    if (!isLegalInPosition(pos, move, game) || (move !== PASS && avoid && avoid[index])) {
      const alt = candidates.find((c) => c.move !== PASS && isLegalInPosition(pos, c.move, game) && !(avoid && avoid[pointToIndex(c.move, pos.size)]));
      move = alt ? alt.move : PASS;
    }
    return { move, winrate: res.winrate, scoreLead: res.scoreLead, candidates, visits: res.visits, net, method: spec.method };
  }
}
