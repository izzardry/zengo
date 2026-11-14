/**
 * PUCT tree search over a KataGo network, with KataGo's utility (win/loss plus score), parent
 * utility-stdev exploration scaling, first-play urgency reduction, virtual losses for batches, and
 * LCB-based final move selection; ownership averaged over the search.
 *
 * A compact port of Web KaTrain's `analyzeMcts.ts` (MIT, see ./LICENSE), which follows KataGo's
 * `cpp/search/*.cpp`. Zengo keeps the parts a game opponent needs and leaves out graph search,
 * subtree value bias, noise pruning, uncertainty weighting, human-SL exploration, regions of
 * interest and analysis-only reporting. Every visit has weight 1.
 *
 * Rules inside the search: captures, simple ko and positional superko (Zobrist hashes of every
 * board in the game and along the line), no suicide. Two consecutive passes end a line: that node is
 * judged by the network and never expanded (Zengo agrees dead stones after the game, so no
 * Tromp-Taylor count is forced on the search). At the root, KataGo's `conservativePass` input is
 * used, as in its GTP defaults.
 *
 * Values are stored from Black's perspective.
 */
import {
  BLACK,
  BOARD_AREA,
  EMPTY,
  NEIGHBOR_COUNTS,
  NEIGHBOR_LIST,
  NEIGHBOR_STARTS,
  PASS_MOVE,
  computeLadderFeaturesV7KataGoInto,
  computeLadderedStonesV7KataGoInto,
  computeLibertyMapInto,
  opponentOf,
  playMove,
  undoMove,
  type SimPosition,
  type StoneColor,
} from './fastBoard.ts';
import { GLOBAL_CHANNELS, SPATIAL_CHANNELS, fillInputs, historyFeatures, type KataRules, type RecentMove } from './features.ts';
import type { NetRunner, RawEval } from './net.ts';
import { expectedWhiteScoreValue, getSqrtBoardArea } from './scoreValue.ts';

/* ------------------------------------------------------------------------------------------------
 * Zobrist hashing (positional superko)
 * --------------------------------------------------------------------------------------------- */

const zobristTables = new Map<number, Int32Array>();

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Two 32-bit Zobrist halves per (point, color): index `(p * 2 + color − 1) * 2`. */
export function zobristTable(area: number): Int32Array {
  let t = zobristTables.get(area);
  if (t) return t;
  const next = mulberry32(0x5eed + area);
  t = new Int32Array(area * 4);
  for (let i = 0; i < t.length; i++) t[i] = next() | 0;
  zobristTables.set(area, t);
  return t;
}

/** A 53-bit key from the two hash halves. */
export function hashKey(h0: number, h1: number): number {
  return (h0 >>> 0) * 0x200000 + (h1 >>> 11);
}

export function hashStones(stones: Uint8Array, area: number): [number, number] {
  const z = zobristTable(area);
  let h0 = 0;
  let h1 = 0;
  for (let p = 0; p < area; p++) {
    const c = stones[p];
    if (c === EMPTY) continue;
    const k = (p * 2 + c - 1) * 2;
    h0 ^= z[k];
    h1 ^= z[k + 1];
  }
  return [h0, h1];
}

/* ------------------------------------------------------------------------------------------------
 * Root description
 * --------------------------------------------------------------------------------------------- */

/** The position to search, already replayed onto fastBoard arrays of the current board size. */
export interface SearchRoot {
  readonly stones: Uint8Array;
  readonly koPoint: number;
  readonly player: StoneColor;
  /** Every ply of the game, chronological. */
  readonly recentMoves: readonly RecentMove[];
  /** Boards one and two plies before the root (the root board when there is none), with their ko points. */
  readonly prevStones: Uint8Array;
  readonly prevKoPoint: number;
  readonly prevPrevStones: Uint8Array;
  readonly prevPrevKoPoint: number;
  /** Keys (`hashKey`) of every board position of the game so far, the root's included. */
  readonly history: ReadonlySet<number>;
  /** White's komi, handicap compensation included. */
  readonly komi: number;
  readonly rules: KataRules;
}

/* ------------------------------------------------------------------------------------------------
 * KataGo search constants (analysis and GTP defaults, as Web KaTrain uses them)
 * --------------------------------------------------------------------------------------------- */

const WIN_LOSS_UTILITY_FACTOR = 1.0;
const STATIC_SCORE_UTILITY_FACTOR = 0.1;
const DYNAMIC_SCORE_UTILITY_FACTOR = 0.3;
const DYNAMIC_SCORE_CENTER_ZERO_WEIGHT = 0.2;
const DYNAMIC_SCORE_CENTER_SCALE = 0.75;
const UTILITY_RADIUS = WIN_LOSS_UTILITY_FACTOR + STATIC_SCORE_UTILITY_FACTOR + DYNAMIC_SCORE_UTILITY_FACTOR;

const CPUCT_EXPLORATION = 1.0;
const CPUCT_EXPLORATION_LOG = 0.45;
const CPUCT_EXPLORATION_BASE = 500;
const CPUCT_UTILITY_STDEV_PRIOR = 0.4;
const CPUCT_UTILITY_STDEV_PRIOR_WEIGHT = 2.0;
const CPUCT_UTILITY_STDEV_SCALE = 0.85;
const FPU_REDUCTION_MAX = 0.2;
const ROOT_FPU_REDUCTION_MAX = 0.1;
const FPU_PARENT_WEIGHT_BY_VISITED_POLICY_POW = 2.0;
const TOTALCHILDWEIGHT_PUCT_OFFSET = 0.01;
const LCB_STDEVS = 5.0;
const MIN_VISIT_PROP_FOR_LCB = 0.15;
const MAX_DEPTH = 400;

function recentScoreCenterOf(expectedWhiteScore: number): number {
  let c = expectedWhiteScore * (1.0 - DYNAMIC_SCORE_CENTER_ZERO_WEIGHT);
  const cap = getSqrtBoardArea() * DYNAMIC_SCORE_CENTER_SCALE;
  if (c > expectedWhiteScore + cap) c = expectedWhiteScore + cap;
  if (c < expectedWhiteScore - cap) c = expectedWhiteScore - cap;
  return c;
}

/** KataGo's utility from Black's perspective: win/loss plus a static and a dynamic score term. */
export function blackUtility(ev: RawEval, recentScoreCenter: number): number {
  const sqrtBoardArea = getSqrtBoardArea();
  const blackLossProb = 1.0 - ev.blackWinProb - ev.blackNoResultProb;
  const whiteWinLoss = blackLossProb - ev.blackWinProb;
  const whiteScoreMean = -ev.blackScoreMean;
  const whiteScoreStdev = ev.blackScoreStdev;
  const staticValue = expectedWhiteScoreValue({ whiteScoreMean, whiteScoreStdev, center: 0, scale: 2, sqrtBoardArea });
  const dynamicValue = expectedWhiteScoreValue({
    whiteScoreMean,
    whiteScoreStdev,
    center: recentScoreCenter,
    scale: DYNAMIC_SCORE_CENTER_SCALE,
    sqrtBoardArea,
  });
  const whiteUtility =
    whiteWinLoss * WIN_LOSS_UTILITY_FACTOR + staticValue * STATIC_SCORE_UTILITY_FACTOR + dynamicValue * DYNAMIC_SCORE_UTILITY_FACTOR;
  return -whiteUtility;
}

/* ------------------------------------------------------------------------------------------------
 * Tree
 * --------------------------------------------------------------------------------------------- */

interface Edge {
  readonly move: number;
  readonly prior: number;
  child: Node | null;
}

class Node {
  readonly pla: StoneColor;
  edges: Edge[] | null = null;
  /** Legal moves found when the node was queued for evaluation (pass last). */
  pendingMoves: number[] | null = null;
  terminal = false;
  evaluated = false;
  inFlight = 0;
  nnUtility = 0;
  nn: RawEval | null = null;

  visits = 0;
  utilitySum = 0;
  utilitySqSum = 0;
  winLossSum = 0;
  scoreMeanSum = 0;
  leadSum = 0;

  constructor(pla: StoneColor) {
    this.pla = pla;
  }

  get utilityAvg(): number {
    return this.visits > 0 ? this.utilitySum / this.visits : 0;
  }

  get utilitySqAvg(): number {
    return this.visits > 0 ? this.utilitySqSum / this.visits : 0;
  }
}

/** What one search reports. Values are from the perspective of the side to move at the root. */
export interface SearchCandidate {
  /** Point index or `PASS_MOVE`. */
  readonly move: number;
  readonly prior: number;
  readonly visits: number;
  /** Absent for a move the search never visited. */
  readonly winrate?: number;
  readonly scoreLead?: number;
  /** KataGo's play selection value (LCB-adjusted visits); higher plays first. */
  readonly selection: number;
}

export interface SearchResult {
  readonly visits: number;
  readonly winrate: number;
  readonly scoreLead: number;
  /** size², +1 = Black, averaged over every evaluation of the search. */
  readonly ownership: Float32Array;
  /** size² + 1, the root's network policy over legal moves (0 for illegal points), sums to 1. */
  readonly policy: Float32Array;
  /** Root moves, best first (visited by play selection value, then the rest by prior). */
  readonly candidates: readonly SearchCandidate[];
  /** The root's raw network evaluation. */
  readonly raw: RawEval;
}

export interface SearchLimits {
  /** Stop after this many visits (the root's own evaluation counts as one). */
  readonly maxVisits: number;
  /** Stop after this long once `minVisits` is reached. */
  readonly softTimeMs: number;
  readonly minVisits: number;
  /** Stop after this long whatever the visits. */
  readonly hardTimeMs: number;
  readonly batchSize: number;
  /** Polled between batches; true ends the search with what it has. */
  readonly stopped: () => boolean;
  /** Gives the host's event loop a turn (so a stop message can arrive). */
  readonly yieldNow: () => Promise<void>;
  readonly rng: () => number;
  /** Root moves the search must not consider (1 = avoid); pass is never avoided. */
  readonly avoid?: Uint8Array | null;
  /** Leaf symmetries are random; the root uses symmetry 0. Default true. */
  readonly randomSymmetries?: boolean;
  readonly now?: () => number;
}

/* ------------------------------------------------------------------------------------------------
 * Search
 * --------------------------------------------------------------------------------------------- */

interface Pending {
  readonly path: Node[];
  readonly leaf: Node;
}

export class Search {
  private readonly net: NetRunner;
  private readonly root: SearchRoot;
  private readonly size: number;
  private readonly area: number;
  private readonly z: Int32Array;

  // Working position (mutated during a descent, restored afterwards).
  private readonly pos: SimPosition;
  private readonly captureStack: number[] = [];
  private hash0: number;
  private hash1: number;
  private readonly seen = new Set<number>();
  private readonly moves: RecentMove[];
  /** Boards along the descent, for the history ladder planes: [board, koPoint] per ply. */
  private readonly boardStack: { stones: Uint8Array; ko: number }[] = [];

  // Scratch
  private readonly libs: Uint8Array;
  private readonly ladder0: Uint8Array;
  private readonly ladderMoves: Uint8Array;
  private readonly ladder1: Uint8Array;
  private readonly ladder2: Uint8Array;
  private readonly areaScratch: Uint8Array;
  private readonly bans: Uint8Array;
  private spatial = new Float32Array(0);
  private global = new Float32Array(0);

  private readonly rootNode: Node;
  private recentScoreCenter = 0;
  private readonly ownershipSum: Float64Array;
  private ownershipCount = 0;

  constructor(net: NetRunner, root: SearchRoot) {
    this.net = net;
    this.root = root;
    this.area = BOARD_AREA;
    this.size = Math.round(Math.sqrt(BOARD_AREA));
    this.z = zobristTable(this.area);
    this.pos = { stones: root.stones.slice(), koPoint: root.koPoint };
    [this.hash0, this.hash1] = hashStones(this.pos.stones, this.area);
    for (const k of root.history) this.seen.add(k);
    this.seen.add(hashKey(this.hash0, this.hash1));
    this.moves = root.recentMoves.slice(-8);
    this.libs = new Uint8Array(this.area);
    this.ladder0 = new Uint8Array(this.area);
    this.ladderMoves = new Uint8Array(this.area);
    this.ladder1 = new Uint8Array(this.area);
    this.ladder2 = new Uint8Array(this.area);
    this.areaScratch = new Uint8Array(this.area);
    this.bans = new Uint8Array(this.area);
    this.ownershipSum = new Float64Array(this.area);
    this.rootNode = new Node(root.player);
  }

  /* ------------------------------------------------------------- moves and legality */

  private applyMove(move: number, pla: StoneColor): { undo: ReturnType<typeof playMove>; added: number | null } {
    this.boardStack.push({ stones: this.pos.stones.slice(), ko: this.pos.koPoint });
    const undo = playMove(this.pos, move, pla, this.captureStack, false);
    let added: number | null = null;
    if (move !== PASS_MOVE) {
      const z = this.z;
      let k = (move * 2 + pla - 1) * 2;
      this.hash0 ^= z[k];
      this.hash1 ^= z[k + 1];
      const opp = opponentOf(pla);
      for (let i = undo.captureStart; i < this.captureStack.length; i++) {
        k = (this.captureStack[i] * 2 + opp - 1) * 2;
        this.hash0 ^= z[k];
        this.hash1 ^= z[k + 1];
      }
      const key = hashKey(this.hash0, this.hash1);
      if (!this.seen.has(key)) {
        this.seen.add(key);
        added = key;
      }
    }
    this.moves.push({ move, player: pla });
    return { undo, added };
  }

  private revertMove(move: number, pla: StoneColor, step: { undo: ReturnType<typeof playMove>; added: number | null }): void {
    this.moves.pop();
    if (step.added !== null) this.seen.delete(step.added);
    if (move !== PASS_MOVE) {
      const z = this.z;
      let k = (move * 2 + pla - 1) * 2;
      this.hash0 ^= z[k];
      this.hash1 ^= z[k + 1];
      const opp = opponentOf(pla);
      for (let i = step.undo.captureStart; i < this.captureStack.length; i++) {
        k = (this.captureStack[i] * 2 + opp - 1) * 2;
        this.hash0 ^= z[k];
        this.hash1 ^= z[k + 1];
      }
    }
    undoMove(this.pos, move, pla, step.undo, this.captureStack);
    this.boardStack.pop();
  }

  /**
   * Legal moves of `pla` at the working position (pass last), using the liberty map in `this.libs`.
   * Fills `this.bans` with the points that only positional superko forbids.
   */
  private legalMoves(pla: StoneColor): number[] {
    const stones = this.pos.stones;
    const libs = this.libs;
    const opp = opponentOf(pla);
    const out: number[] = [];
    this.bans.fill(0);
    const z = this.z;
    for (let p = 0; p < this.area; p++) {
      if (stones[p] !== EMPTY || p === this.pos.koPoint) continue;
      const s = NEIGHBOR_STARTS[p];
      const n = NEIGHBOR_COUNTS[p];
      let hasLiberty = false;
      let captures = false;
      for (let i = 0; i < n; i++) {
        const q = NEIGHBOR_LIST[s + i];
        const c = stones[q];
        if (c === EMPTY) hasLiberty = true;
        else if (c === opp) {
          if (libs[q] === 1) captures = true;
        } else if (libs[q] >= 2) hasLiberty = true;
      }
      if (!hasLiberty && !captures) continue; // suicide
      // Positional superko: the board after the move must be new.
      let banned: boolean;
      if (!captures) {
        const k = (p * 2 + pla - 1) * 2;
        banned = this.seen.has(hashKey(this.hash0 ^ z[k], this.hash1 ^ z[k + 1]));
      } else {
        const step = this.applyMove(p, pla);
        banned = step.added === null;
        this.revertMove(p, pla, step);
      }
      if (banned) {
        this.bans[p] = 1;
        continue;
      }
      out.push(p);
    }
    out.push(PASS_MOVE);
    return out;
  }

  /* ------------------------------------------------------------- inputs */

  private fillRow(row: number, pla: StoneColor, isRoot: boolean): void {
    const area = this.area;
    const rowS = area * SPATIAL_CHANNELS;
    if (this.spatial.length < (row + 1) * rowS) {
      const s = new Float32Array((row + 1) * rowS * 2);
      s.set(this.spatial);
      this.spatial = s;
      const g = new Float32Array((row + 1) * GLOBAL_CHANNELS * 2);
      g.set(this.global);
      this.global = g;
    }
    const stones = this.pos.stones;
    const history = historyFeatures({
      recentMoves: this.moves,
      player: pla,
      rules: this.root.rules,
      conservativePassAndIsRoot: isRoot,
    });
    const prev = this.boardAt(1);
    const prevPrev = this.boardAt(2);
    const prevLadderBoard = history.turnsIncluded < 1 ? { stones, ko: this.pos.koPoint } : prev;
    const prevPrevLadderBoard = history.turnsIncluded < 2 ? prevLadderBoard : prevPrev;
    computeLadderFeaturesV7KataGoInto({
      stones,
      koPoint: this.pos.koPoint,
      currentPlayer: pla,
      outLadderedStones: this.ladder0,
      outLadderWorkingMoves: this.ladderMoves,
    });
    computeLadderedStonesV7KataGoInto({ stones: prevLadderBoard.stones, koPoint: prevLadderBoard.ko, outLadderedStones: this.ladder1 });
    computeLadderedStonesV7KataGoInto({ stones: prevPrevLadderBoard.stones, koPoint: prevPrevLadderBoard.ko, outLadderedStones: this.ladder2 });
    fillInputs(
      {
        stones,
        koPoint: this.pos.koPoint,
        superkoBanned: this.bans,
        player: pla,
        recentMoves: this.moves,
        komi: this.root.komi,
        rules: this.root.rules,
        conservativePassAndIsRoot: isRoot,
        libertyMap: this.libs,
        ladderedStones: this.ladder0,
        prevLadderedStones: this.ladder1,
        prevPrevLadderedStones: this.ladder2,
        ladderWorkingMoves: this.ladderMoves,
        areaScratch: this.areaScratch,
        history,
      },
      this.spatial.subarray(row * rowS, (row + 1) * rowS),
      this.global.subarray(row * GLOBAL_CHANNELS, (row + 1) * GLOBAL_CHANNELS),
    );
  }

  /** The board `back` plies before the working position (root history beyond the descent). */
  private boardAt(back: number): { stones: Uint8Array; ko: number } {
    const n = this.boardStack.length;
    if (back <= n) return this.boardStack[n - back];
    const extra = back - n;
    if (extra === 1) return { stones: this.root.prevStones, ko: this.root.prevKoPoint };
    return { stones: this.root.prevPrevStones, ko: this.root.prevPrevKoPoint };
  }

  /* ------------------------------------------------------------- statistics */

  private setEval(node: Node, ev: RawEval): void {
    node.nn = ev;
    node.evaluated = true;
    node.nnUtility = blackUtility(ev, this.recentScoreCenter);
    if (node.terminal || !node.pendingMoves) return;
    // Priors: softmax of the policy logits over the legal moves.
    const moves = node.pendingMoves;
    node.pendingMoves = null;
    let maxLogit = -Infinity;
    for (const m of moves) maxLogit = Math.max(maxLogit, ev.policyLogits[m]);
    let sum = 0;
    const w = moves.map((m) => {
      const v = Math.exp(ev.policyLogits[m] - maxLogit);
      sum += v;
      return v;
    });
    const edges: Edge[] = moves.map((m, i) => ({ move: m, prior: w[i] / sum, child: null }));
    edges.sort((a, b) => b.prior - a.prior);
    node.edges = edges;
  }

  private backup(path: readonly Node[], ev: RawEval): void {
    const u = blackUtility(ev, this.recentScoreCenter);
    const wl = ev.blackWinProb - (1 - ev.blackWinProb - ev.blackNoResultProb);
    for (const n of path) {
      n.visits++;
      n.utilitySum += u;
      n.utilitySqSum += u * u;
      n.winLossSum += wl;
      n.scoreMeanSum += ev.blackScoreMean;
      n.leadSum += ev.blackScoreLead;
    }
    const own = ev.ownership;
    for (let p = 0; p < this.area; p++) this.ownershipSum[p] += own[p];
    this.ownershipCount++;
  }

  /* ------------------------------------------------------------- selection */

  private selectEdge(node: Node, isRoot: boolean, avoid: Uint8Array | null): Edge | null {
    const edges = node.edges;
    if (!edges || edges.length === 0) return null;
    const pla = node.pla;
    const sign = pla === BLACK ? 1 : -1;

    let totalChildWeight = 0;
    let policyProbMassVisited = 0;
    for (const e of edges) {
      const c = e.child;
      if (!c) continue;
      const w = c.visits + c.inFlight;
      if (w <= 0) continue;
      totalChildWeight += w;
      policyProbMassVisited += e.prior;
    }

    const visits = node.visits;
    const parentUtility = node.utilityAvg;
    let parentUtilityStdev: number;
    if (visits <= 1) {
      parentUtilityStdev = CPUCT_UTILITY_STDEV_PRIOR;
    } else {
      const utilitySq = parentUtility * parentUtility;
      const utilitySqAvg = Math.max(node.utilitySqAvg, utilitySq);
      const prior = CPUCT_UTILITY_STDEV_PRIOR * CPUCT_UTILITY_STDEV_PRIOR;
      parentUtilityStdev = Math.sqrt(
        Math.max(
          0,
          ((utilitySq + prior) * CPUCT_UTILITY_STDEV_PRIOR_WEIGHT + utilitySqAvg * visits) /
            (CPUCT_UTILITY_STDEV_PRIOR_WEIGHT + visits - 1.0) -
            utilitySq,
        ),
      );
    }
    const stdevFactor = 1.0 + CPUCT_UTILITY_STDEV_SCALE * (parentUtilityStdev / CPUCT_UTILITY_STDEV_PRIOR - 1.0);
    const cpuct = CPUCT_EXPLORATION + CPUCT_EXPLORATION_LOG * Math.log((totalChildWeight + CPUCT_EXPLORATION_BASE) / CPUCT_EXPLORATION_BASE);
    const scaling = cpuct * Math.sqrt(totalChildWeight + TOTALCHILDWEIGHT_PUCT_OFFSET) * stdevFactor;

    const avgWeight = Math.min(1.0, Math.pow(policyProbMassVisited, FPU_PARENT_WEIGHT_BY_VISITED_POLICY_POW));
    const parentForFpu = avgWeight * parentUtility + (1.0 - avgWeight) * node.nnUtility;
    const reduction = (isRoot ? ROOT_FPU_REDUCTION_MAX : FPU_REDUCTION_MAX) * Math.sqrt(Math.max(0, policyProbMassVisited));
    const fpuValue = pla === BLACK ? parentForFpu - reduction : parentForFpu + reduction;

    let best: Edge | null = null;
    let bestScore = -Infinity;
    for (const e of edges) {
      if (isRoot && avoid && e.move !== PASS_MOVE && avoid[e.move]) continue;
      const c = e.child;
      const hasStats = c !== null && c.visits > 0;
      let childWeight = hasStats ? c!.visits : 0;
      let childUtility = hasStats ? c!.utilityAvg : fpuValue;
      const vl = c ? c.inFlight : 0;
      if (vl > 0) {
        const lossUtility = pla === BLACK ? -UTILITY_RADIUS : UTILITY_RADIUS;
        const frac = vl / (vl + Math.max(0.25, childWeight));
        childUtility = childUtility + (lossUtility - childUtility) * frac;
        childWeight += vl;
      }
      const score = (scaling * e.prior) / (1.0 + childWeight) + sign * childUtility;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------- playouts */

  /**
   * Descends from the root to a leaf, applying moves on the working position. A new leaf is queued
   * for evaluation (its row filled into the batch); a terminal or already evaluated leaf is backed
   * up at once. Returns null when the descent hit a leaf already in flight.
   */
  private descend(row: number, rows: { players: StoneColor[]; syms: number[] }, avoid: Uint8Array | null, rng: () => number, randomSyms: boolean): Pending | 'done' | null {
    const path: Node[] = [this.rootNode];
    const steps: { move: number; pla: StoneColor; step: ReturnType<Search['applyMove']> }[] = [];
    let node = this.rootNode;
    let consecutivePasses = 0;
    {
      const m = this.moves;
      for (let i = m.length - 1; i >= 0 && m[i].move === PASS_MOVE; i--) consecutivePasses++;
    }
    let result: Pending | 'done' | null = null;
    try {
      for (let depth = 0; depth < MAX_DEPTH; depth++) {
        if (!node.evaluated || node.terminal) break;
        const e = this.selectEdge(node, depth === 0, avoid);
        if (!e) break;
        const pla = node.pla;
        const step = this.applyMove(e.move, pla);
        steps.push({ move: e.move, pla, step });
        consecutivePasses = e.move === PASS_MOVE ? consecutivePasses + 1 : 0;
        if (!e.child) {
          e.child = new Node(opponentOf(pla));
          if (consecutivePasses >= 2) e.child.terminal = true;
        }
        node = e.child;
        path.push(node);
        if (node.inFlight > 0 && !node.evaluated) return null;
      }

      if (node.evaluated) {
        // Terminal (or depth limit): reuse the node's own evaluation.
        this.backup(path, node.nn!);
        result = 'done';
      } else {
        computeLibertyMapInto(this.pos.stones, this.libs);
        if (!node.terminal) node.pendingMoves = this.legalMoves(node.pla);
        else this.legalMoves(node.pla);
        const isRoot = node === this.rootNode;
        this.fillRow(row, node.pla, isRoot);
        rows.players[row] = node.pla;
        rows.syms[row] = isRoot || !randomSyms ? 0 : Math.floor(rng() * 8);
        for (const n of path) n.inFlight++;
        result = { path, leaf: node };
      }
      return result;
    } finally {
      for (let i = steps.length - 1; i >= 0; i--) this.revertMove(steps[i].move, steps[i].pla, steps[i].step);
    }
  }

  /** Runs the search within `limits` and reports the root. */
  async run(limits: SearchLimits): Promise<SearchResult> {
    const now = limits.now ?? (() => performance.now());
    const start = now();
    const randomSyms = limits.randomSymmetries ?? true;
    const avoid = limits.avoid ?? null;
    const rows = { players: [] as StoneColor[], syms: [] as number[] };

    // The root first: its evaluation sets the score center.
    if (!this.rootNode.evaluated) {
      const p = this.descend(0, rows, null, limits.rng, randomSyms);
      if (p && p !== 'done') {
        const [ev] = await this.net.run(this.size, 1, this.spatial, this.global, rows.players, rows.syms);
        this.recentScoreCenter = recentScoreCenterOf(-ev.blackScoreMean);
        for (const n of p.path) n.inFlight--;
        this.setEval(p.leaf, ev);
        this.backup(p.path, ev);
      }
    }

    let lastYield = now();
    while (this.rootNode.visits < limits.maxVisits) {
      const elapsed = now() - start;
      if (elapsed >= limits.hardTimeMs) break;
      if (elapsed >= limits.softTimeMs && this.rootNode.visits >= limits.minVisits) break;
      if (limits.stopped()) break;
      // Only the root can be expanded when there is no legal move but pass: nothing to search.
      if (this.rootNode.edges && this.rootNode.edges.length <= 1 && this.rootNode.visits > 1) break;

      const want = Math.max(1, Math.min(limits.batchSize, limits.maxVisits - this.rootNode.visits));
      const batch: Pending[] = [];
      let tries = 0;
      while (batch.length < want && tries < want * 2) {
        tries++;
        const r = this.descend(batch.length, rows, avoid, limits.rng, randomSyms);
        if (r === null) break;
        if (r === 'done') continue;
        batch.push(r);
      }
      if (batch.length > 0) {
        const evs = await this.net.run(this.size, batch.length, this.spatial, this.global, rows.players, rows.syms);
        for (let i = 0; i < batch.length; i++) {
          const b = batch[i];
          for (const n of b.path) n.inFlight--;
          this.setEval(b.leaf, evs[i]);
          this.backup(b.path, evs[i]);
        }
      }
      if (now() - lastYield > 25) {
        await limits.yieldNow();
        lastYield = now();
      }
    }
    return this.report(avoid);
  }

  /* ------------------------------------------------------------- results */

  /** KataGo's play selection values (LCB) for the root's edges, by edge index. */
  private playSelectionValues(avoid: Uint8Array | null): Float64Array {
    const node = this.rootNode;
    const edges = node.edges ?? [];
    const n = edges.length;
    const values = new Float64Array(n);
    const lcb = new Float64Array(n);
    const radius = new Float64Array(n);
    const zeroVisitRadius = 2.0 * UTILITY_RADIUS * LCB_STDEVS;
    const pla = node.pla;
    const skip = (i: number) => !!(avoid && edges[i].move !== PASS_MOVE && avoid[edges[i].move]);

    let any = false;
    for (let i = 0; i < n; i++) {
      const c = edges[i].child;
      values[i] = c && c.visits > 0 && !skip(i) ? c.visits : 0;
      if (values[i] > 0) any = true;
      lcb[i] = -zeroVisitRadius;
      radius[i] = zeroVisitRadius;
    }
    if (!any) return values;

    let bestWeight = -1e30;
    let maxGoodness = -1e30;
    for (let i = 0; i < n; i++) {
      if (skip(i)) continue;
      const w = values[i];
      const v = edges[i].child?.visits ?? 0;
      const goodness = (w * Math.max(0, v - 1)) / Math.max(1, v) + 2.0 * edges[i].prior;
      if (goodness > maxGoodness) {
        maxGoodness = goodness;
        bestWeight = w;
      }
    }

    for (let i = 0; i < n; i++) {
      const c = edges[i].child;
      if (!c || c.visits <= 0) continue;
      let weightSum = c.visits;
      let weightSqSum = c.visits;
      let ess = (weightSum * weightSum) / weightSqSum;
      const utilityAvg = c.utilityAvg;
      const priorWeight = weightSum / (ess * ess * ess);
      let utilitySqAvg = Math.max(c.utilitySqAvg, utilityAvg * utilityAvg + 1e-8);
      utilitySqAvg = (utilitySqAvg * weightSum + (utilitySqAvg + UTILITY_RADIUS * UTILITY_RADIUS) * priorWeight) / (weightSum + priorWeight);
      weightSum += priorWeight;
      weightSqSum += priorWeight * priorWeight;
      ess = (weightSum * weightSum) / weightSqSum;
      const selfUtility = pla === BLACK ? utilityAvg : -utilityAvg;
      const stdev = Math.sqrt(Math.max(0, (utilitySqAvg - utilityAvg * utilityAvg) / ess));
      radius[i] = stdev * LCB_STDEVS;
      lcb[i] = selfUtility - radius[i];
    }

    let bestLcb = -1e10;
    let bestLcbIdx = -1;
    for (let i = 0; i < n; i++) {
      if (values[i] > 0 && values[i] >= MIN_VISIT_PROP_FOR_LCB * bestWeight && lcb[i] > bestLcb) {
        bestLcb = lcb[i];
        bestLcbIdx = i;
      }
    }
    if (bestLcbIdx >= 0) {
      let adjusted = values[bestLcbIdx];
      for (let i = 0; i < n; i++) {
        if (i === bestLcbIdx) continue;
        const excess = bestLcb - lcb[i];
        if (excess < 0) continue;
        const f = (radius[i] + excess) / (radius[i] + 0.2 * excess);
        const lbound = f * f * values[i];
        if (lbound > adjusted) adjusted = lbound;
      }
      values[bestLcbIdx] = adjusted;
    }
    return values;
  }

  private report(avoid: Uint8Array | null): SearchResult {
    const root = this.rootNode;
    const raw = root.nn!;
    const pla = root.pla;
    const toMover = (blackWinLossAvg: number) => {
      const blackWin = 0.5 + 0.5 * blackWinLossAvg;
      return pla === BLACK ? blackWin : 1 - blackWin;
    };
    const sign = pla === BLACK ? 1 : -1;
    const v = Math.max(1, root.visits);

    const area = this.area;
    const policy = new Float32Array(area + 1);
    for (const e of root.edges ?? []) policy[e.move === PASS_MOVE ? area : e.move] = e.prior;

    const ownership = new Float32Array(area);
    const k = Math.max(1, this.ownershipCount);
    for (let p = 0; p < area; p++) ownership[p] = this.ownershipSum[p] / k;

    const values = this.playSelectionValues(avoid);
    const edges = root.edges ?? [];
    const candidates: SearchCandidate[] = edges.map((e, i) => {
      const c = e.child;
      if (!c || c.visits <= 0) return { move: e.move, prior: e.prior, visits: 0, selection: 0 };
      return {
        move: e.move,
        prior: e.prior,
        visits: c.visits,
        winrate: toMover(c.winLossSum / c.visits),
        scoreLead: (sign * c.leadSum) / c.visits,
        selection: values[i],
      };
    });
    candidates.sort((a, b) => b.selection - a.selection || b.visits - a.visits || b.prior - a.prior);

    return {
      visits: root.visits,
      winrate: toMover(root.winLossSum / v),
      scoreLead: (sign * root.leadSum) / v,
      ownership,
      policy,
      candidates,
      raw,
    };
  }
}
