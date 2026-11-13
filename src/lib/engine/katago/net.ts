/**
 * Runs a batch of input rows through a `KataModel` and returns post-processed evaluations in
 * Black's perspective, undoing the board symmetry each row was evaluated in.
 *
 * Symmetries follow KataGo's numbering (bit 0 flips y, bit 1 flips x, bit 2 transposes), as in the
 * golden test of Web KaTrain (MIT, see ./LICENSE).
 */
import { tensor2d, tensor4d } from '@tensorflow/tfjs-core';
import { postprocessKataGoV8 } from './evalV8.ts';
import { GLOBAL_CHANNELS, SPATIAL_CHANNELS } from './features.ts';
import type { KataModel } from './model.ts';
import type { StoneColor } from './fastBoard.ts';

/** One evaluation, Black's perspective. */
export interface RawEval {
  readonly blackWinProb: number;
  readonly blackNoResultProb: number;
  readonly blackScoreMean: number;
  readonly blackScoreStdev: number;
  readonly blackScoreLead: number;
  /** size² + 1 policy logits for the side to move (index size² = pass), unnormalized. */
  readonly policyLogits: Float32Array;
  /** size² ownership in −1..1, +1 = Black. */
  readonly ownership: Float32Array;
}

const symMaps = new Map<string, Int32Array>();

/** `map[p]` = where point `p` lands under symmetry `sym` on a `size` board. */
export function symmetryMap(size: number, sym: number): Int32Array {
  const key = `${size}:${sym}`;
  let m = symMaps.get(key);
  if (m) return m;
  m = new Int32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let px = x;
      let py = y;
      if (sym & 1) py = size - 1 - py;
      if (sym & 2) px = size - 1 - px;
      if (sym & 4) {
        const t = px;
        px = py;
        py = t;
      }
      m[y * size + x] = py * size + px;
    }
  }
  symMaps.set(key, m);
  return m;
}

export class NetRunner {
  readonly model: KataModel;
  /**
   * Every forward pass runs at least this many rows (the rest padding), so a backend that compiles
   * a shader per tensor shape (WebGPU) compiles once per board size, not once per batch length.
   */
  readonly padTo: number;
  private spatial = new Float32Array(0);
  private global = new Float32Array(0);

  constructor(model: KataModel, opts: { padTo?: number } = {}) {
    this.model = model;
    this.padTo = Math.max(1, opts.padTo ?? 1);
  }

  /**
   * One forward pass of padding rows on a `size` board whose outputs are never read: with TF.js's
   * WebGPU compile-only mode on, this only creates the pipelines (in parallel).
   */
  forwardDiscard(size: number): void {
    const rows = this.padTo;
    const ts = tensor4d(new Float32Array(rows * size * size * SPATIAL_CHANNELS), [rows, size, size, SPATIAL_CHANNELS]);
    const tg = tensor2d(new Float32Array(rows * GLOBAL_CHANNELS), [rows, GLOBAL_CHANNELS]);
    const out = this.model.forward(ts, tg);
    ts.dispose();
    tg.dispose();
    out.policy.dispose();
    out.policyPass.dispose();
    out.value.dispose();
    out.scoreValue.dispose();
    out.ownership.dispose();
  }

  /**
   * Evaluates `count` rows. `spatial` holds `count` rows of size² × 22 (canonical orientation),
   * `global` `count` rows of 19; `players[i]` is the side to move of row i, `syms[i]` its symmetry.
   */
  async run(
    size: number,
    count: number,
    spatial: Float32Array,
    global: Float32Array,
    players: readonly StoneColor[],
    syms: readonly number[],
  ): Promise<RawEval[]> {
    const area = size * size;
    const rowS = area * SPATIAL_CHANNELS;
    const rows = Math.max(count, this.padTo);
    if (this.spatial.length < rows * rowS) this.spatial = new Float32Array(rows * rowS);
    if (this.global.length < rows * GLOBAL_CHANNELS) this.global = new Float32Array(rows * GLOBAL_CHANNELS);
    const sp = this.spatial.subarray(0, rows * rowS);
    const gl = this.global.subarray(0, rows * GLOBAL_CHANNELS);
    gl.set(global.subarray(0, count * GLOBAL_CHANNELS));
    for (let i = 0; i < count; i++) {
      const map = symmetryMap(size, syms[i] ?? 0);
      const src = i * rowS;
      for (let p = 0; p < area; p++) {
        const from = src + p * SPATIAL_CHANNELS;
        const to = src + map[p] * SPATIAL_CHANNELS;
        for (let c = 0; c < SPATIAL_CHANNELS; c++) sp[to + c] = spatial[from + c];
      }
    }

    const ts = tensor4d(sp, [rows, size, size, SPATIAL_CHANNELS]);
    const tg = tensor2d(gl, [rows, GLOBAL_CHANNELS]);
    const out = this.model.forward(ts, tg);
    ts.dispose();
    tg.dispose();
    let data: [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
    try {
      data = (await Promise.all([
        out.policy.data(),
        out.policyPass.data(),
        out.value.data(),
        out.scoreValue.data(),
        out.ownership.data(),
      ])) as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
    } finally {
      out.policy.dispose();
      out.policyPass.dispose();
      out.value.dispose();
      out.scoreValue.dispose();
      out.ownership.dispose();
    }
    const [policy, pass, value, score, own] = data;
    const pc = this.model.policyOutChannels;
    const sc = this.model.scoreValueChannels;
    const scale = this.model.postProcessParams.outputScaleMultiplier;
    const result: RawEval[] = [];
    for (let i = 0; i < count; i++) {
      const map = symmetryMap(size, syms[i] ?? 0);
      const player = players[i];
      const ev = postprocessKataGoV8({
        nextPlayer: player === 1 ? 'black' : 'white',
        valueLogits: value.subarray(i * 3, i * 3 + 3),
        scoreValue: score.subarray(i * sc, (i + 1) * sc),
        postProcessParams: this.model.postProcessParams,
        modelVersion: this.model.modelVersion,
      });
      const logits = new Float32Array(area + 1);
      const ownership = new Float32Array(area);
      const sign = player === 1 ? 1 : -1;
      for (let p = 0; p < area; p++) {
        const t = map[p];
        logits[p] = policy[(i * area + t) * pc];
        ownership[p] = sign * Math.tanh(own[i * area + t] * scale);
      }
      logits[area] = pass[i * pc];
      result.push({
        blackWinProb: ev.blackWinProb,
        blackNoResultProb: ev.blackNoResultProb,
        blackScoreMean: ev.blackScoreMean,
        blackScoreStdev: ev.blackScoreStdev,
        blackScoreLead: ev.blackScoreLead,
        policyLogits: logits,
        ownership,
      });
    }
    return result;
  }
}
