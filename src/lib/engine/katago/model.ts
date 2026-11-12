/**
 * The KataGo network as a TF.js graph (forward pass only), for any registered TF.js backend
 * (WebGPU or WASM in the worker, WASM or CPU in Node).
 *
 * Ported from Web KaTrain `src/engine/katago/modelV8.ts` (MIT, see ./LICENSE), with two changes:
 * - only the ops used are imported from `@tensorflow/tfjs-core` (no full `@tensorflow/tfjs`);
 * - a batch norm that directly follows a convolution is folded into that convolution's weights
 *   and bias, so most convolutions run as one fused conv + bias + ReLU kernel. This is the same
 *   arithmetic up to float rounding (the golden test checks it against KataGo's own output).
 *
 * The input is NHWC with H = W = board size, so 'same' zero padding plays the role of KataGo's
 * board mask.
 */
import {
  add,
  concat,
  conv2d,
  dispose,
  fused,
  matMul,
  max,
  mean,
  mul,
  relu,
  reshape,
  softplus,
  tanh,
  tensor1d,
  tensor2d,
  tensor4d,
  tidy,
  type Tensor,
  type Tensor2D,
  type Tensor4D,
} from '@tensorflow/tfjs-core';
import type { ActivationKind, ParsedBatchNorm, ParsedConv2d, ParsedMatMul } from './binModelParser.ts';
import type { ParsedModel, PostProcessParams } from './loadModel.ts';

interface Conv {
  readonly filter: Tensor4D;
  readonly dilation: [number, number];
  /** Folded batch-norm bias (rank 1, as the WASM fused kernel needs), when a batch norm follows. */
  readonly bias: Tensor | null;
  readonly activation: ActivationKind;
}

interface Bn {
  readonly scale: Tensor4D;
  readonly bias: Tensor4D;
  readonly activation: ActivationKind;
}

type Block =
  | { kind: 'ordinary'; pre: Bn; w1: Conv; w2: Conv }
  | {
      kind: 'gpool';
      pre: Bn;
      /** w1a with the mid batch-norm scale folded in. */
      w1a: Conv;
      /** w1b with the gpool batch norm folded in, plus its activation. */
      w1b: Conv;
      /** w1r with the mid batch-norm scale folded in. */
      w1r: Tensor2D;
      midBias: Tensor2D;
      midActivation: ActivationKind;
      w2: Conv;
    };

/** Raw outputs of one forward pass (all still tensors; the caller reads and disposes them). */
export interface ForwardOutputs {
  /** [N, H, W, policyChannels]; channel 0 is the policy logits. */
  readonly policy: Tensor4D;
  /** [N, policyChannels]; channel 0 is the pass logit. */
  readonly policyPass: Tensor2D;
  /** [N, 3]: win, loss, no-result logits for the side to move. */
  readonly value: Tensor2D;
  /** [N, scoreValueChannels]. */
  readonly scoreValue: Tensor2D;
  /** [N, H, W, 1]: ownership pre-tanh, side to move positive. */
  readonly ownership: Tensor4D;
}

function scaleOut(weights: Float32Array, outChannels: number, scale: Float32Array): Float32Array {
  const out = new Float32Array(weights.length);
  for (let i = 0; i < weights.length; i++) out[i] = weights[i] * scale[i % outChannels];
  return out;
}

function makeConv(c: ParsedConv2d, bn?: ParsedBatchNorm, activation: ActivationKind = 'identity'): Conv {
  const w = bn ? scaleOut(c.weights, c.outChannels, bn.mergedScale) : c.weights;
  return {
    filter: tensor4d(w, [c.kernelY, c.kernelX, c.inChannels, c.outChannels]),
    dilation: [c.dilationY, c.dilationX],
    bias: bn ? tensor1d(bn.mergedBias) : null,
    activation: bn ? activation : 'identity',
  };
}

function makeBn(bn: ParsedBatchNorm, activation: ActivationKind): Bn {
  return {
    scale: tensor4d(bn.mergedScale, [1, 1, 1, bn.channels]),
    bias: tensor4d(bn.mergedBias, [1, 1, 1, bn.channels]),
    activation,
  };
}

function makeMatMul(m: ParsedMatMul, scale?: Float32Array): Tensor2D {
  return tensor2d(scale ? scaleOut(m.weights, m.outChannels, scale) : m.weights, [m.inChannels, m.outChannels]);
}

function act<T extends Tensor>(x: T, kind: ActivationKind): T {
  if (kind === 'identity') return x;
  if (kind === 'relu') return relu(x);
  return mul(x, tanh(softplus(x))) as T;
}

function runConv(x: Tensor4D, c: Conv): Tensor4D {
  if (c.bias && c.activation !== 'mish') {
    return fused.conv2d({
      x,
      filter: c.filter,
      strides: 1,
      pad: 'same',
      dataFormat: 'NHWC',
      dilations: c.dilation,
      bias: c.bias,
      activation: c.activation === 'relu' ? 'relu' : 'linear',
    }) as Tensor4D;
  }
  let y = conv2d(x, c.filter, 1, 'same', 'NHWC', c.dilation);
  if (c.bias) y = act(add(y, c.bias), c.activation);
  return y;
}

function runBn(x: Tensor4D, bn: Bn): Tensor4D {
  return act(add(mul(x, bn.scale), bn.bias), bn.activation);
}

/** KataGo gpool: concat(mean, mean · (size − 14) · 0.1, max) over the board. */
function gpool(x: Tensor4D): Tensor2D {
  const size = x.shape[1] ?? 19;
  const m = mean(x, [1, 2]) as Tensor2D;
  return concat([m, mul(m, (size - 14) * 0.1), max(x, [1, 2]) as Tensor2D], 1) as Tensor2D;
}

/** KataGo value-head pooling: concat(mean, mean · (size − 14) · 0.1, mean · ((size − 14)² · 0.01 − 0.1)). */
function valuePool(x: Tensor4D): Tensor2D {
  const size = x.shape[1] ?? 19;
  const b = size - 14;
  const m = mean(x, [1, 2]) as Tensor2D;
  return concat([m, mul(m, b * 0.1), mul(m, b * b * 0.01 - 0.1)], 1) as Tensor2D;
}

function asChannelBias(x: Tensor2D): Tensor4D {
  return reshape(x, [x.shape[0], 1, 1, x.shape[1]]);
}

export class KataModel {
  readonly modelName: string;
  readonly modelVersion: number;
  readonly postProcessParams: PostProcessParams;
  readonly policyOutChannels: number;
  readonly scoreValueChannels: number;

  private readonly conv1: Conv;
  private readonly ginput: Tensor2D;
  private readonly blocks: Block[];
  private readonly tip: Bn;

  private readonly p1: Conv;
  private readonly p1GpoolBias: Tensor2D;
  private readonly p1Bias: Tensor2D;
  private readonly p1Activation: ActivationKind;
  private readonly g1: Conv;
  private readonly p2: Conv;
  private readonly passMul: Tensor2D;

  private readonly v1: Conv;
  private readonly v2: Tensor2D;
  private readonly v2Bias: Tensor2D;
  private readonly v2Activation: ActivationKind;
  private readonly v3: Tensor2D;
  private readonly v3Bias: Tensor2D;
  private readonly sv3: Tensor2D;
  private readonly sv3Bias: Tensor2D;
  private readonly ownershipConv: Conv;

  private readonly tensors: Tensor[] = [];

  constructor(parsed: ParsedModel) {
    this.modelName = parsed.modelName;
    this.modelVersion = parsed.modelVersion;
    this.postProcessParams = parsed.postProcessParams;
    this.policyOutChannels = parsed.policyOutChannels;
    this.scoreValueChannels = parsed.scoreValueChannels;

    const track = <T extends Tensor | null>(t: T): T => {
      if (t) this.tensors.push(t);
      return t;
    };
    const conv = (c: ParsedConv2d, bn?: ParsedBatchNorm, a?: ActivationKind): Conv => {
      const r = makeConv(c, bn, a);
      track(r.filter);
      track(r.bias);
      return r;
    };
    const bnT = (bn: ParsedBatchNorm, a: ActivationKind): Bn => {
      const r = makeBn(bn, a);
      track(r.scale);
      track(r.bias);
      return r;
    };
    const mm = (m: ParsedMatMul, scale?: Float32Array) => track(makeMatMul(m, scale));
    const row = (v: Float32Array) => track(tensor2d(v, [1, v.length]));
    /** A convolution whose output is scaled per channel by a batch norm applied after a later add. */
    const scaledConv = (c: ParsedConv2d, scale: Float32Array): Conv => ({
      filter: track(tensor4d(scaleOut(c.weights, c.outChannels, scale), [c.kernelY, c.kernelX, c.inChannels, c.outChannels])),
      dilation: [c.dilationY, c.dilationX],
      bias: null,
      activation: 'identity',
    });

    const t = parsed.trunk;
    this.conv1 = conv(t.conv1);
    this.ginput = mm(t.ginput);
    this.blocks = t.blocks.map((b): Block => {
      if (b.kind === 'ordinary') {
        return { kind: 'ordinary', pre: bnT(b.preBN, b.preActivation), w1: conv(b.w1, b.midBN, b.midActivation), w2: conv(b.w2) };
      }
      return {
        kind: 'gpool',
        pre: bnT(b.preBN, b.preActivation),
        w1a: scaledConv(b.w1a, b.midBN.mergedScale),
        w1b: conv(b.w1b, b.gpoolBN, b.gpoolActivation),
        w1r: mm(b.w1r, b.midBN.mergedScale),
        midBias: row(b.midBN.mergedBias),
        midActivation: b.midActivation,
        w2: conv(b.w2),
      };
    });
    this.tip = bnT(t.tipBN, t.tipActivation);

    const p = parsed.policy;
    this.p1 = scaledConv(p.p1, p.p1BN.mergedScale);
    this.p1GpoolBias = mm(p.gpoolToBias, p.p1BN.mergedScale);
    this.p1Bias = row(p.p1BN.mergedBias);
    this.p1Activation = p.p1Activation;
    this.g1 = conv(p.g1, p.g1BN, p.g1Activation);
    this.p2 = conv(p.p2);
    this.passMul = mm(p.passMul);

    const v = parsed.value;
    this.v1 = conv(v.v1, v.v1BN, v.v1Activation);
    this.v2 = mm(v.v2);
    this.v2Bias = row(v.v2Bias.weights);
    this.v2Activation = v.v2Activation;
    this.v3 = mm(v.v3);
    this.v3Bias = row(v.v3Bias.weights);
    this.sv3 = mm(v.sv3);
    this.sv3Bias = row(v.sv3Bias.weights);
    this.ownershipConv = conv(v.ownership);
  }

  /** One forward pass. `spatial` is [N, size, size, 22], `global` [N, 19]. */
  forward(spatial: Tensor4D, global: Tensor2D): ForwardOutputs {
    return tidy(() => {
      let trunk = runConv(spatial, this.conv1);
      trunk = add(trunk, asChannelBias(matMul(global, this.ginput)));
      for (const b of this.blocks) {
        const a = runBn(trunk, b.pre);
        if (b.kind === 'ordinary') {
          trunk = add(trunk, runConv(runConv(a, b.w1), b.w2));
          continue;
        }
        const regular = runConv(a, b.w1a);
        const g = gpool(runConv(a, b.w1b));
        const bias = add(matMul(g, b.w1r), b.midBias) as Tensor2D;
        const c = act(add(regular, asChannelBias(bias)) as Tensor4D, b.midActivation);
        trunk = add(trunk, runConv(c, b.w2));
      }
      trunk = runBn(trunk, this.tip);

      // Policy head
      const g1 = gpool(runConv(trunk, this.g1));
      const p1Bias = add(matMul(g1, this.p1GpoolBias), this.p1Bias) as Tensor2D;
      const p1 = act(add(runConv(trunk, this.p1), asChannelBias(p1Bias)) as Tensor4D, this.p1Activation);
      const policy = runConv(p1, this.p2);
      const policyPass = matMul(g1, this.passMul) as Tensor2D;

      // Value head
      const v1 = runConv(trunk, this.v1);
      const v2 = act(add(matMul(valuePool(v1), this.v2), this.v2Bias) as Tensor2D, this.v2Activation);
      const value = add(matMul(v2, this.v3), this.v3Bias) as Tensor2D;
      const scoreValue = add(matMul(v2, this.sv3), this.sv3Bias) as Tensor2D;
      const ownership = runConv(v1, this.ownershipConv);

      return { policy, policyPass, value, scoreValue, ownership };
    });
  }

  dispose(): void {
    dispose(this.tensors);
    this.tensors.length = 0;
  }
}
