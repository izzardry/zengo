/**
 * KataGo v7 network inputs (22 spatial planes, 19 globals) for Zigo's two rule sets.
 *
 * Ported from Web KaTrain `src/engine/katago/featuresV7Fast.ts` and `historyV7.ts` (MIT, see
 * ./LICENSE), which follow KataGo's `NNInputs::fillRowV7` (`cpp/neuralnet/nninputs.cpp`).
 *
 * Rules (KataGo's rule inputs, as Web KaTrain feeds them):
 * - Zigo `area`: area scoring, positional superko, no group tax, suicide illegal, friendly pass
 *   (KataGo's "chinese" preset with positional ko, the configuration of the golden test);
 * - Zigo `territory`: territory scoring, positional superko, seki tax, suicide illegal (KataGo's
 *   "japanese" preset with positional ko, because Zigo plays positional superko under both).
 */
import type { Rules } from '../../types.ts';
import { BOARD_AREA, BOARD_SIZE, EMPTY, PASS_MOVE, computeAreaMapV7KataGoInto, type StoneColor } from './fastBoard.ts';

export const SPATIAL_CHANNELS = 22;
export const GLOBAL_CHANNELS = 19;
/** KataGo NNPos::KOMI_CLIP_RADIUS. */
const KOMI_CLIP_RADIUS = 20;

export interface KataRules {
  readonly scoring: 'area' | 'territory';
  readonly ko: 'simple' | 'positional' | 'situational';
  readonly tax: 'none' | 'seki' | 'all';
  readonly multiStoneSuicideLegal: boolean;
  readonly hasButton: boolean;
  readonly friendlyPassOk: boolean;
}

export const KATA_RULES: Readonly<Record<Rules, KataRules>> = Object.freeze({
  area: { scoring: 'area', ko: 'positional', tax: 'none', multiStoneSuicideLegal: false, hasButton: false, friendlyPassOk: true },
  territory: {
    scoring: 'territory',
    ko: 'positional',
    tax: 'seki',
    multiStoneSuicideLegal: false,
    hasButton: false,
    friendlyPassOk: false,
  },
});

/** One recent ply: `move` is a point index or `PASS_MOVE`; `player` 1 = Black, 2 = White. */
export interface RecentMove {
  readonly move: number;
  readonly player: StoneColor;
}

export interface HistoryFeatures {
  readonly turnsIncluded: number;
  readonly passWouldEndPhase: boolean;
}

/** KataGo v7 history for ordinary consecutive-pass endings with the encore disabled. */
export function historyFeatures(args: {
  recentMoves: readonly RecentMove[];
  player: StoneColor;
  rules: KataRules;
  conservativePassAndIsRoot?: boolean;
}): HistoryFeatures {
  const { recentMoves, player, rules } = args;
  const last = recentMoves.length - 1;
  const afterPass = recentMoves[last]?.move === PASS_MOVE;
  const afterTwoPasses = afterPass && recentMoves[last - 1]?.move === PASS_MOVE;
  const passWouldEndGame = rules.scoring === 'area' && afterPass;
  const suppress = passWouldEndGame && (args.conservativePassAndIsRoot === true || (rules.friendlyPassOk && !afterTwoPasses));
  if (suppress) return { turnsIncluded: 0, passWouldEndPhase: false };

  let cap = 5;
  // After an ending, keep its final pass and only the moves played since.
  for (let offset = 0; offset < cap && last - offset > 0; offset++) {
    if (recentMoves[last - offset].move === PASS_MOVE && recentMoves[last - offset - 1].move === PASS_MOVE) {
      cap = Math.min(cap, offset + 1);
      break;
    }
  }
  let turnsIncluded = 0;
  let expected: StoneColor = player === 1 ? 2 : 1;
  for (let offset = 0; offset < cap; offset++) {
    const m = recentMoves[last - offset];
    if (!m || m.player !== expected) break;
    turnsIncluded++;
    expected = expected === 1 ? 2 : 1;
  }
  return { turnsIncluded, passWouldEndPhase: afterPass };
}

export interface FeatureArgs {
  /** size², 0 empty, 1 Black, 2 White (fastBoard's current size). */
  readonly stones: Uint8Array;
  /** Point the side to move may not play by simple ko, or −1. */
  readonly koPoint: number;
  /** Points banned by positional superko (1 = banned), or null. */
  readonly superkoBanned: Uint8Array | null;
  readonly player: StoneColor;
  /** Chronological; the last entry is the most recent ply. */
  readonly recentMoves: readonly RecentMove[];
  /** White's komi, handicap compensation included. */
  readonly komi: number;
  readonly rules: KataRules;
  readonly conservativePassAndIsRoot: boolean;
  /** Liberties per stone, capped at 3 (`computeLibertyMapInto`). */
  readonly libertyMap: Uint8Array;
  /** Plane 14–17 inputs (`computeLadderFeaturesV7KataGoInto`, `computeLadderedStonesV7KataGoInto`). */
  readonly ladderedStones: Uint8Array;
  readonly prevLadderedStones: Uint8Array;
  readonly prevPrevLadderedStones: Uint8Array;
  readonly ladderWorkingMoves: Uint8Array;
  /** Scratch for the area map (area scoring), length size². */
  readonly areaScratch: Uint8Array;
  readonly history?: HistoryFeatures;
}

/** Fills one row of inputs: `outSpatial` (size² × 22, NHWC) and `outGlobal` (19). */
export function fillInputs(a: FeatureArgs, outSpatial: Float32Array, outGlobal: Float32Array): void {
  const C = SPATIAL_CHANNELS;
  const pla = a.player;
  const opp: StoneColor = pla === 1 ? 2 : 1;
  const spatial = outSpatial;
  const global = outGlobal;
  spatial.fill(0);
  global.fill(0);

  for (let p = 0; p < BOARD_AREA; p++) spatial[p * C] = 1;
  if (a.koPoint >= 0 && a.koPoint < BOARD_AREA) spatial[a.koPoint * C + 6] = 1;
  if (a.superkoBanned) for (let p = 0; p < BOARD_AREA; p++) if (a.superkoBanned[p]) spatial[p * C + 6] = 1;

  for (let p = 0; p < BOARD_AREA; p++) {
    const v = a.stones[p];
    if (v === EMPTY) continue;
    if (v === pla) spatial[p * C + 1] = 1;
    else spatial[p * C + 2] = 1;
    const l = a.libertyMap[p];
    if (l === 1) spatial[p * C + 3] = 1;
    else if (l === 2) spatial[p * C + 4] = 1;
    else if (l === 3) spatial[p * C + 5] = 1;
  }

  for (let p = 0; p < BOARD_AREA; p++) {
    if (a.ladderedStones[p]) spatial[p * C + 14] = 1;
    if (a.prevLadderedStones[p]) spatial[p * C + 15] = 1;
    if (a.prevPrevLadderedStones[p]) spatial[p * C + 16] = 1;
    if (a.ladderWorkingMoves[p]) spatial[p * C + 17] = 1;
  }

  // drawEquivalentWinsForWhite is KataGo's default 0.5, at which the draw adjustment of the komi is 0.
  const selfKomi = pla === 2 ? a.komi : -a.komi;

  if (a.rules.scoring === 'area' && a.rules.tax === 'none') {
    const area = computeAreaMapV7KataGoInto(a.stones, a.areaScratch, a.rules.multiStoneSuicideLegal);
    for (let p = 0; p < BOARD_AREA; p++) {
      const v = area[p];
      if (v === pla) spatial[p * C + 18] = 1;
      else if (v === opp) spatial[p * C + 19] = 1;
    }
  }

  const history =
    a.history ??
    historyFeatures({ recentMoves: a.recentMoves, player: pla, rules: a.rules, conservativePassAndIsRoot: a.conservativePassAndIsRoot });
  const planes = [9, 10, 11, 12, 13];
  let expected: StoneColor = opp;
  for (let i = 0; i < history.turnsIncluded; i++) {
    const m = a.recentMoves[a.recentMoves.length - 1 - i];
    if (!m || m.player !== expected) break;
    if (m.move === PASS_MOVE) global[i] = 1;
    else spatial[m.move * C + planes[i]] = 1;
    expected = expected === 1 ? 2 : 1;
  }

  const bound = BOARD_SIZE * BOARD_SIZE + KOMI_CLIP_RADIUS;
  const clampedSelfKomi = Math.max(-bound, Math.min(bound, selfKomi));
  global[5] = clampedSelfKomi / 20;

  const r = a.rules;
  if (r.ko === 'positional') {
    global[6] = 1;
    global[7] = 0.5;
  } else if (r.ko === 'situational') {
    global[6] = 1;
    global[7] = -0.5;
  }
  if (r.multiStoneSuicideLegal) global[8] = 1;
  if (r.scoring === 'territory') global[9] = 1;
  if (r.tax === 'seki') global[10] = 1;
  else if (r.tax === 'all') {
    global[10] = 1;
    global[11] = 1;
  }
  if (r.hasButton) global[17] = 1;
  global[14] = history.passWouldEndPhase ? 1 : 0;

  // KataGo's komi parity wave under area scoring.
  if (r.scoring === 'area') {
    const evenArea = (BOARD_SIZE * BOARD_SIZE) % 2 === 0;
    const komiFloor = evenArea
      ? Math.floor(clampedSelfKomi / 2) * 2
      : Math.floor((clampedSelfKomi - 1) / 2) * 2 + 1;
    const delta = Math.min(2, Math.max(0, clampedSelfKomi - komiFloor));
    global[18] = delta < 0.5 ? delta : delta < 1.5 ? 1 - delta : delta - 2;
  }
}
