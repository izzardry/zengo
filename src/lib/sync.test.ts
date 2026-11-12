import type { GameLog, HeadMsg, LogsMsg, Message, SavedGame, Scoring, Seat } from './types';
import zigo from './zigo';
import {
  acceptLog,
  appendPly,
  applyMoveMsg,
  bothAccepted,
  colorOf,
  colorOfPly,
  commonPrefix,
  compareLogs,
  compareScoring,
  currentLog,
  endLog,
  fromBase64Url,
  gamePoints,
  generateKey,
  generateNonce,
  hashLog,
  hashString,
  headPliesHash,
  isValidKey,
  logToGame,
  logToSaved,
  makeHead,
  makeLogs,
  markLog,
  mergeLogs,
  newLog,
  pliesHash,
  proofMessage,
  proveSeat,
  randomBytes,
  reconcile,
  rematchLog,
  resumeLog,
  roomGameId,
  roomScore,
  roundTwoEnd,
  savedToLog,
  scoreEnd,
  scoredResult,
  scoreView,
  seatOf,
  seatToMove,
  sortLogs,
  takebackLog,
  toBase64Url,
  turnOf,
  validateLog,
  verifySeat,
  type LogEnd,
  type LogSettings,
} from './sync';

/* ---------------------------------------------------------------------------------------------- */
/* Fixtures (9×9 unless said otherwise)                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** A deterministic rng (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Eight quiet plies, no captures. */
const LINE_A = ['cc', 'gg', 'cg', 'gc', 'ee', 'dd', 'ed', 'de'];
/** Four other quiet plies. */
const LINE_B = ['dd', 'ff', 'df', 'fd'];
/** Another opening. */
const LINE_C = ['ee', 'ce', 'ec', 'gg'];
/** One stone each, then two passes: the game is in scoring (or resumed, without `scoring`). */
const PASSED = ['cc', 'gg', 'tt', 'tt'];
/** A ko: Black captures at `ee`; White's immediate retake at `de` is illegal. */
const KO = ['dd', 'ed', 'ce', 'fe', 'df', 'ef', 'aa', 'de', 'ee'];

const B_RESIGNS: LogEnd = { result: { winner: 'W', by: 'resign' }, by: 'resign' };
const W_RESIGNS: LogEnd = { result: { winner: 'B', by: 'resign' }, by: 'resign' };
const B_ON_TIME: LogEnd = { result: { winner: 'B', by: 'time' }, by: 'time' };
const W_ON_TIME: LogEnd = { result: { winner: 'W', by: 'time' }, by: 'time' };

/** A scoring state with `rev`, `dead` and `accepted`. */
const S = (rev: number, dead: string[] = [], accepted: [number, number] = [0, 0], round: 1 | 2 = 1): Scoring => ({ round, rev, dead, accepted });

type LogOpts = {
  epoch?: number;
  black?: Seat;
  tc?: string | null;
  end?: LogEnd;
  ms?: number[];
  scoring?: Scoring;
  settings?: Partial<LogSettings>;
};

/** A log of game `n` with the given plies; each ply's ms is 1000 + index unless given. */
function log(n: number, moves: string[], o: LogOpts = {}): GameLog {
  const l: GameLog = {
    ...newLog(n, o.black ?? (n % 2 === 1 ? 0 : 1), o.tc === undefined ? null : o.tc, { size: 9, rules: 'area', handicap: 0, ...o.settings }),
    epoch: o.epoch ?? 0,
    plies: moves.map((m, i) => ({ m, ms: o.ms?.[i] ?? 1000 + i })),
  };
  if (o.scoring) l.scoring = o.scoring;
  if (o.end) l.end = o.end;
  // Normalize through validation so fixtures are canonical, as stored logs are.
  const v = validateLog(l);
  if (!v.ok) throw new Error(`bad fixture: ${v.error}`);
  return v.log;
}

/** The PASSED game in scoring at `rev` with `dead`, ended by score when both accepted. */
function scored(n: number, dead: string[] = [], o: LogOpts = {}): GameLog {
  const open = log(n, PASSED, { ...o, scoring: S(1, dead, [1, 1]) });
  return endLog(open, scoreEnd(open)!);
}

/** A finished room history: games 1..k-1 finished (Black resigned), game k as given. */
function room(current: GameLog, finished = current.n - 1): GameLog[] {
  const out: GameLog[] = [];
  for (let n = 1; n <= finished; n++) out.push(log(n, LINE_A.slice(0, 4), { end: B_RESIGNS }));
  out.push(current);
  return out;
}

const wire = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

interface Device {
  seat: Seat;
  logs: GameLog[];
  toasts: number;
  errors: number;
  adopted: number;
}

/**
 * Runs the reconcile protocol between two devices until no message is left: both send `head`,
 * every `send` goes out as a `logs` message (through JSON), every `adopt` is merged.
 * `order` picks which inbox is served next: alternating, one side first, or seeded random.
 */
function simulate(
  a: { seat: Seat; logs: GameLog[] },
  b: { seat: Seat; logs: GameLog[] },
  order: 'alternate' | 'a-first' | 'b-first' | number = 'alternate',
) {
  const dev: Device[] = [
    { seat: a.seat, logs: sortLogs(a.logs), toasts: 0, errors: 0, adopted: 0 },
    { seat: b.seat, logs: sortLogs(b.logs), toasts: 0, errors: 0, adopted: 0 },
  ];
  const inbox: Message[][] = [[wire(makeHead(currentLog(dev[1].logs)))], [wire(makeHead(currentLog(dev[0].logs)))]];
  const rng = typeof order === 'number' ? seeded(order) : null;
  let turn = 0;
  let messages = 2;
  for (let step = 0; inbox[0].length || inbox[1].length; step++) {
    if (step > 40) throw new Error('reconcile does not settle');
    let i: number;
    if (!inbox[0].length) i = 1;
    else if (!inbox[1].length) i = 0;
    else if (rng) i = rng() < 0.5 ? 0 : 1;
    else if (order === 'a-first') i = 0;
    else if (order === 'b-first') i = 1;
    else i = turn++ % 2;
    const msg = inbox[i].shift()!;
    const d = dev[i];
    const res = reconcile(d.logs, msg as HeadMsg | LogsMsg, d.seat);
    if (res.adopt) {
      d.logs = mergeLogs(d.logs, res.adopt);
      d.adopted += res.adopt.length;
    }
    if (res.forked) d.toasts++;
    if (res.status === 'invalid') d.errors++;
    if (res.send) {
      inbox[1 - i].push(wire(makeLogs(res.send)));
      messages++;
    }
  }
  return { a: dev[0], b: dev[1], messages };
}

const ORDERS = ['alternate', 'a-first', 'b-first', 1, 2, 3, 4, 5] as const;

/* ---------------------------------------------------------------------------------------------- */
/* Hashing and head                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

describe('hashing', () => {
  it('is stable and 16 hex digits', () => {
    expect(hashString('')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString('zigo')).toBe(hashString('zigo'));
    expect(hashString('zigo')).not.toBe(hashString('zigO'));
    // Pinned so that a change of the hash (a protocol change) is noticed.
    expect(hashString('zigo')).toMatchInlineSnapshot(`"4bacb2cdfe451073"`);
  });

  it('covers n, epoch, black, tc, settings, points and times, but neither scoring nor the end in pliesHash', () => {
    const base = log(1, LINE_A);
    const h = pliesHash(base);
    expect(pliesHash({ ...base, n: 2 })).not.toBe(h);
    expect(pliesHash({ ...base, epoch: 1 })).not.toBe(h);
    expect(pliesHash({ ...base, black: 1 })).not.toBe(h);
    expect(pliesHash({ ...base, tc: '5+0' })).not.toBe(h);
    expect(pliesHash({ ...base, size: 13 })).not.toBe(h);
    expect(pliesHash({ ...base, rules: 'territory' })).not.toBe(h);
    expect(pliesHash({ ...base, handicap: 2 })).not.toBe(h);
    expect(pliesHash(log(1, LINE_A, { ms: [1, 2, 3, 4, 5, 6, 7, 8] }))).not.toBe(h);
    expect(pliesHash(log(1, [...LINE_A.slice(0, 7), 'ff']))).not.toBe(h);
    expect(pliesHash({ ...base, end: B_RESIGNS })).toBe(h);
    const p = log(1, PASSED);
    expect(pliesHash({ ...p, scoring: S(3, ['gg']) })).toBe(pliesHash(p));
  });

  it('pliesHash of a prefix equals the hash of the shorter log', () => {
    const long = log(3, LINE_A, { epoch: 2 });
    for (let k = 0; k <= LINE_A.length; k++) {
      expect(pliesHash(long, k)).toBe(pliesHash(log(3, LINE_A.slice(0, k), { epoch: 2 })));
    }
  });

  it('hashLog adds the scoring state and the end; headPliesHash strips them', () => {
    const open = log(1, LINE_B);
    const done = endLog(open, W_RESIGNS);
    expect(hashLog(open)).toBe(pliesHash(open));
    expect(hashLog(done)).toBe(`${pliesHash(open)}.B+resign`);
    expect(headPliesHash(hashLog(done))).toBe(pliesHash(open));
    expect(hashLog(endLog(open, W_RESIGNS))).not.toBe(hashLog(endLog(open, B_RESIGNS)));
    const scoring = log(1, PASSED, { scoring: S(1, ['gg'], [1, 0]) });
    const resumed = log(1, PASSED);
    expect(headPliesHash(hashLog(scoring))).toBe(pliesHash(resumed));
    expect(hashLog(scoring)).not.toBe(hashLog(resumed));
    for (const other of [S(2, ['gg'], [1, 0]), S(1, [], [1, 0]), S(1, ['gg'], [1, 1])]) {
      expect(hashLog(log(1, PASSED, { scoring: other }))).not.toBe(hashLog(scoring));
    }
    expect(hashLog(scored(1))).toMatch(/\.W\+score\d+$/);
  });

  it('makeHead summarizes the current game', () => {
    const l = endLog(log(2, LINE_B, { epoch: 1 }), W_RESIGNS);
    expect(makeHead(l)).toEqual({ t: 'head', v: 1, n: 2, epoch: 1, len: 4, hash: hashLog(l), ended: true });
    expect(makeHead(log(1, LINE_B), 1234.6)).toMatchObject({ ended: false, turnMs: 1235 });
    expect(makeHead(undefined)).toEqual({ t: 'head', v: 1, n: 0, epoch: 0, len: 0, hash: '', ended: false });
    expect('turnMs' in makeHead(log(1, LINE_B), NaN)).toBe(false);
  });

  it('makeLogs sorts oldest first and drops duplicates', () => {
    const msg = makeLogs([log(3, []), log(1, []), log(2, [])]);
    expect(msg.t).toBe('logs');
    expect(msg.v).toBe(1);
    expect(msg.games.map((g) => g.n)).toEqual([1, 2, 3]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Validation                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

describe('validateLog', () => {
  const ok = (raw: unknown) => {
    const v = validateLog(raw);
    if (!v.ok) throw new Error(v.error);
    return v;
  };
  const base = { n: 1, epoch: 0, black: 0, tc: null, size: 9, rules: 'area', handicap: 0, plies: [] as { m: string; ms: number }[] };
  const P = (ms: string[]) => ms.map((m) => ({ m, ms: 0 }));
  const passedScoring = (scoring: unknown, end?: unknown) => ({ ...base, plies: P(PASSED), scoring, ...(end ? { end } : {}) });

  it.each([
    ['null', null],
    ['a string', 'log'],
    ['n = 0', { ...base, n: 0 }],
    ['fractional n', { ...base, n: 1.5 }],
    ['negative epoch', { ...base, epoch: -1 }],
    ['seat 2', { ...base, black: 2 }],
    ['a white field instead of black', { n: 1, epoch: 0, white: 0, tc: null, size: 9, rules: 'area', handicap: 0, plies: [] }],
    ['bad tc', { ...base, tc: 'fast' }],
    ['missing tc', { n: 1, epoch: 0, black: 0, size: 9, rules: 'area', handicap: 0, plies: [] }],
    ['size 10', { ...base, size: 10 }],
    ['missing size', { ...base, size: undefined }],
    ['unknown rules', { ...base, rules: 'chinese' }],
    ['handicap 1', { ...base, handicap: 1 }],
    ['handicap 6 on 9×9', { ...base, handicap: 6 }],
    ['plies not a list', { ...base, plies: {} }],
    ['ply not an object', { ...base, plies: ['cc'] }],
    ['not two SGF letters', { ...base, plies: [{ m: 'D4', ms: 0 }] }],
    ['a point off a 9×9 board', { ...base, plies: [{ m: 'kk', ms: 0 }] }],
    ['negative ms', { ...base, plies: [{ m: 'cc', ms: -1 }] }],
    ['NaN ms', { ...base, plies: [{ m: 'cc', ms: NaN }] }],
    ['an occupied point', { ...base, plies: P(['cc', 'cc']) }],
    ['suicide', { ...base, plies: P(['ba', 'ii', 'ab', 'aa']) }],
    ['a ko retake', { ...base, plies: P([...KO, 'de']) }],
    ['unknown winner', { ...base, end: { result: { winner: 'X', by: 'resign' }, by: 'resign' } }],
    ['unknown termination', { ...base, end: { result: { winner: 'B', by: 'abandon' }, by: 'abandon' } }],
    ['a result string instead of an object', { ...base, end: { result: '1-0', by: 'resign' } }],
    ['by differs from the result', { ...base, end: { result: { winner: 'B', by: 'resign' }, by: 'time' } }],
    ['a resignation with a margin', { ...base, end: { result: { winner: 'B', by: 'resign', margin: 3 }, by: 'resign' } }],
    ['a scored end without a margin', passedScoring(S(1, [], [1, 1]), { result: { winner: 'W', by: 'score' }, by: 'score' })],
    ['a scored end without scoring', { ...base, plies: P(PASSED), end: { result: { winner: 'W', by: 'score', margin: 15 }, by: 'score' } }],
    ['a scored end with another margin', passedScoring(S(1, [], [1, 1]), { result: { winner: 'W', by: 'score', margin: 13 }, by: 'score' })],
    ['a scored end with the wrong winner', passedScoring(S(1, ['gg'], [1, 1]), { result: { winner: 'W', by: 'score', margin: 15 }, by: 'score' })],
    ['scoring without two passes', { ...base, plies: P(LINE_B), scoring: S(0) }],
    ['scoring with an empty dead point', passedScoring(S(1, ['ee']))],
    ['scoring with a bad round', passedScoring({ ...S(1), round: 3 })],
    ['scoring with a negative rev', passedScoring({ ...S(1), rev: -1 })],
    ['an acceptance above the rev', passedScoring(S(1, [], [2, 0]))],
    ['acceptances not a pair', passedScoring({ ...S(1), accepted: [0] })],
  ])('rejects %s', (_label, raw) => {
    expect(validateLog(raw).ok).toBe(false);
  });

  it('accepts a log and returns a fresh normalized copy with the game', () => {
    const raw = { ...base, tc: '5+3', plies: [{ m: 'cc', ms: 1200.4 }, { m: 'gg', ms: 0 }] };
    const v = ok(raw);
    expect(v.log).toEqual({ n: 1, epoch: 0, black: 0, tc: '5+3', size: 9, rules: 'area', handicap: 0, plies: [{ m: 'cc', ms: 1200 }, { m: 'gg', ms: 0 }] });
    expect(v.log).not.toBe(raw);
    expect(v.game.plies).toHaveLength(2);
    expect(v.game.turn).toBe('B');
  });

  it('replays captures and passes and keeps a legal ko capture', () => {
    const v = ok({ ...base, plies: P([...KO, 'tt', 'ff']) });
    expect(v.game.prisoners.B).toBe(1);
    expect(v.log.plies.map((p) => p.m)).toEqual([...KO, 'tt', 'ff']);
  });

  it('plays a handicap game with White first, on 13×13 and 19×19', () => {
    for (const size of [13, 19] as const) {
      const v = ok({ ...base, size, handicap: 4, plies: P(['kk', 'cc']) });
      expect(v.game.settings).toMatchObject({ size, handicap: 4, komi2: 1 });
      expect(v.game.turn).toBe('W');
    }
  });

  it('a double pass with scoring is in scoring; without it, it was resumed', () => {
    const inScoring = ok(passedScoring({ round: 2, rev: 2, dead: ['gg', 'gg'], accepted: [2, 0] }));
    expect(inScoring.log.scoring).toEqual({ round: 1, rev: 2, dead: ['gg'], accepted: [2, 0] }); // round from the plies
    expect(inScoring.game.scoring?.dead).toEqual(['gg']);
    const resumed = ok({ ...base, plies: P(PASSED) });
    expect(resumed.log.scoring).toBeUndefined();
    expect(resumed.game.scoring).toBeUndefined();
    expect(resumed.game.turn).toBe('B');
    // A ply after a double pass resumes by itself; the next double pass is round 2.
    const round2 = ok({ ...base, plies: P([...PASSED, 'ee', 'tt', 'tt']), scoring: S(0) });
    expect(round2.log.scoring?.round).toBe(2);
  });

  it('accepts manual endings and the scored end that matches the marking', () => {
    for (const end of [B_RESIGNS, W_RESIGNS, B_ON_TIME, W_ON_TIME]) {
      const v = ok({ ...base, plies: [{ m: 'cc', ms: 0 }], end });
      expect(v.log.end).toEqual(end);
      expect(v.game.end).toEqual({ result: end.result });
    }
    const g = log(1, PASSED, { scoring: S(1, ['gg'], [1, 1]) });
    const res = scoredResult(logToGame(g), ['gg']);
    expect(res).toMatchObject({ winner: 'B', by: 'score' });
    const v = ok({ ...g, end: { result: res, by: 'score' } });
    expect(v.log.end?.result).toEqual(res);
    expect(v.game.end?.result).toEqual(res);
    expect(v.game.scoring?.dead).toEqual(['gg']);
  });

  it('a resignation during scoring keeps the marking', () => {
    const v = ok(passedScoring(S(2, ['gg']), B_RESIGNS));
    expect(v.log.scoring?.rev).toBe(2);
    expect(v.log.end).toEqual(B_RESIGNS);
  });

  it('logToGame replays or throws', () => {
    expect(logToGame(log(1, LINE_A)).board).toEqual(zigo.replay(logToGame(log(1, [])).settings, LINE_A).board);
    expect(() => logToGame({ ...log(1, []), plies: [{ m: 'cc', ms: 0 }, { m: 'cc', ms: 0 }] })).toThrow(/Invalid game log/);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* compareLogs: rules 2–6                                                                           */
/* ---------------------------------------------------------------------------------------------- */

describe('compareLogs (rules 2–6)', () => {
  const L = (moves: string[], o: LogOpts = {}) => log(1, moves, o);
  const rows: {
    rule: string;
    a: GameLog;
    b: GameLog;
    /** Winner when `a` belongs to seat 0 and `b` to seat 1. */
    win: 'a' | 'b' | 'same';
    fork: boolean;
    no: 0 | 2 | 3 | 4 | 5 | 6;
  }[] = [
    { rule: 'identical', a: L(LINE_A), b: L(LINE_A), win: 'same', fork: false, no: 0 },
    { rule: 'identical, both finished alike', a: L(LINE_B, { end: B_ON_TIME }), b: L(LINE_B, { end: B_ON_TIME }), win: 'same', fork: false, no: 0 },
    { rule: 'identical, both scoring alike', a: L(PASSED, { scoring: S(2, ['gg'], [2, 0]) }), b: L(PASSED, { scoring: S(2, ['gg'], [2, 0]) }), win: 'same', fork: false, no: 0 },
    { rule: '2: higher epoch wins though shorter', a: L(LINE_A.slice(0, 3), { epoch: 1 }), b: L(LINE_A), win: 'a', fork: false, no: 2 },
    { rule: '2: higher epoch wins though unfinished', a: L(LINE_A, { end: B_RESIGNS }), b: L(LINE_A.slice(0, 2), { epoch: 3 }), win: 'b', fork: false, no: 2 },
    { rule: '2: higher epoch wins though different', a: L(LINE_B, { epoch: 2 }), b: L(LINE_A, { epoch: 1 }), win: 'a', fork: false, no: 2 },
    { rule: '3: longer prefix wins', a: L(LINE_A.slice(0, 5)), b: L(LINE_A), win: 'b', fork: false, no: 3 },
    { rule: '3: longer prefix wins (other side)', a: L(LINE_A), b: L(LINE_A.slice(0, 1)), win: 'a', fork: false, no: 3 },
    { rule: '3: longer finished prefix wins', a: L(LINE_A.slice(0, 2)), b: L(LINE_A, { end: W_RESIGNS }), win: 'b', fork: false, no: 3 },
    { rule: '3: from the empty log', a: L([]), b: L(['cc']), win: 'b', fork: false, no: 3 },
    { rule: '3: a pass continues the game', a: L(PASSED.slice(0, 3)), b: L(PASSED, { scoring: S(0) }), win: 'b', fork: false, no: 3 },
    { rule: '4: equal length, different points', a: L(LINE_B), b: L(LINE_A.slice(0, 4)), win: 'a', fork: true, no: 4 },
    { rule: '4: equal length, a pass against a stone', a: L(['cc', 'tt']), b: L(['cc', 'gg']), win: 'a', fork: true, no: 4 },
    { rule: '4: equal length, different times', a: L(LINE_B), b: L(LINE_B, { ms: [5, 5, 5, 5] }), win: 'a', fork: true, no: 4 },
    { rule: '4: different lengths, not a prefix', a: L(LINE_B.slice(0, 2)), b: L(LINE_A), win: 'a', fork: true, no: 4 },
    { rule: '4: both finished, different ends', a: L(LINE_B, { end: B_RESIGNS }), b: L(LINE_B, { end: B_ON_TIME }), win: 'a', fork: true, no: 4 },
    { rule: '4: both finished, different lengths', a: L(LINE_B.slice(0, 3), { end: W_RESIGNS }), b: L(LINE_B, { end: B_ON_TIME }), win: 'a', fork: true, no: 4 },
    { rule: '4: different colors', a: L(LINE_B, { black: 0 }), b: L(LINE_B, { black: 1 }), win: 'a', fork: true, no: 4 },
    { rule: '4: different time control', a: L(LINE_B, { tc: '5+0' }), b: L(LINE_B, { tc: '3+2' }), win: 'a', fork: true, no: 4 },
    { rule: '4: different size', a: L(LINE_B), b: L(LINE_B, { settings: { size: 13 } }), win: 'a', fork: true, no: 4 },
    { rule: '4: different rules', a: L(LINE_B), b: L(LINE_B, { settings: { rules: 'territory' } }), win: 'a', fork: true, no: 4 },
    { rule: '4: same rev, different dead stones', a: L(PASSED, { scoring: S(2, ['gg']) }), b: L(PASSED, { scoring: S(2, ['cc']) }), win: 'a', fork: true, no: 4 },
    { rule: '4: crossing acceptances', a: L(PASSED, { scoring: S(1, [], [1, 0]) }), b: L(PASSED, { scoring: S(1, [], [0, 1]) }), win: 'a', fork: true, no: 4 },
    { rule: '5: finished beats unfinished, same length', a: L(LINE_B), b: L(LINE_B, { end: B_RESIGNS }), win: 'b', fork: false, no: 5 },
    { rule: '5: finished beats a longer unfinished continuation', a: L(LINE_B.slice(0, 2), { end: B_ON_TIME }), b: L(LINE_B), win: 'a', fork: false, no: 5 },
    { rule: '5: a scored end beats the open scoring', a: L(PASSED, { scoring: S(3, ['gg']) }), b: scored(1), win: 'b', fork: false, no: 5 },
    { rule: '6: the higher rev wins', a: L(PASSED, { scoring: S(1) }), b: L(PASSED, { scoring: S(2, ['gg']) }), win: 'b', fork: false, no: 6 },
    { rule: '6: a resume beats the scoring it left', a: L(PASSED), b: L(PASSED, { scoring: S(4, ['gg'], [4, 0]) }), win: 'a', fork: false, no: 6 },
    { rule: '6: an acceptance that reached one side only', a: L(PASSED, { scoring: S(1, ['gg'], [1, 1]) }), b: L(PASSED, { scoring: S(1, ['gg'], [1, 0]) }), win: 'a', fork: false, no: 6 },
  ];

  it.each(rows)('$rule', ({ a, b, win, fork, no }) => {
    // From seat 0 (a) and from seat 1 (b): the verdicts mirror each other.
    const fromA = compareLogs(a, b, 0);
    const fromB = compareLogs(b, a, 1);
    const map = { a: 'local', b: 'remote', same: 'same' } as const;
    const mirror = { a: 'remote', b: 'local', same: 'same' } as const;
    expect(fromA).toEqual({ winner: map[win], fork, rule: no });
    expect(fromB).toEqual({ winner: mirror[win], fork, rule: no });
    if (!fork) {
      // Without a fork the seats do not matter.
      expect(compareLogs(a, b, 1).winner).toBe(map[win]);
    } else {
      // In a fork seat 0's copy wins, whoever holds which copy.
      expect(compareLogs(a, b, 1)).toEqual({ winner: 'remote', fork: true, rule: 4 });
      expect(compareLogs(b, a, 0)).toEqual({ winner: 'local', fork: true, rule: 4 });
    }
  });

  it('commonPrefix compares points and times', () => {
    expect(commonPrefix(L(LINE_A).plies, L(LINE_A.slice(0, 3)).plies)).toBe(3);
    expect(commonPrefix(L(LINE_B).plies, L(LINE_A).plies)).toBe(0);
    expect(commonPrefix(L(LINE_B).plies, L(LINE_B, { ms: [1000, 1001, 9, 9] }).plies)).toBe(2);
  });

  it('compareScoring orders resumed, rev, dead stones and acceptances', () => {
    expect(compareScoring(undefined, undefined)).toBe(0);
    expect(compareScoring(undefined, S(1))).toBe(1);
    expect(compareScoring(S(1), undefined)).toBe(-1);
    expect(compareScoring(S(2), S(1, ['gg']))).toBe(1);
    expect(compareScoring(S(2, ['cc']), S(2, ['gg']))).toBeNull();
    expect(compareScoring(S(2, ['gg'], [2, 2]), S(2, ['gg'], [2, 0]))).toBe(1);
    expect(compareScoring(S(2, ['gg'], [0, 2]), S(2, ['gg'], [2, 0]))).toBeNull();
    expect(compareScoring(S(2, ['gg'], [2, 0]), S(2, ['gg'], [2, 0]))).toBe(0);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* reconcile with a head                                                                            */
/* ---------------------------------------------------------------------------------------------- */

describe('reconcile with a head', () => {
  const g = (moves: string[], o: LogOpts = {}, n = 1) => log(n, moves, o);
  type Row = {
    rule: string;
    local: GameLog[];
    remote: GameLog | undefined;
    seat: Seat;
    status: string;
    /** Game numbers sent, or undefined for none. */
    send?: number[];
  };
  const rows: Row[] = [
    { rule: 'both empty (no game yet)', local: [], remote: undefined, seat: 0, status: 'in-sync' },
    { rule: 'identical', local: [g(LINE_A)], remote: g(LINE_A), seat: 1, status: 'in-sync' },
    { rule: 'identical in scoring', local: [g(PASSED, { scoring: S(1, ['gg']) })], remote: g(PASSED, { scoring: S(1, ['gg']) }), seat: 0, status: 'in-sync' },
    { rule: '1: remote has a higher n', local: room(g(LINE_B, {}, 2)), remote: g([], {}, 3), seat: 0, status: 'behind' },
    { rule: '1: local has a higher n, sends from the remote n on', local: room(g(LINE_B, {}, 4)), remote: g(['cc'], {}, 2), seat: 1, status: 'ahead', send: [2, 3, 4] },
    { rule: '1: remote has nothing (newcomer head)', local: room(g(LINE_B, {}, 3)), remote: undefined, seat: 0, status: 'ahead', send: [1, 2, 3] },
    { rule: '1: local has nothing', local: [], remote: g(LINE_B), seat: 1, status: 'behind' },
    { rule: '2: remote epoch higher', local: [g(LINE_A)], remote: g(LINE_A.slice(0, 2), { epoch: 1 }), seat: 0, status: 'behind' },
    { rule: '2: local epoch higher', local: [g(LINE_A.slice(0, 2), { epoch: 1 })], remote: g(LINE_A), seat: 1, status: 'ahead', send: [1] },
    { rule: '3: local longer, remote a prefix', local: [g(LINE_A)], remote: g(LINE_A.slice(0, 7)), seat: 1, status: 'ahead', send: [1] },
    { rule: '3: local shorter (seat 0 waits)', local: [g(LINE_A.slice(0, 7))], remote: g(LINE_A), seat: 0, status: 'behind' },
    { rule: '3: local shorter (seat 1 also sends, to expose a fork)', local: [g(LINE_A.slice(0, 7))], remote: g(LINE_A), seat: 1, status: 'behind', send: [1] },
    { rule: '4: equal length, different plies (seat 0)', local: [g(LINE_B)], remote: g(LINE_A.slice(0, 4)), seat: 0, status: 'fork', send: [1] },
    { rule: '4: equal length, different plies (seat 1)', local: [g(LINE_B)], remote: g(LINE_A.slice(0, 4)), seat: 1, status: 'fork', send: [1] },
    { rule: '4: local longer, not a prefix', local: [g(LINE_A)], remote: g(LINE_B), seat: 1, status: 'fork', send: [1] },
    { rule: '4: same plies, different ends', local: [g(LINE_B, { end: W_RESIGNS })], remote: g(LINE_B, { end: B_ON_TIME }), seat: 0, status: 'fork', send: [1] },
    { rule: '4: local longer finished, remote shorter finished', local: [g(LINE_B, { end: B_ON_TIME })], remote: g(LINE_B.slice(0, 2), { end: B_ON_TIME }), seat: 1, status: 'fork', send: [1] },
    { rule: '4: local shorter finished, remote longer finished', local: [g(LINE_B.slice(0, 2), { end: B_ON_TIME })], remote: g(LINE_B, { end: B_ON_TIME }), seat: 0, status: 'fork', send: [1] },
    { rule: '5: local finished, remote not, same length', local: [g(LINE_B, { end: B_RESIGNS })], remote: g(LINE_B), seat: 1, status: 'ahead', send: [1] },
    { rule: '5: remote finished, local not, same length', local: [g(LINE_B)], remote: g(LINE_B, { end: B_RESIGNS }), seat: 0, status: 'behind' },
    { rule: '5: local finished prefix, remote longer unfinished', local: [g(LINE_B.slice(0, 2), { end: W_RESIGNS })], remote: g(LINE_B), seat: 1, status: 'ahead', send: [1] },
    { rule: '5: remote finished prefix, local longer unfinished', local: [g(LINE_B)], remote: g(LINE_B.slice(0, 2), { end: W_RESIGNS }), seat: 0, status: 'behind' },
    { rule: '6: same plies, another rev: both send', local: [g(PASSED, { scoring: S(1) })], remote: g(PASSED, { scoring: S(2, ['gg']) }), seat: 0, status: 'fork', send: [1] },
    { rule: '6: same plies, resumed against scoring: both send', local: [g(PASSED)], remote: g(PASSED, { scoring: S(1) }), seat: 1, status: 'fork', send: [1] },
  ];

  it.each(rows)('$rule', ({ local, remote, seat, status, send }) => {
    const r = reconcile(local, wire(makeHead(remote)), seat);
    expect(r.status).toBe(status);
    expect(r.forked).toBe(false); // a head never reports a fork
    expect(r.adopt).toBeUndefined(); // nothing is adopted from a head
    expect(r.send?.map((l) => l.n)).toEqual(send);
  });

  it.each([
    ['a negative n', { n: -1 }],
    ['a fractional len', { len: 1.5 }],
    ['a missing hash', { hash: undefined }],
    ['a non-boolean ended', { ended: 'yes' }],
  ])('rejects a head with %s', (_label, change) => {
    const head = { ...makeHead(g(LINE_A)), ...change } as unknown as HeadMsg;
    expect(reconcile([g(LINE_A)], head, 0)).toEqual({ status: 'invalid', forked: false, error: 'bad head' });
  });

  it('accepts a head with turnMs and ignores it for the decision', () => {
    const r = reconcile([g(LINE_A)], { ...makeHead(g(LINE_A)), turnMs: 5000 }, 0);
    expect(r.status).toBe('in-sync');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* reconcile with logs                                                                              */
/* ---------------------------------------------------------------------------------------------- */

describe('reconcile with logs', () => {
  it('adopts the winning copy, validated and normalized', () => {
    const local = [log(1, LINE_A.slice(0, 3))];
    const remote = wire(makeLogs([log(1, LINE_A)]));
    const r = reconcile(local, remote, 1);
    expect(r).toMatchObject({ status: 'behind', forked: false, rule: 3 });
    expect(r.adopt).toEqual([log(1, LINE_A)]);
    expect(r.send).toBeUndefined();
  });

  it('accepts a plain list of games as from a grant', () => {
    const games = room(log(3, LINE_B));
    const r = reconcile([], wire(games), 1);
    expect(r.status).toBe('behind');
    expect(r.adopt?.map((l) => l.n)).toEqual([1, 2, 3]);
  });

  it('sends its own copy back when it wins', () => {
    const r = reconcile([log(1, LINE_A)], makeLogs([log(1, LINE_A.slice(0, 2))]), 0);
    expect(r).toMatchObject({ status: 'ahead', forked: false });
    expect(r.send).toEqual([log(1, LINE_A)]);
    expect(r.adopt).toBeUndefined();
  });

  it('does nothing for an identical copy', () => {
    const r = reconcile([log(1, LINE_A)], makeLogs([log(1, LINE_A)]), 0);
    expect(r).toEqual({ status: 'in-sync', forked: false, rule: 0 });
  });

  it('reports a fork on seat 0 (keeps its copy, sends it) and on seat 1 (adopts)', () => {
    const r0 = reconcile([log(1, LINE_B)], makeLogs([log(1, LINE_A.slice(0, 4))]), 0);
    expect(r0).toMatchObject({ status: 'ahead', forked: true, rule: 4, send: [log(1, LINE_B)] });
    expect(r0.adopt).toBeUndefined();
    const r1 = reconcile([log(1, LINE_A.slice(0, 4))], makeLogs([log(1, LINE_B)]), 1);
    expect(r1).toMatchObject({ status: 'behind', forked: true, rule: 4, adopt: [log(1, LINE_B)] });
    expect(r1.send).toBeUndefined();
  });

  it('adopts the higher scoring rev without a fork (rule 6)', () => {
    const r = reconcile([log(1, PASSED, { scoring: S(1) })], makeLogs([log(1, PASSED, { scoring: S(2, ['gg']) })]), 0);
    expect(r).toMatchObject({ status: 'behind', forked: false, rule: 6 });
    expect(r.adopt?.[0].scoring).toEqual(S(2, ['gg']));
  });

  it('aborts on an illegal ply and adopts nothing', () => {
    const bad = { ...log(1, LINE_A), plies: [...log(1, LINE_A).plies, { m: 'cc', ms: 0 }] };
    const r = reconcile([log(1, LINE_A.slice(0, 2))], makeLogs([bad]), 1);
    expect(r.status).toBe('invalid');
    expect(r.error).toMatch(/game 1: illegal ply 8/);
    expect(r.adopt).toBeUndefined();
    expect(r.send).toBeUndefined();
  });

  it('aborts on a superko or ko violation in an adopted log', () => {
    const bad = { ...log(1, KO), plies: [...log(1, KO).plies, { m: 'de', ms: 0 }] };
    expect(reconcile([log(1, KO)], makeLogs([bad]), 1)).toMatchObject({ status: 'invalid', error: expect.stringMatching(/illegal ply 9: de/) });
  });

  it('aborts on one invalid game among several', () => {
    const games = [log(1, LINE_A, { end: W_RESIGNS }), { ...log(2, []), black: 7 } as unknown as GameLog];
    expect(reconcile([], makeLogs(games), 1).status).toBe('invalid');
    expect(reconcile([], { t: 'logs', v: 1, games: 'x' } as unknown as GameLog[], 1).status).toBe('invalid');
  });

  it('compares older games one by one and adopts or sends each', () => {
    const local = [log(1, LINE_A.slice(0, 4), { end: W_RESIGNS }), log(2, LINE_B.slice(0, 2), { end: B_RESIGNS }), log(3, ['cc'])];
    const remote = [log(1, LINE_A.slice(0, 2), { end: W_RESIGNS }), log(2, LINE_B.slice(0, 2), { end: B_RESIGNS }), log(3, ['cc', 'gg'])];
    // Game 1: both finished, different lengths: a fork that seat 0 (remote here) wins.
    const r = reconcile(local, makeLogs(remote), 1);
    expect(r.adopt?.map((l) => l.n)).toEqual([1, 3]);
    expect(r.forked).toBe(true);
    expect(r.status).toBe('behind');
    const r0 = reconcile(local, makeLogs(remote), 0);
    expect(r0.adopt?.map((l) => l.n)).toEqual([3]);
    expect(r0.send?.map((l) => l.n)).toEqual([1]);
    expect(r0.status).toBe('behind'); // the current game decides the status
  });

  it('sends the games the other side is missing when it is behind on n', () => {
    const local = room(log(3, ['cc']));
    const r = reconcile(local, makeLogs([log(2, LINE_A.slice(0, 4), { end: B_RESIGNS })]), 1);
    expect(r.status).toBe('ahead');
    expect(r.rule).toBe(1);
    expect(r.send?.map((l) => l.n)).toEqual([3]); // game 2 was the same, game 3 is missing
    const r2 = reconcile(local, makeLogs([]), 1);
    expect(r2.send?.map((l) => l.n)).toEqual([1, 2, 3]);
  });

  it('mergeLogs replaces by game number', () => {
    const merged = mergeLogs([log(1, []), log(2, ['cc'])], [log(2, ['cc', 'gg']), log(3, [])]);
    expect(merged.map((l) => [l.n, l.plies.length])).toEqual([[1, 0], [2, 2], [3, 0]]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* The whole exchange: every reconcile rule and every recovery case                                  */
/* ---------------------------------------------------------------------------------------------- */

describe('two devices reconcile', () => {
  type Case = {
    name: string;
    a: GameLog[]; // seat 0
    b: GameLog[]; // seat 1
    /** The logs both must end with. */
    expect: GameLog[];
    /** Whether both show the fork toast (exactly once each). */
    fork?: boolean;
  };
  const finished = (n: number, end: LogEnd = W_RESIGNS) => log(n, LINE_A.slice(0, 4), { end });

  const cases: Case[] = [
    // Both devices have the room.
    { name: 'both have the room, in sync', a: room(log(2, LINE_B)), b: room(log(2, LINE_B)), expect: room(log(2, LINE_B)) },
    // Rule 1 / older state: the behind side receives the finished games it missed and the current one.
    {
      name: 'rule 1: one device is several games behind (restored backup)',
      a: [finished(1), finished(2), finished(3, B_ON_TIME), log(4, LINE_B)],
      b: [finished(1), log(2, ['cc'])],
      expect: [finished(1), finished(2), finished(3, B_ON_TIME), log(4, LINE_B)],
    },
    {
      name: 'rule 1: seat 1 is ahead',
      a: [log(1, ['cc'])],
      b: [finished(1), log(2, LINE_B)],
      expect: [finished(1), log(2, LINE_B)],
    },
    // One device lost everything (its head has n = 0).
    { name: 'one device lost everything (seat 1 lost)', a: room(log(3, LINE_A)), b: [], expect: room(log(3, LINE_A)) },
    { name: 'one device lost everything (seat 0 lost)', a: [], b: room(log(2, LINE_B, { end: B_ON_TIME })), expect: room(log(2, LINE_B, { end: B_ON_TIME })) },
    // Both lost the room / neither has a game yet.
    { name: 'neither has a game', a: [], b: [], expect: [] },
    {
      name: 'neither has the next game yet (both at a finished game)',
      a: room(log(2, LINE_B, { end: W_RESIGNS })),
      b: room(log(2, LINE_B, { end: W_RESIGNS })),
      expect: room(log(2, LINE_B, { end: W_RESIGNS })),
    },
    {
      name: 'one side has the finished game, the other the same game unfinished (rule 5)',
      a: [log(1, LINE_B)],
      b: [log(1, LINE_B, { end: W_RESIGNS })],
      expect: [log(1, LINE_B, { end: W_RESIGNS })],
    },
    // Rule 2 / stale epochs.
    {
      name: 'rule 2: stale epoch with more plies loses to the takeback',
      a: [log(1, LINE_A, { epoch: 0 })],
      b: [log(1, LINE_A.slice(0, 5), { epoch: 1 })],
      expect: [log(1, LINE_A.slice(0, 5), { epoch: 1 })],
    },
    {
      name: 'rule 2: stale epoch, finished, loses to the newer epoch',
      a: [log(2, LINE_A.slice(0, 2), { epoch: 3 })],
      b: [finished(1), log(2, LINE_A, { epoch: 2, end: W_RESIGNS })],
      expect: [log(2, LINE_A.slice(0, 2), { epoch: 3 })],
    },
    // Rule 3: offline move delivered.
    { name: 'rule 3: an offline move reaches seat 0', a: [log(1, LINE_A.slice(0, 6))], b: [log(1, LINE_A.slice(0, 7))], expect: [log(1, LINE_A.slice(0, 7))] },
    { name: 'rule 3: an offline move reaches seat 1', a: [log(1, LINE_A.slice(0, 7))], b: [log(1, LINE_A.slice(0, 6))], expect: [log(1, LINE_A.slice(0, 7))] },
    { name: 'rule 3: an offline pass reaches seat 1', a: [log(1, ['cc', 'gg', 'tt'])], b: [log(1, ['cc', 'gg'])], expect: [log(1, ['cc', 'gg', 'tt'])] },
    { name: 'rule 3: a scored longer log reaches the other side', a: [log(1, PASSED.slice(0, 2))], b: [scored(1)], expect: [scored(1)] },
    // Rule 4: forks.
    { name: 'rule 4: equal length fork', a: [log(1, LINE_B)], b: [log(1, LINE_A.slice(0, 4))], expect: [log(1, LINE_B)], fork: true },
    { name: 'rule 4: seat 0 longer, not a prefix', a: [log(1, LINE_A)], b: [log(1, LINE_B)], expect: [log(1, LINE_A)], fork: true },
    { name: 'rule 4: seat 1 longer, not a prefix', a: [log(1, LINE_B)], b: [log(1, LINE_A)], expect: [log(1, LINE_B)], fork: true },
    { name: 'rule 4: different times only', a: [log(1, LINE_B)], b: [log(1, LINE_B, { ms: [1, 2, 3, 4] })], expect: [log(1, LINE_B)], fork: true },
    { name: 'rule 4: both finished with different ends', a: [log(1, LINE_B, { end: B_ON_TIME })], b: [log(1, LINE_B, { end: W_RESIGNS })], expect: [log(1, LINE_B, { end: B_ON_TIME })], fork: true },
    {
      name: 'rule 4: both finished at different lengths (seat 0 shorter)',
      a: [log(1, LINE_B.slice(0, 2), { end: B_RESIGNS })],
      b: [log(1, LINE_B, { end: B_ON_TIME })],
      expect: [log(1, LINE_B.slice(0, 2), { end: B_RESIGNS })],
      fork: true,
    },
    {
      name: 'rule 4: both finished at different lengths (seat 1 shorter)',
      a: [log(1, LINE_B, { end: B_ON_TIME })],
      b: [log(1, LINE_B.slice(0, 2), { end: B_RESIGNS })],
      expect: [log(1, LINE_B, { end: B_ON_TIME })],
      fork: true,
    },
    { name: 'rule 4: seat 1 finished shorter, seat 0 longer different', a: [log(1, LINE_A)], b: [log(1, LINE_B.slice(0, 2), { end: B_RESIGNS })], expect: [log(1, LINE_A)], fork: true },
    {
      name: 'rule 4: equal rev, different dead stones (DESIGN 9.2: seat 0 wins)',
      a: [log(1, PASSED, { scoring: S(2, ['gg']) })],
      b: [log(1, PASSED, { scoring: S(2, ['cc']) })],
      expect: [log(1, PASSED, { scoring: S(2, ['gg']) })],
      fork: true,
    },
    // Rule 5.
    { name: 'rule 5: finished beats unfinished (seat 0 finished)', a: [log(1, LINE_B, { end: B_ON_TIME })], b: [log(1, LINE_B)], expect: [log(1, LINE_B, { end: B_ON_TIME })] },
    { name: 'rule 5: finished beats unfinished (seat 1 finished)', a: [log(1, LINE_B)], b: [log(1, LINE_B, { end: W_RESIGNS })], expect: [log(1, LINE_B, { end: W_RESIGNS })] },
    {
      name: 'rule 5: an offline resignation beats a crossing offline move (seat 1 resigned)',
      a: [log(1, LINE_B.slice(0, 3))],
      b: [log(1, LINE_B.slice(0, 2), { end: W_RESIGNS })],
      expect: [log(1, LINE_B.slice(0, 2), { end: W_RESIGNS })],
    },
    {
      name: 'rule 5: an offline resignation beats a crossing offline move (seat 0 resigned)',
      a: [log(1, LINE_B.slice(0, 2), { end: B_RESIGNS })],
      b: [log(1, LINE_B.slice(0, 3))],
      expect: [log(1, LINE_B.slice(0, 2), { end: B_RESIGNS })],
    },
    { name: 'rule 5: the scored end beats the open marking', a: [log(1, PASSED, { scoring: S(1, [], [1, 0]) })], b: [scored(1)], expect: [scored(1)] },
    // Rule 6 (DESIGN 9.2): the higher rev wins.
    { name: 'rule 6: a toggle made offline by seat 1 wins', a: [log(1, PASSED, { scoring: S(1) })], b: [log(1, PASSED, { scoring: S(2, ['gg']) })], expect: [log(1, PASSED, { scoring: S(2, ['gg']) })] },
    { name: 'rule 6: a toggle made offline by seat 0 wins', a: [log(1, PASSED, { scoring: S(3, ['gg']) })], b: [log(1, PASSED, { scoring: S(2) })], expect: [log(1, PASSED, { scoring: S(3, ['gg']) })] },
    { name: 'rule 6: a resume wins over the scoring it left', a: [log(1, PASSED, { scoring: S(1, [], [1, 0]) })], b: [log(1, PASSED)], expect: [log(1, PASSED)] },
    { name: 'rule 6: a lost acceptance arrives', a: [log(1, PASSED, { scoring: S(1, [], [1, 0]) })], b: [log(1, PASSED, { scoring: S(1, [], [1, 1]) })], expect: [log(1, PASSED, { scoring: S(1, [], [1, 1]) })] },
  ];

  for (const c of cases) {
    it.each(ORDERS.map((o) => [o]))(`${c.name} (order %s)`, (order) => {
      const r = simulate({ seat: 0, logs: c.a }, { seat: 1, logs: c.b }, order);
      // Only the games from the behind side's current one on are exchanged, so compare from there.
      const want = sortLogs(c.expect);
      const fromN = Math.min(currentLog(c.a)?.n ?? 0, currentLog(c.b)?.n ?? 0);
      const tail = (ls: GameLog[]) => ls.filter((l) => l.n >= fromN);
      expect(currentLog(r.a.logs)).toEqual(currentLog(want));
      expect(currentLog(r.b.logs)).toEqual(currentLog(want));
      expect(tail(r.a.logs)).toEqual(tail(want));
      expect(tail(r.b.logs)).toEqual(tail(want));
      expect(r.a.toasts).toBe(c.fork ? 1 : 0);
      expect(r.b.toasts).toBe(c.fork ? 1 : 0);
      expect(r.a.errors + r.b.errors).toBe(0);
      expect(r.messages).toBeLessThanOrEqual(6);
      // A second connection finds both in sync at once.
      const again = simulate({ seat: 0, logs: r.a.logs }, { seat: 1, logs: r.b.logs }, order);
      expect(again.messages).toBe(2);
      expect(again.a.adopted + again.b.adopted).toBe(0);
    });
  }

  it('a device that lost everything is fully restored, finished games included', () => {
    const survivor = [finished(1), finished(2, B_ON_TIME), log(3, LINE_A.slice(0, 5))];
    const r = simulate({ seat: 0, logs: survivor }, { seat: 1, logs: [] });
    expect(r.b.logs).toEqual(survivor);
    expect(roomScore(r.b.logs)).toEqual(roomScore(survivor));
  });

  it('an invalid log from corrupt storage aborts the sync on the receiving side only', () => {
    const corrupt = { ...log(1, LINE_A), plies: [...log(1, LINE_A).plies, { m: 'cc', ms: 0 }] };
    const r = simulate({ seat: 0, logs: [corrupt] }, { seat: 1, logs: [log(1, LINE_A.slice(0, 3))] });
    expect(r.b.errors).toBeGreaterThan(0);
    expect(r.b.logs).toEqual([log(1, LINE_A.slice(0, 3))]);
  });

  it('settles random copies of the current game in every order (property check)', () => {
    const rng = seeded(42);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const lines = [LINE_A, LINE_B, PASSED, LINE_C];
    const ends: (LogEnd | undefined)[] = [undefined, undefined, B_RESIGNS, W_RESIGNS, B_ON_TIME];
    const randomLog = (n: number): GameLog => {
      const line = pick(lines);
      const k = Math.floor(rng() * (line.length + 1));
      const moves = line.slice(0, k);
      let scoring: Scoring | undefined;
      if (line === PASSED && k === PASSED.length && rng() < 0.75) {
        const rev = Math.floor(rng() * 3);
        const acc = (): number => (rng() < 0.5 ? rev : 0);
        scoring = S(rev, rev && rng() < 0.5 ? ['gg'] : [], [acc(), acc()]);
      }
      return log(n, moves, { epoch: Math.floor(rng() * 2), end: pick(ends), scoring, ms: moves.map(() => (rng() < 0.9 ? 7 : 8)) });
    };
    /** Both copies at the same double pass, differing only in their scoring state (rule 6). */
    const scoringLog = (n: number): GameLog => {
      const rev = Math.floor(rng() * 3);
      const acc = (): number => (rng() < 0.5 ? rev : 0);
      const scoring = rng() < 0.2 ? undefined : S(rev, rev && rng() < 0.5 ? ['gg'] : [], [acc(), acc()]);
      return log(n, PASSED, { end: rng() < 0.15 ? B_RESIGNS : undefined, scoring, ms: [7, 7, 7, 7] });
    };
    let forks = 0;
    let scoringRules = 0;
    for (let t = 0; t < 300; t++) {
      const n = 1 + Math.floor(rng() * 3);
      const shared = Array.from({ length: n - 1 }, (_, i) => finished(i + 1));
      const make = t % 3 === 0 ? scoringLog : randomLog;
      const a = [...shared, make(n)];
      const b = [...shared, make(n)];
      const r = simulate({ seat: 0, logs: a }, { seat: 1, logs: b }, t);
      expect(r.a.logs).toEqual(r.b.logs);
      // The survivor is one of the two copies, and it is the winner by compareLogs.
      const c = compareLogs(a[n - 1], b[n - 1], 0);
      const winner = c.winner === 'remote' ? b[n - 1] : a[n - 1];
      expect(currentLog(r.a.logs)).toEqual(winner);
      expect(r.a.toasts).toBe(r.b.toasts);
      expect(r.a.toasts).toBe(c.fork ? 1 : 0);
      forks += r.a.toasts;
      if (c.rule === 6) scoringRules++;
      expect(r.a.errors + r.b.errors).toBe(0);
      expect(r.messages).toBeLessThanOrEqual(6);
      const again = simulate({ seat: 0, logs: r.a.logs }, { seat: 1, logs: r.b.logs }, t);
      expect(again.messages).toBe(2);
    }
    expect(forks).toBeGreaterThan(10); // the generator does produce forks
    expect(scoringRules).toBeGreaterThan(0); // and scoring differences
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Live play                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

describe('live play on a log', () => {
  const msg = (n: number, epoch: number, i: number, m: string, ms = 500) => ({ n, epoch, i, m, ms });

  it('applies the next ply and acks duplicates', () => {
    const l = log(1, LINE_A.slice(0, 2), { epoch: 1 });
    const r = applyMoveMsg(l, msg(1, 1, 2, 'cg', 812.7));
    expect(r.kind).toBe('applied');
    if (r.kind !== 'applied') return;
    expect(r.log.plies[2]).toEqual({ m: 'cg', ms: 813 });
    expect(r.log.epoch).toBe(1);
    expect(l.plies).toHaveLength(2); // not mutated
    expect(applyMoveMsg(r.log, msg(1, 1, 2, 'cg', 813)).kind).toBe('duplicate');
    expect(applyMoveMsg(r.log, msg(1, 1, 0, 'cc', 1000)).kind).toBe('duplicate');
  });

  it('applies a pass', () => {
    const r = applyMoveMsg(log(1, ['cc']), msg(1, 0, 1, 'tt'));
    expect(r).toMatchObject({ kind: 'applied', log: { plies: [{ m: 'cc' }, { m: 'tt' }] } });
  });

  it.each([
    ['older game', msg(0, 0, 2, 'cg'), 'stale'],
    ['older epoch', msg(1, 0, 2, 'cg'), 'stale'],
    ['newer game', msg(2, 0, 0, 'cc'), 'gap'],
    ['newer epoch', msg(1, 2, 2, 'cg'), 'gap'],
    ['skipped ply', msg(1, 1, 3, 'gc'), 'gap'],
    ['different ply at an index', msg(1, 1, 1, 'ff'), 'conflict'],
    ['an occupied point', msg(1, 1, 2, 'cc'), 'conflict'],
    ['a point off the board', msg(1, 1, 2, 'kk'), 'conflict'],
    ['not SGF letters', msg(1, 1, 2, 'C3'), 'conflict'],
    ['negative index', msg(1, 1, -1, 'cg'), 'conflict'],
  ])('%s → %s', (_label, m, kind) => {
    expect(applyMoveMsg(log(1, LINE_A.slice(0, 2), { epoch: 1 }), m).kind).toBe(kind);
  });

  it('refuses a ply after the end and during scoring', () => {
    const l = log(1, LINE_A.slice(0, 2), { end: B_RESIGNS });
    expect(applyMoveMsg(l, msg(1, 0, 2, 'cg'))).toMatchObject({ kind: 'conflict' });
    expect(() => appendPly(l, 'cg', 0)).toThrow();
    const s = log(1, PASSED, { scoring: S(1) });
    expect(applyMoveMsg(s, msg(1, 0, 4, 'ee'))).toEqual({ kind: 'conflict', error: 'game is in scoring' });
    expect(() => appendPly(s, 'ee', 0)).toThrow();
    // After a resume (no scoring), play goes on.
    expect(appendPly(resumeLog(s)!, 'ee', 0).plies).toHaveLength(5);
  });

  it('appendPly refuses a ko retake and enters scoring on the second pass', () => {
    expect(() => appendPly(log(1, KO), 'de', 0)).toThrow(/ko/);
    const l = appendPly(log(1, PASSED.slice(0, 3)), 'tt', 300);
    expect(l.scoring).toEqual({ round: 1, rev: 0, dead: [], accepted: [0, 0] });
    expect(l.plies.at(-1)).toEqual({ m: 'tt', ms: 300 });
    // A second double pass after a resume is round 2.
    const again = appendPly(appendPly(appendPly(resumeLog(l)!, 'ee', 0), 'tt', 0), 'tt', 0);
    expect(again.scoring?.round).toBe(2);
  });

  it('endLog ends once', () => {
    const l = endLog(log(1, LINE_B), W_RESIGNS);
    expect(l.end).toEqual(W_RESIGNS);
    expect(endLog(l, B_ON_TIME)).toBe(l);
  });

  it('turn and seat to move follow the colors of the game', () => {
    const l = log(2, ['cc'], { black: 1 });
    expect(turnOf(l)).toBe('W');
    expect(seatToMove(l)).toBe(0);
    expect(colorOf(l, 1)).toBe('B');
    expect(seatOf(l, 'W')).toBe(0);
  });

  it('with a handicap White moves first', () => {
    const l = log(1, [], { black: 0, settings: { handicap: 3 } });
    expect(turnOf(l)).toBe('W');
    expect(seatToMove(l)).toBe(1);
    expect(colorOfPly(l, 0)).toBe('W');
    expect(colorOfPly(l, 1)).toBe('B');
  });

  describe('takebackLog', () => {
    it.each([
      ['Black takes back its last ply, White has not replied', ['cc'], 0, 0],
      ['Black takes back after White replied', ['cc', 'gg'], 0, 0],
      ['White takes back its last ply', ['cc', 'gg'], 1, 1],
      ['White takes back after Black replied', ['cc', 'gg', 'cg'], 1, 1],
      ['Black, deeper in the game', LINE_A.slice(0, 7), 0, 6],
      ['Black takes back its pass', ['cc', 'gg', 'tt'], 0, 2],
    ] as const)('%s', (_label, moves, seat, len) => {
      const l = log(1, [...moves], { black: 0, epoch: 2 });
      const t = takebackLog(l, seat);
      expect(t?.plies).toEqual(l.plies.slice(0, len));
      expect(t?.epoch).toBe(3);
      expect(t?.n).toBe(1);
      expect(t).toMatchObject({ size: 9, rules: 'area', handicap: 0, black: 0, tc: null });
    });

    it('works with swapped colors and with a handicap', () => {
      const l = log(2, ['cc', 'gg'], { black: 1 });
      expect(takebackLog(l, 1)?.plies).toHaveLength(0);
      expect(takebackLog(l, 0)?.plies).toHaveLength(1);
      const h = log(1, ['cc', 'gg'], { black: 0, settings: { size: 13, handicap: 2 } });
      expect(takebackLog(h, 0)?.plies).toHaveLength(1); // Black played ply 1
      expect(takebackLog(h, 1)?.plies).toHaveLength(0); // White played ply 0
    });

    it('during scoring cuts the second pass and ends scoring', () => {
      const s = log(1, PASSED, { black: 0, scoring: S(2, ['gg'], [2, 0]) });
      const t = takebackLog(s, 1); // White made the second pass
      expect(t?.plies.map((p) => p.m)).toEqual(['cc', 'gg', 'tt']);
      expect(t?.scoring).toBeUndefined();
      expect(validateLog(t).ok).toBe(true);
    });

    it('is null without an own ply or after the end', () => {
      expect(takebackLog(log(1, ['cc'], { black: 0 }), 1)).toBeNull();
      expect(takebackLog(log(1, []), 0)).toBeNull();
      expect(takebackLog(log(1, LINE_B, { end: B_ON_TIME }), 0)).toBeNull();
    });

    it('wins the next reconcile over the stale longer copy', () => {
      const before = log(1, LINE_A.slice(0, 5));
      const after = takebackLog(before, 0)!;
      expect(compareLogs(before, after, 0).winner).toBe('remote');
    });
  });

  it('rematch keeps size, rules, handicap and time control; colors swap unless there is a handicap', () => {
    const g1 = log(1, LINE_B, { black: 0, tc: '5+3', end: B_ON_TIME, settings: { size: 13, rules: 'territory' } });
    const g2 = rematchLog(g1);
    expect(g2).toEqual({ n: 2, epoch: 0, plies: [], black: 1, tc: '5+3', size: 13, rules: 'territory', handicap: 0 });
    expect(rematchLog(g2).black).toBe(0);
    const h1 = log(1, [], { black: 1, settings: { size: 19, handicap: 4 }, end: W_RESIGNS });
    expect(rematchLog(h1)).toMatchObject({ n: 2, black: 1, size: 19, handicap: 4 });
    expect(newLog(1, 1, null)).toEqual({ n: 1, epoch: 0, plies: [], black: 1, tc: null, size: 9, rules: 'area', handicap: 0 });
    expect(newLog(1, 0, null, { size: 9, rules: 'area', handicap: 9 }).handicap).toBe(5); // normalized for 9×9
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Scoring on a log (DESIGN 9.5)                                                                    */
/* ---------------------------------------------------------------------------------------------- */

describe('scoring on a log', () => {
  const open = () => log(1, PASSED, { scoring: S(0) });

  it('markLog raises rev, keeps only stones and clears both acceptances', () => {
    const accepted = acceptLog(markLog(open(), ['gg'])!, 0)!;
    expect(accepted.scoring).toEqual(S(1, ['gg'], [1, 0]));
    const toggled = markLog(accepted, ['gg', 'cc', 'ee', 'cc'])!;
    expect(toggled.scoring).toEqual(S(2, ['cc', 'gg'], [0, 0]));
    expect(markLog(toggled, [], 2)).toBeNull(); // not higher
    expect(markLog(toggled, [], 5)?.scoring?.rev).toBe(5);
    expect(markLog(log(1, LINE_B), ['dd'])).toBeNull();
    expect(validateLog(toggled).ok).toBe(true);
  });

  it('bothAccepted needs both seats on the current rev, and rev 0 is nothing to accept', () => {
    const m = markLog(open(), [])!;
    expect(bothAccepted(acceptLog(acceptLog(open(), 0)!, 1)!)).toBe(false);
    expect(bothAccepted(acceptLog(m, 0)!)).toBe(false);
    expect(bothAccepted(acceptLog(acceptLog(m, 0)!, 1)!)).toBe(true);
    expect(bothAccepted(acceptLog(acceptLog(markLog(acceptLog(m, 0)!, ['gg'])!, 1)!, 1)!)).toBe(false);
  });

  it('scoreEnd counts the marking; the result validates', () => {
    const alive = markLog(open(), [])!;
    expect(scoreEnd(alive)).toEqual({ result: { winner: 'W', by: 'score', margin: 15 }, by: 'score' }); // 1 – 1 + 7.5
    const dead = markLog(open(), ['gg'])!;
    const end = scoreEnd(dead)!;
    expect(end.result.winner).toBe('B');
    expect(validateLog(endLog(dead, end)).ok).toBe(true);
    expect(scoreEnd(log(1, LINE_B))).toBeNull();
  });

  it('territory rules count prisoners and komi 6.5', () => {
    const t = log(1, PASSED, { scoring: S(1, ['gg']), settings: { rules: 'territory' } });
    const end = scoreEnd(t)!;
    expect(end.result).toMatchObject({ winner: 'B', by: 'score' });
    expect(end.result.margin! % 2).toBe(1); // a half point
  });

  it('resumeLog drops the scoring state', () => {
    const r = resumeLog(markLog(open(), ['gg'])!)!;
    expect(r.scoring).toBeUndefined();
    expect(resumeLog(r)).toBeNull();
    expect(logToGame(r).scoring).toBeUndefined();
  });

  it('roundTwoEnd scores at once from the given dead stones, the same on both devices', () => {
    const round2 = log(1, [...PASSED, 'ee', 'tt', 'tt'], { scoring: S(0) });
    expect(round2.scoring?.round).toBe(2);
    const a = roundTwoEnd(round2, ['gg'])!;
    const b = roundTwoEnd(round2, ['gg'])!;
    expect(a).toEqual(b);
    expect(a.scoring).toEqual(S(1, ['gg'], [1, 1], 2));
    expect(a.end?.by).toBe('score');
    expect(validateLog(a).ok).toBe(true);
    expect(roundTwoEnd(open(), [])).toBeNull(); // round 1 needs a marking round
    expect(roundTwoEnd(round2, [])!.end?.result.winner).toBe('W'); // every stone alive
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Score                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

describe('room score', () => {
  it.each([
    ['Black wins, seat 0 black', 0, 'B', [2, 0]],
    ['Black wins, seat 1 black', 1, 'B', [0, 2]],
    ['White wins, seat 0 black', 0, 'W', [0, 2]],
    ['White wins, seat 1 black', 1, 'W', [2, 0]],
  ] as const)('%s', (_label, black, winner, points) => {
    expect(gamePoints({ black, end: { result: { winner, by: 'resign' }, by: 'resign' } })).toEqual(points);
  });

  it('counts nothing for an unfinished game', () => {
    expect(gamePoints({ black: 0 })).toEqual([0, 0]);
  });

  it('adds up across rematches with alternating colors', () => {
    // Game 1: seat 0 (black) wins. Game 2: seat 1 (black) wins. Game 3: seat 1 (white) wins. Game 4: seat 0 (white) wins. Game 5 running.
    const games = [
      log(1, LINE_B, { black: 0, end: W_RESIGNS }),
      log(2, LINE_B, { black: 1, end: W_RESIGNS }),
      log(3, LINE_B, { black: 0, end: W_ON_TIME }),
      log(4, LINE_B, { black: 1, end: B_RESIGNS }),
      log(5, ['cc'], { black: 0 }),
    ];
    expect(roomScore(games)).toEqual([4, 4]);
    expect(scoreView(roomScore(games), 0)).toEqual([2, 2]);
    expect(scoreView(roomScore(games.slice(0, 1)), 1)).toEqual([0, 1]);
    expect(roomScore([])).toEqual([0, 0]);
  });

  it('counts a scored game and a time loss', () => {
    // Game 1: White (seat 1) wins by komi; game 2: White (seat 1) wins on time.
    expect(roomScore([scored(1, [], { black: 0 }), log(2, ['cc'], { black: 0, end: W_ON_TIME })])).toEqual([0, 4]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* base64url and the seat key                                                                       */
/* ---------------------------------------------------------------------------------------------- */

describe('base64url', () => {
  it('round-trips every length', () => {
    const rng = seeded(7);
    for (let n = 0; n < 40; n++) {
      const bytes = randomBytes(n, rng);
      const s = toBase64Url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(s.length).toBe(Math.ceil((n * 4) / 3));
      expect([...fromBase64Url(s)]).toEqual([...bytes]);
    }
  });

  it('matches the standard encoding', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x10]);
    expect(toBase64Url(bytes)).toBe('-_-_ABA');
    expect([...fromBase64Url('-_-_ABA=')]).toEqual([...bytes]);
    expect(toBase64Url(new TextEncoder().encode('Zigo'))).toBe('Wmlnbw');
  });

  it('rejects bad input', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
    expect(() => fromBase64Url('abcde')).toThrow();
  });
});

describe('seat key and proof', () => {
  const CODE = 'K7QW2M';

  it('randomBytes uses the injected rng deterministically, or WebCrypto', () => {
    expect([...randomBytes(4, () => 0)]).toEqual([0, 0, 0, 0]);
    expect([...randomBytes(3, () => 0.999999)]).toEqual([255, 255, 255]);
    expect([...randomBytes(8, seeded(1))]).toEqual([...randomBytes(8, seeded(1))]);
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a).toHaveLength(16);
    expect([...a]).not.toEqual([...b]);
  });

  it('generates 128-bit keys and nonces in base64url', () => {
    const key = generateKey(seeded(3));
    expect(key).toHaveLength(22);
    expect(isValidKey(key)).toBe(true);
    expect(generateKey(seeded(3))).toBe(key);
    expect(generateKey()).not.toBe(generateKey());
    expect(fromBase64Url(generateNonce(seeded(4)))).toHaveLength(16);
    expect(generateNonce(seeded(4))).not.toBe(generateNonce(seeded(5)));
  });

  it.each([
    ['too short', 'AAAA'],
    ['too long', 'A'.repeat(23)],
    ['bad characters', '+'.repeat(22)],
    ['not a string', 42],
  ])('isValidKey rejects %s', (_label, k) => {
    expect(isValidKey(k)).toBe(false);
  });

  it('a proof verifies with the same key, nonce, code and seat', async () => {
    const key = generateKey(seeded(10));
    const nonce = generateNonce(seeded(11));
    const mac = await proveSeat(key, nonce, CODE, 1);
    expect(fromBase64Url(mac)).toHaveLength(32);
    expect(await verifySeat(key, nonce, CODE, 1, mac)).toBe(true);
    expect(await proveSeat(key, nonce, CODE, 1)).toBe(mac); // deterministic
  });

  it('is HMAC-SHA-256 over nonce ‖ code ‖ seat (known answer)', async () => {
    const keyBytes = new Uint8Array(16).map((_, i) => i);
    const nonceBytes = new Uint8Array(16).map((_, i) => 0xa0 + i);
    const key = toBase64Url(keyBytes);
    const nonce = toBase64Url(nonceBytes);
    const msg = new Uint8Array([...nonceBytes, ...new TextEncoder().encode(CODE), 0]);
    expect([...proofMessage(nonce, CODE, 0)]).toEqual([...msg]);
    const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', k, msg)));
    const mac = await proveSeat(key, nonce, CODE, 0);
    expect(mac).toBe(want);
    // Pinned: a change here breaks the protocol between versions.
    expect(mac).toMatchInlineSnapshot(`"bOWZjYm7kM4rs3l3bsCzuq1xnAkllDiMj9d9ttE2XG8"`);
  });

  it.each([
    ['another key', { key: 1 }],
    ['another nonce', { nonce: 1 }],
    ['another code', { code: 'K7QW2N' }],
    ['the other seat', { seat: 0 as Seat }],
  ])('fails with %s', async (_label, change) => {
    const key = generateKey(seeded(20));
    const nonce = generateNonce(seeded(21));
    const mac = await proveSeat(key, nonce, CODE, 1);
    const k2 = 'key' in change ? generateKey(seeded(22)) : key;
    const n2 = 'nonce' in change ? generateNonce(seeded(23)) : nonce;
    const c2 = 'code' in change ? (change.code as string) : CODE;
    const s2 = 'seat' in change ? (change.seat as Seat) : 1;
    expect(await verifySeat(k2, n2, c2, s2, mac)).toBe(false);
  });

  it('a stranger cannot reflect a device its own proof', async () => {
    // Seat 0 sends nonce N; the stranger answers hello with the same N, receives seat 0's proof of
    // N and sends it back as its own. Seat 0 expects a proof from seat 1, so it fails.
    const key = generateKey(seeded(30));
    const n = generateNonce(seeded(31));
    const reflected = await proveSeat(key, n, CODE, 0);
    expect(await verifySeat(key, n, CODE, 1, reflected)).toBe(false);
  });

  it.each([
    ['an empty mac', ''],
    ['a short mac', 'AAAA'],
    ['a non-base64 mac', '!!!'],
  ])('verifySeat is false for %s', async (_label, mac) => {
    expect(await verifySeat(generateKey(seeded(1)), generateNonce(seeded(2)), CODE, 0, mac)).toBe(false);
  });

  it('verifySeat is false and proveSeat rejects on a malformed key or nonce', async () => {
    const nonce = generateNonce(seeded(2));
    expect(await verifySeat('nope', nonce, CODE, 0, 'A'.repeat(43))).toBe(false);
    expect(await verifySeat(generateKey(seeded(1)), '***', CODE, 0, 'A'.repeat(43))).toBe(false);
    await expect(proveSeat('nope', nonce, CODE, 0)).rejects.toThrow();
    await expect(proveSeat(generateKey(seeded(1)), 'AAAA', CODE, 0)).rejects.toThrow(/short/);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Stored games                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

describe('GameLog ↔ SavedGame', () => {
  it('stores a room game for this seat', () => {
    const l = log(3, LINE_A, { black: 0, epoch: 2, tc: '5+0', end: B_RESIGNS, settings: { size: 13, rules: 'territory' } });
    const s = logToSaved(l, { code: 'K7QW2M', seat: 1, now: 5000 });
    expect(s).toEqual({
      id: 'K7QW2M.3',
      code: 'K7QW2M',
      mode: 'room',
      color: 'W',
      size: 13,
      rules: 'territory',
      handicap: 0,
      tc: '5+0',
      moves: zigo.encodeMoves(l.plies),
      ms: l.plies.map((p) => p.ms),
      result: { winner: 'W', by: 'resign' },
      assisted: false,
      room: { n: 3, epoch: 2 },
      createdAt: 5000,
      lastPlayedAt: 5000,
    } satisfies SavedGame);
    expect(roomGameId('AB', 7)).toBe('AB.7');
  });

  it('stores the scoring state of a game in scoring', () => {
    const s = logToSaved(log(1, PASSED, { scoring: S(2, ['gg'], [2, 0]) }), { code: 'X', seat: 0, now: 1 });
    expect(s.scoring).toEqual(S(2, ['gg'], [2, 0]));
    expect(s.moves).toBe('ccggtttt');
    expect('result' in s).toBe(false);
  });

  it('keeps createdAt and assisted of the stored copy', () => {
    const prev = { ...logToSaved(log(1, []), { code: 'X', seat: 0, now: 1 }), assisted: true };
    const s = logToSaved(log(1, ['cc']), { code: 'X', seat: 0, now: 9, prev, lastPlayedAt: 8 });
    expect(s).toMatchObject({ createdAt: 1, assisted: true, lastPlayedAt: 8, color: 'B' });
    expect('result' in s).toBe(false);
  });

  it.each([0, 1] as const)('round-trips through SavedGame for seat %s', (seat) => {
    for (const l of [
      log(1, LINE_A, { black: 1, tc: '3+2' }),
      log(2, KO, { black: 0, epoch: 1 }),
      log(3, PASSED, { black: 1 }), // resumed
      log(4, PASSED, { black: 0, scoring: S(3, ['gg'], [3, 0]) }),
      scored(5, ['gg'], { black: 1 }),
      log(6, ['kk', 'tt'], { black: 0, tc: '20m5x30', settings: { size: 19, rules: 'territory', handicap: 9 } }),
      log(7, LINE_B, { black: 0, end: B_ON_TIME }),
      log(8, [], { black: 1 }),
    ]) {
      expect(savedToLog(logToSaved(l, { code: 'Q', seat, now: 1 }), seat)).toEqual(l);
    }
  });

  it('savedToLog is null for solo games and broken records', () => {
    const solo: SavedGame = { ...logToSaved(log(1, []), { code: 'X', seat: 0, now: 1 }), mode: 'local' };
    delete solo.room;
    expect(savedToLog(solo, 0)).toBeNull();
    const broken = { ...logToSaved(log(1, ['cc']), { code: 'X', seat: 0, now: 1 }), moves: 'Mc' + 'Mc' };
    expect(savedToLog(broken, 0)).toBeNull();
    const illegal = { ...logToSaved(log(1, ['cc']), { code: 'X', seat: 0, now: 1 }), moves: 'cccc' };
    expect(savedToLog(illegal, 0)).toBeNull();
  });
});

describe('helpers', () => {
  it('currentLog and sortLogs', () => {
    expect(currentLog([])).toBeUndefined();
    expect(currentLog([log(2, []), log(5, []), log(3, [])])?.n).toBe(5);
    expect(sortLogs([log(2, []), log(1, ['cc']), log(1, ['dd'])]).map((l) => [l.n, l.plies[0]?.m])).toEqual([
      [1, 'dd'],
      [2, undefined],
    ]);
  });
});
