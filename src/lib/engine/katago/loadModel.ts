/**
 * Parser for KataGo `.bin` networks, model versions 8 to 14, without the human-SL meta encoder.
 * Zengo ships two version 8 networks (g170 b6c96 and b10c128).
 *
 * Ported from Web KaTrain `src/engine/katago/loadModelV8.ts` (MIT, see ./LICENSE).
 */
import {
  KataGoBinModelParser,
  parseActivationKind,
  parseBatchNormV8,
  parseConv2d,
  parseMatBias,
  parseMatMul,
  type ActivationKind,
  type ParsedBatchNorm,
  type ParsedConv2d,
  type ParsedMatBias,
  type ParsedMatMul,
} from './binModelParser.ts';

export type ParsedTrunkBlock =
  | {
      kind: 'ordinary';
      preBN: ParsedBatchNorm;
      preActivation: ActivationKind;
      w1: ParsedConv2d;
      midBN: ParsedBatchNorm;
      midActivation: ActivationKind;
      w2: ParsedConv2d;
    }
  | {
      kind: 'gpool';
      preBN: ParsedBatchNorm;
      preActivation: ActivationKind;
      w1a: ParsedConv2d;
      w1b: ParsedConv2d;
      gpoolBN: ParsedBatchNorm;
      gpoolActivation: ActivationKind;
      w1r: ParsedMatMul;
      midBN: ParsedBatchNorm;
      midActivation: ActivationKind;
      w2: ParsedConv2d;
    };

export interface PostProcessParams {
  tdScoreMultiplier: number;
  scoreMeanMultiplier: number;
  scoreStdevMultiplier: number;
  leadMultiplier: number;
  varianceTimeMultiplier: number;
  shorttermValueErrorMultiplier: number;
  shorttermScoreErrorMultiplier: number;
  outputScaleMultiplier: number;
}

export interface ParsedModel {
  modelName: string;
  modelVersion: number;
  numInputChannels: number;
  numInputGlobalChannels: number;
  postProcessParams: PostProcessParams;
  policyOutChannels: number;
  scoreValueChannels: number;
  trunk: {
    numBlocks: number;
    trunkNumChannels: number;
    conv1: ParsedConv2d;
    ginput: ParsedMatMul;
    blocks: ParsedTrunkBlock[];
    tipBN: ParsedBatchNorm;
    tipActivation: ActivationKind;
  };
  policy: {
    p1: ParsedConv2d;
    g1: ParsedConv2d;
    g1BN: ParsedBatchNorm;
    g1Activation: ActivationKind;
    gpoolToBias: ParsedMatMul;
    p1BN: ParsedBatchNorm;
    p1Activation: ActivationKind;
    p2: ParsedConv2d;
    passMul: ParsedMatMul;
  };
  value: {
    v1: ParsedConv2d;
    v1BN: ParsedBatchNorm;
    v1Activation: ActivationKind;
    v2: ParsedMatMul;
    v2Bias: ParsedMatBias;
    v2Activation: ActivationKind;
    v3: ParsedMatMul;
    v3Bias: ParsedMatBias;
    sv3: ParsedMatMul;
    sv3Bias: ParsedMatBias;
    ownership: ParsedConv2d;
  };
}

/** Parses an uncompressed `.bin` network. Throws on versions or layouts this port does not run. */
export function parseModel(data: Uint8Array): ParsedModel {
  const p = new KataGoBinModelParser(data);

  const modelName = p.readToken();
  const modelVersion = p.readInt();
  if (modelVersion < 8 || modelVersion > 14) throw new Error(`Unsupported modelVersion ${modelVersion}, supported 8..14`);
  const numInputChannels = p.readInt();
  const numInputGlobalChannels = p.readInt();
  if (numInputChannels !== 22 || numInputGlobalChannels !== 19) {
    throw new Error(`Unsupported input layout ${numInputChannels}/${numInputGlobalChannels}, expected 22/19`);
  }

  const postProcessParams: PostProcessParams =
    modelVersion >= 13
      ? {
          tdScoreMultiplier: p.readFloatAscii(),
          scoreMeanMultiplier: p.readFloatAscii(),
          scoreStdevMultiplier: p.readFloatAscii(),
          leadMultiplier: p.readFloatAscii(),
          varianceTimeMultiplier: p.readFloatAscii(),
          shorttermValueErrorMultiplier: p.readFloatAscii(),
          shorttermScoreErrorMultiplier: p.readFloatAscii(),
          outputScaleMultiplier: 1.0,
        }
      : {
          // Defaults for older models (ModelPostProcessParams).
          tdScoreMultiplier: 20.0,
          scoreMeanMultiplier: 20.0,
          scoreStdevMultiplier: 20.0,
          leadMultiplier: 20.0,
          varianceTimeMultiplier: 40.0,
          shorttermValueErrorMultiplier: 0.25,
          shorttermScoreErrorMultiplier: 30.0,
          outputScaleMultiplier: 1.0,
        };

  // trunk header
  p.readToken(); // trunk name
  const numBlocks = p.readInt();
  const trunkNumChannels = p.readInt();
  p.readInt(); // mid channels
  p.readInt(); // regular channels
  p.readInt(); // dilated channels (unused)
  p.readInt(); // gpool channels

  const conv1 = parseConv2d(p);
  const ginput = parseMatMul(p);

  function parseBlock(): ParsedTrunkBlock {
    const kindTok = p.readToken();
    if (kindTok === 'ordinary_block') {
      p.readToken(); // block name
      const preBN = parseBatchNormV8(p);
      const preActivation = parseActivationKind(p, modelVersion);
      const w1 = parseConv2d(p);
      const midBN = parseBatchNormV8(p);
      const midActivation = parseActivationKind(p, modelVersion);
      const w2 = parseConv2d(p);
      return { kind: 'ordinary', preBN, preActivation, w1, midBN, midActivation, w2 };
    }
    if (kindTok === 'gpool_block') {
      p.readToken(); // block name
      const preBN = parseBatchNormV8(p);
      const preActivation = parseActivationKind(p, modelVersion);
      const w1a = parseConv2d(p);
      const w1b = parseConv2d(p);
      const gpoolBN = parseBatchNormV8(p);
      const gpoolActivation = parseActivationKind(p, modelVersion);
      const w1r = parseMatMul(p);
      const midBN = parseBatchNormV8(p);
      const midActivation = parseActivationKind(p, modelVersion);
      const w2 = parseConv2d(p);
      return { kind: 'gpool', preBN, preActivation, w1a, w1b, gpoolBN, gpoolActivation, w1r, midBN, midActivation, w2 };
    }
    throw new Error(`Unsupported trunk block kind ${kindTok}`);
  }

  const blocks: ParsedTrunkBlock[] = [];
  for (let i = 0; i < numBlocks; i++) blocks.push(parseBlock());
  const tipBN = parseBatchNormV8(p);
  const tipActivation = parseActivationKind(p, modelVersion);

  // policy head
  p.readToken();
  const p1 = parseConv2d(p);
  const g1 = parseConv2d(p);
  const g1BN = parseBatchNormV8(p);
  const g1Activation = parseActivationKind(p, modelVersion);
  const gpoolToBias = parseMatMul(p);
  const p1BN = parseBatchNormV8(p);
  const p1Activation = parseActivationKind(p, modelVersion);
  const p2 = parseConv2d(p);
  const passMul = parseMatMul(p);

  // value head
  p.readToken();
  const v1 = parseConv2d(p);
  const v1BN = parseBatchNormV8(p);
  const v1Activation = parseActivationKind(p, modelVersion);
  const v2 = parseMatMul(p);
  const v2Bias = parseMatBias(p);
  const v2Activation = parseActivationKind(p, modelVersion);
  const v3 = parseMatMul(p);
  const v3Bias = parseMatBias(p);
  const sv3 = parseMatMul(p);
  const sv3Bias = parseMatBias(p);
  const ownership = parseConv2d(p);

  return {
    modelName,
    modelVersion,
    numInputChannels,
    numInputGlobalChannels,
    postProcessParams,
    policyOutChannels: p2.outChannels,
    scoreValueChannels: sv3.outChannels,
    trunk: { numBlocks, trunkNumChannels, conv1, ginput, blocks, tipBN, tipActivation },
    policy: { p1, g1, g1BN, g1Activation, gpoolToBias, p1BN, p1Activation, p2, passMul },
    value: { v1, v1BN, v1Activation, v2, v2Bias, v2Activation, v3, v3Bias, sv3, sv3Bias, ownership },
  };
}

/** True for gzip bytes (`1f 8b`). */
export function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * Inflates `.bin.gz` bytes with the platform's `DecompressionStream` (browsers, workers and Node 18+).
 * Plain `.bin` bytes are returned unchanged.
 */
export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(data)) return data;
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) throw new Error('DecompressionStream is not available');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
