/**
 * The KataGo port against KataGo itself, and the engine's contract on real networks (Node, TF.js
 * WASM backend). These load the shipped networks from public/engine/nets/ and take a few seconds.
 */
import { tensor2d, tensor4d } from '@tensorflow/tfjs-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNodeEngine, loadNodeNet, NODE_NET_PATHS, type NodeEngine } from '../node';
import { fromDiagram, illegalReason, isLegal, makeSettings, newGame, pass, play, pointToIndex, position, replay } from '../../zigo';
import type { Position, Size } from '../../types';
import { postprocessKataGoV8 } from './evalV8';
import {
  computeLadderFeaturesV7KataGo,
  computeLadderedStonesV7KataGo,
  computeLibertyMapInto,
  setBoardSize,
} from './fastBoard';
import { KATA_RULES, fillInputs } from './features';
import type { KataModel } from './model';
import { probePosition } from '../probe';
import { playableGame } from '../position';

// ---------------------------------------------------------------------------------------------
// Ground truth from KataGo itself (ported from Web KaTrain's test/engineGolden.test.ts, MIT).
//
// cpp/tests/results/runNNOnTinyBoardTest.txt in the KataGo repo is the recorded output of real
// KataGo running g170-b6c96-s175395328-d26788732 (Zigo's small net) on a 5×5 board, White to play,
// Tromp-Taylor rules, komi 7.5, no move history, symmetry 3. 5×5 is not a Zigo board size; the engine
// layer allows any size, the app offers 9, 13 and 19.
//
//   .....
//   ...x.
//   ..o..
//   .xxo.
//   .....
//
// Every reference number is from White's perspective, as KataGo prints it.
// ---------------------------------------------------------------------------------------------

const REF = {
  win: 0.9025,
  noResult: 0.0,
  scoreMean: 9.37,
  scoreMeanSq: 242.9,
  lead: 7.87,
  /** Permille, row-major from the top row. -1 marks an occupied point. */
  policy: [
    [0, 0, 0, 0, 0],
    [0, 3, 150, -1, 0],
    [0, 237, -1, 607, 0],
    [0, -1, -1, -1, 0],
    [0, 0, 0, 1, 0],
  ],
  pass: 0,
  /** Permille, White-positive. */
  ownership: [
    [-21, -257, 64, -419, 121],
    [-129, -354, -489, -148, 241],
    [-341, -367, -294, 46, 292],
    [-322, -457, -80, 559, 277],
    [-247, -395, -127, -132, 91],
  ],
};
const DIAGRAM = ['.....', '...x.', '..o..', '.xxo.', '.....'];
const SIZE = 5;
const GOLDEN_SYMMETRY = 3;

function symPoint(x: number, y: number, n: number, sym: number): [number, number] {
  let px = x;
  let py = y;
  if (sym & 1) py = n - 1 - py;
  if (sym & 2) px = n - 1 - px;
  if (sym & 4) [px, py] = [py, px];
  return [px, py];
}

let engine: NodeEngine;
let small: KataModel;

beforeAll(async () => {
  engine = await createNodeEngine({ backend: 'wasm' });
  small = await loadNodeNet(NODE_NET_PATHS.small);
}, 60_000);

describe('KataGo golden reference (b6c96)', () => {
  it('runs on the WASM backend', () => {
    expect(engine.backend).toBe('wasm');
  });

  it('reproduces KataGo raw network output for the shipped small net', async () => {
    expect(small.modelVersion).toBe(8);
    setBoardSize(SIZE);
    const stones = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) stones[y * SIZE + x] = DIAGRAM[y][x] === 'x' ? 1 : DIAGRAM[y][x] === 'o' ? 2 : 0;
    const libs = new Uint8Array(SIZE * SIZE);
    computeLibertyMapInto(stones, libs);
    const ladder = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: 2 });
    const prev = computeLadderedStonesV7KataGo({ stones, koPoint: -1 });
    const base = new Float32Array(SIZE * SIZE * 22);
    const global = new Float32Array(19);
    // Tromp-Taylor: area scoring, positional superko, multi-stone suicide legal, no friendly pass.
    const tromp = { ...KATA_RULES.area, multiStoneSuicideLegal: true, friendlyPassOk: false };
    fillInputs(
      {
        stones,
        koPoint: -1,
        superkoBanned: null,
        player: 2,
        recentMoves: [],
        komi: 7.5,
        rules: tromp,
        conservativePassAndIsRoot: false,
        libertyMap: libs,
        ladderedStones: ladder.ladderedStones,
        prevLadderedStones: prev,
        prevPrevLadderedStones: prev,
        ladderWorkingMoves: ladder.ladderWorkingMoves,
        areaScratch: new Uint8Array(SIZE * SIZE),
      },
      base,
      global,
    );
    const spatial = new Float32Array(base.length);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const [tx, ty] = symPoint(x, y, SIZE, GOLDEN_SYMMETRY);
        for (let c = 0; c < 22; c++) spatial[(ty * SIZE + tx) * 22 + c] = base[(y * SIZE + x) * 22 + c];
      }

    const ts = tensor4d(spatial, [1, SIZE, SIZE, 22]);
    const tg = tensor2d(global, [1, 19]);
    const out = small.forward(ts, tg);
    const [policy, pass, value, score, own] = (await Promise.all([
      out.policy.data(),
      out.policyPass.data(),
      out.value.data(),
      out.scoreValue.data(),
      out.ownership.data(),
    ])) as Float32Array[];
    for (const t of [ts, tg, out.policy, out.policyPass, out.value, out.scoreValue, out.ownership]) t.dispose();

    const ev = postprocessKataGoV8({ nextPlayer: 'white', valueLogits: value, scoreValue: score, postProcessParams: small.postProcessParams });
    const whiteWin = 1 - ev.blackWinProb - ev.blackNoResultProb;
    const whiteScoreMean = -ev.blackScoreMean;
    const whiteScoreMeanSq = whiteScoreMean * whiteScoreMean + ev.blackScoreStdev * ev.blackScoreStdev;
    // Web KaTrain's bands: about four times the deviation measured against KataGo's printout.
    expect(Math.abs(whiteWin - REF.win)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(ev.blackNoResultProb - REF.noResult)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(whiteScoreMean - REF.scoreMean)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(-ev.blackScoreLead - REF.lead)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(whiteScoreMeanSq - REF.scoreMeanSq)).toBeLessThanOrEqual(0.05);

    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const [tx, ty] = symPoint(x, y, SIZE, GOLDEN_SYMMETRY);
        const permille = Math.round(Math.tanh(own[ty * SIZE + tx]) * 1000);
        expect(Math.abs(permille - REF.ownership[y][x]), `ownership at ${x},${y}`).toBeLessThanOrEqual(3);
      }

    const channels = small.policyOutChannels;
    const logits = new Float32Array(SIZE * SIZE + 1);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const [tx, ty] = symPoint(x, y, SIZE, GOLDEN_SYMMETRY);
        logits[y * SIZE + x] = policy[(ty * SIZE + tx) * channels];
      }
    logits[SIZE * SIZE] = pass[0];
    const legal = (i: number) => i === SIZE * SIZE || stones[i] === 0;
    let max = -Infinity;
    for (let i = 0; i <= SIZE * SIZE; i++) if (legal(i)) max = Math.max(max, logits[i]);
    let sum = 0;
    const probs = new Float32Array(SIZE * SIZE + 1);
    for (let i = 0; i <= SIZE * SIZE; i++)
      if (legal(i)) {
        probs[i] = Math.exp(logits[i] - max);
        sum += probs[i];
      }
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        if (REF.policy[y][x] < 0) continue;
        expect(Math.abs(Math.round((probs[y * SIZE + x] / sum) * 1000) - REF.policy[y][x]), `policy at ${x},${y}`).toBeLessThanOrEqual(2);
      }
    expect(Math.round((probs[SIZE * SIZE] / sum) * 1000)).toBe(REF.pass);
  }, 60_000);
});

function sumOf(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

describe('evaluate', () => {
  it('reports win rate and lead for the side to move, ownership +1 = Black, a policy over legal moves', async () => {
    const pos = probePosition();
    expect(pos.turn).toBe('B');
    const r = await engine.evaluate(pos);
    expect(r.ownership).toHaveLength(81);
    expect(r.policy).toHaveLength(82);
    expect(sumOf(r.policy)).toBeCloseTo(1, 4);
    for (let i = 0; i < 81; i++) {
      if (pos.board[i] !== 0) expect(r.policy[i]).toBe(0);
      expect(Math.abs(r.ownership[i])).toBeLessThanOrEqual(1);
    }
    // Black's stones read as Black's, White's as White's.
    expect(r.ownership[pointToIndex('ee', 9)]).toBeGreaterThan(0);
    expect(r.ownership[pointToIndex('gg', 9)]).toBeLessThan(0);
    // More komi for White: worse for Black (the side to move) by about a point per point.
    const low = await engine.evaluate({ ...pos, komi2: 0 });
    const high = await engine.evaluate({ ...pos, komi2: 30 });
    expect(low.winrate).toBeGreaterThan(r.winrate);
    expect(high.winrate).toBeLessThan(r.winrate);
    expect(low.scoreLead - high.scoreLead).toBeGreaterThan(10);
    expect(low.scoreLead - high.scoreLead).toBeLessThan(20);
  }, 30_000);

  it('is colour-symmetric: swapped stones, side to move and komi give the same numbers for the mover', async () => {
    const pos = probePosition();
    // Board-only positions (no history), so both sides see exactly the same inputs.
    const a: Position = { ...pos, moves: [], setup: { B: [], W: [] } };
    const swapped = pos.board.map((v) => (v === 1 ? 2 : v === 2 ? 1 : 0));
    const b: Position = { ...a, board: swapped, turn: 'W', komi2: -pos.komi2 };
    const ra = await engine.evaluate(a);
    const rb = await engine.evaluate(b);
    expect(rb.winrate).toBeCloseTo(ra.winrate, 5);
    expect(rb.scoreLead).toBeCloseTo(ra.scoreLead, 3);
    for (let i = 0; i < 81; i++) expect(rb.ownership[i]).toBeCloseTo(-ra.ownership[i], 4);
  }, 30_000);

  it('gives the simple-ko point and occupied points no policy', async () => {
    const ko = fromDiagram(['.xo......', 'x.xo.....', '.xo......', ...Array(6).fill('.........')], 'W');
    const taken = play(ko, 'bb', 0);
    expect(taken.ko).not.toBeNull();
    const r = await engine.evaluate(position(taken));
    expect(r.policy[pointToIndex(taken.ko!, 9)]).toBe(0);
    expect(r.policy[pointToIndex('bb', 9)]).toBe(0);
  }, 30_000);

  it('bans a recapture that only positional superko forbids, also inside a search', async () => {
    const ko = fromDiagram(['.xo......', 'x.xo.....', '.xo......', ...Array(6).fill('.........')], 'W');
    // White takes the ko, both pass (the simple ko is gone), play resumes: retaking at cb would
    // repeat the position before the capture.
    const g = pass(pass(play(ko, 'bb', 0), 0), 0);
    const pos = position(g);
    expect(illegalReason(playableGame(pos), 'cb')).toBe('superko');
    const raw = await engine.evaluate(pos);
    expect(raw.policy[pointToIndex('cb', 9)]).toBe(0);
    const searched = await engine.evaluate(pos, { visits: 32 });
    expect(searched.policy[pointToIndex('cb', 9)]).toBe(0);
    const r = await engine.genmove(pos, 10, undefined, { seed: 5 });
    expect(r.move).not.toBe('cb');
    expect(r.candidates.map((c) => c.move)).not.toContain('cb');
  }, 30_000);

  it('searches with visits and averages ownership over the search', async () => {
    const r = await engine.evaluate(probePosition(), { visits: 24 });
    expect(r.winrate).toBeGreaterThan(0);
    expect(r.winrate).toBeLessThan(1);
    expect(sumOf(r.policy)).toBeCloseTo(1, 4);
  }, 30_000);
});

describe('genmove', () => {
  const sizes: Size[] = [9, 13, 19];
  for (const size of sizes) {
    it(`returns legal moves on ${size}×${size} (levels 1, 3, 5, 7)`, async () => {
      let g = newGame(makeSettings(size));
      for (let i = 0; i < 8; i++) {
        const level = [1, 3, 5, 7][i % 4];
        const pos = position(g);
        const r = await engine.genmove(pos, level, undefined, { seed: 100 + i });
        expect(r.move === 'tt' || isLegal(g, r.move), `level ${level} played ${r.move}`).toBe(true);
        expect(r.winrate).toBeGreaterThanOrEqual(0);
        expect(r.winrate).toBeLessThanOrEqual(1);
        expect(r.candidates.length).toBeGreaterThan(0);
        g = play(g, r.move, 0);
      }
    }, 60_000);
  }

  it('searches on the large net (level 10, 9×9) and reports visited candidates', async () => {
    const pos = position(replay(makeSettings(9), ['ee', 'cc']));
    const r = await engine.genmove(pos, 10, undefined, { seed: 7 });
    expect(r.method).toBe('search');
    expect(r.net).toBe('large');
    expect(r.visits).toBeGreaterThanOrEqual(4);
    expect(isLegal(playableGame(pos), r.move)).toBe(true);
    expect(r.candidates[0].visits).toBeGreaterThan(0);
    expect(r.candidates[0].winrate).toBeTypeOf('number');
  }, 60_000);

  it('never plays a point in avoid', async () => {
    const pos = position(newGame(makeSettings(9)));
    const first = await engine.genmove(pos, 7, undefined, { seed: 1 });
    const avoid = first.candidates.filter((c) => c.move !== 'tt').slice(0, 5).map((c) => c.move);
    const second = await engine.genmove(pos, 7, undefined, { seed: 1, avoid });
    expect(avoid).not.toContain(second.move);
    expect(second.move === 'tt' || isLegal(playableGame(pos), second.move)).toBe(true);
  }, 30_000);

  it('is reproducible with a seed', async () => {
    const pos = position(newGame(makeSettings(13)));
    const a = await engine.genmove(pos, 2, undefined, { seed: 42 });
    const b = await engine.genmove(pos, 2, undefined, { seed: 42 });
    expect(a.move).toBe(b.move);
  }, 30_000);

  it('passes in a finished position after the opponent passed', async () => {
    // Every point settled: Black owns the left, White the right; White just passed.
    const rows = Array.from({ length: 9 }, () => 'xxxx.oooo');
    let g = fromDiagram(rows, 'W');
    g = play(g, 'tt', 0);
    const r = await engine.genmove(position(g), 5, undefined, { seed: 3 });
    expect(['tt', 'ea', 'eb', 'ec', 'ed', 'ee', 'ef', 'eg', 'eh', 'ei']).toContain(r.move);
  }, 30_000);
});

describe('analyze', () => {
  it('returns the best n legal moves of a short search', async () => {
    const pos = probePosition();
    const list = await engine.analyze(pos, 3, { visits: 16 });
    expect(list).toHaveLength(3);
    const game = playableGame(pos);
    for (const c of list) {
      expect(c.move === 'tt' || isLegal(game, c.move)).toBe(true);
      expect(c.winrate).toBeTypeOf('number');
      expect(c.scoreLead).toBeTypeOf('number');
    }
    expect(list[0].visits).toBeGreaterThan(0);
  }, 30_000);
});
