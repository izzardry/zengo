/**
 * Scoring and clocks in a room (DESIGN 9.5, 9.3, 9.4, 9.7, 15.4; PLAN 7), two controllers over the
 * memory transport on fake time. Every scenario of DESIGN 15.4 for rooms: passes, the first
 * proposal (seat 0's engine, sync or async), seat 1 proposing when seat 0 has no engine, toggles
 * clearing acceptances, accept, resume, the round-2 end from seat 0, takeback during scoring,
 * reconcile by rev (crossing toggles and accepts, offline marks), a seat-1 engine that would
 * disagree, lost mark / accept / resume / end messages recovered without a reconnect, disconnect
 * during scoring, rematch with the handicap colour rule, and byo-yomi in a room.
 *
 * Determinism (PLAN 7): no result is ever computed from a device's own engine output; proposals
 * are data sent with `mark` or `end`. Several tests give seat 1 an engine that would propose other
 * stones and check that it is never asked (or, after a hand-over, that its answer is only data).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Game, GameLog, MarkMsg, Message, Point, RoomNoticeKind } from '../types';
import { hashLog } from '../sync';
import zengo from '../zengo';
import scoringApi from '../scoring';
import type { MemoryOptions, MemoryTransport } from '../transport/memory';
import { ROOM_DEFAULTS, type RoomCreateSettings } from '../room';
import { timeLeft } from './controller';
import { createHarness, type Device, type DeviceOptions, type Harness } from './testkit';

const CODE = 'K7QW2M';
const RESEND = ROOM_DEFAULTS.resendMs;

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

interface Setup {
  create?: RoomCreateSettings;
  a?: DeviceOptions;
  b?: DeviceOptions;
  memory?: MemoryOptions;
}

/** A (seat 0, the creator) and B (seat 1, the joiner), connected and live. */
async function joined(s: Setup = {}): Promise<{ h: Harness; A: Device; B: Device }> {
  const h = createHarness({ code: CODE, memory: s.memory });
  const A = h.device('A', { create: s.create ?? { tc: null, color: 'B' }, ...s.a });
  await h.advance(200);
  const B = h.device('B', s.b);
  await h.advance(500);
  expect(A.ctrl.snapshot.live && B.ctrl.snapshot.live).toBe(true);
  return { h, A, B };
}

/** Plays `points` in order (`tt` passes), each by whichever device is to move. */
async function play(h: Harness, devs: Device[], points: string[], ms = 1000): Promise<void> {
  for (const p of points) {
    const d = devs.find((x) => x.ctrl.snapshot.myTurn);
    if (!d) throw new Error(`nobody to move for ${p}`);
    expect(d.ctrl.move(p, ms), `${d.name} plays ${p}`).toBe(true);
    await h.advance(100);
  }
}

/** Who sent a link entry: the device whose current transport it is. */
function who(h: Harness, from: string): string {
  const d = h.devices.find((x) => (x.ctrl.transport as MemoryTransport | null)?.name === from);
  return d ? d.name : from;
}

/** `[sender, rev, dead]` of every `mark` on the link. */
function marks(h: Harness): [string, number, string[]][] {
  return h
    .sent()
    .filter((e) => e.msg.t === 'mark' && !e.dropped)
    .map((e) => [who(h, e.from), (e.msg as MarkMsg).rev, [...(e.msg as MarkMsg).dead]]);
}

const scoring = (d: Device) => d.ctrl.snapshot.game.scoring;
const end = (d: Device) => d.ctrl.snapshot.game.end;
const hashes = (d: Device) => d.ctrl.snapshot.logs.map((l: GameLog) => hashLog(l));

/** Both devices hold identical logs, and neither raised a sync or fork toast. */
function expectConverged(A: Device, B: Device): void {
  expect(hashes(A)).toEqual(hashes(B));
  const bad: RoomNoticeKind[] = ['sync-error', 'restored-from-opponent'];
  for (const d of [A, B]) for (const k of bad) expect(d.kinds(), `${d.name}: ${k}`).not.toContain(k);
}

/** The count both devices must show for the marking `dead` (as each device computes it). */
function resultFor(g: Game, dead: Point[]) {
  return scoringApi.result(g, scoringApi.score(g, dead));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drops only the first `n` messages of kind `t`. */
function dropFirst(h: Harness, t: Message['t'], n = 1): void {
  let left = n;
  h.net.link(CODE)?.setDrop((m) => {
    if (m.t !== t || left <= 0) return false;
    left--;
    return true;
  });
}

/** Two stones each, then both pass: scoring round 1 (A Black on cc/cg, B White on gg/gc). */
const TO_SCORING = ['cc', 'gg', 'cg', 'gc', 'tt', 'tt'];

/* ---------------------------------------------------------------------------------------------- */
/* The first proposal                                                                               */
/* ---------------------------------------------------------------------------------------------- */

describe('the first proposal (DESIGN 9.5)', () => {
  it("seat 0's async engine proposes rev 1; until then nothing can be accepted and seat 1 waits", async () => {
    const answer = deferred<Point[] | null>();
    const proposeA = vi.fn((_g: Game) => answer.promise);
    const proposeB = vi.fn(() => ['cc', 'cg']); // would disagree; must never be asked
    const { h, A, B } = await joined({ a: { propose: proposeA }, b: { propose: proposeB } });
    await play(h, [A, B], TO_SCORING);
    expect(proposeA).toHaveBeenCalledTimes(1);
    expect(proposeA.mock.calls[0][0].scoring).toMatchObject({ round: 1 });
    for (const d of [A, B]) {
      expect(scoring(d)).toEqual({ round: 1, rev: 0, dead: [], accepted: [0, 0] });
      expect(d.ctrl.snapshot).toMatchObject({ canAccept: false, canResume: true, proposing: 0 });
      expect(d.ctrl.accept()).toBe(false);
    }
    expect(B.ctrl.snapshot.canMark).toBe(false);
    expect(B.ctrl.mark(['gg'])).toBe(false);
    answer.resolve(['gg', 'gc']);
    await h.advance(100);
    for (const d of [A, B]) {
      expect(scoring(d)).toEqual({ round: 1, rev: 1, dead: ['gc', 'gg'], accepted: [0, 0] });
      expect(d.ctrl.snapshot).toMatchObject({ canAccept: true, canMark: true, proposing: null });
    }
    expect(marks(h)).toEqual([['A', 1, ['gc', 'gg']]]);
    expect(proposeB).not.toHaveBeenCalled();
    expectConverged(A, B);
  });

  it('seat 0 without an engine hands the proposal to seat 1, whose engine proposes (rev 1)', async () => {
    const proposeB = vi.fn((g: Game) => (g.scoring ? ['gc', 'gg'] : null));
    const { h, A, B } = await joined({ b: { propose: proposeB } });
    await play(h, [A, B], TO_SCORING);
    expect(proposeB).toHaveBeenCalledTimes(1);
    expect(marks(h)).toEqual([
      ['A', 0, []], // the hand-over
      ['B', 1, ['gc', 'gg']],
    ]);
    for (const d of [A, B]) {
      expect(scoring(d)).toEqual({ round: 1, rev: 1, dead: ['gc', 'gg'], accepted: [0, 0] });
      expect(d.ctrl.snapshot.proposing).toBeNull();
    }
    // The proposal is ordinary data from here on: both accept and both count the same result.
    A.ctrl.accept();
    B.ctrl.accept();
    await h.advance(100);
    const want = resultFor(A.ctrl.snapshot.game, ['gc', 'gg']);
    expect(want).toMatchObject({ winner: 'B', by: 'score' });
    for (const d of [A, B]) expect(end(d)).toEqual({ result: want });
    expectConverged(A, B);
  });

  it("seat 0's engine without an answer (null) also hands over; seat 1's async answer arrives later", async () => {
    const answerB = deferred<Point[] | null>();
    const proposeA = vi.fn(async () => null);
    const proposeB = vi.fn(() => answerB.promise);
    const { h, A, B } = await joined({ a: { propose: proposeA }, b: { propose: proposeB } });
    await play(h, [A, B], TO_SCORING);
    expect(proposeA).toHaveBeenCalledTimes(1);
    expect(proposeB).toHaveBeenCalledTimes(1);
    for (const d of [A, B]) expect(d.ctrl.snapshot).toMatchObject({ proposing: 1 });
    expect(scoring(A)?.rev).toBe(0);
    // The hand-over is repeated while seat 1 thinks; seat 1 asks its engine only once.
    await h.advance(RESEND * 3);
    expect(marks(h).filter(([, rev]) => rev === 0).length).toBeGreaterThan(1);
    expect(proposeB).toHaveBeenCalledTimes(1);
    answerB.resolve(['gg']);
    await h.advance(100);
    for (const d of [A, B]) expect(scoring(d)).toMatchObject({ rev: 1, dead: ['gg'] });
    const after = marks(h).length;
    await h.advance(RESEND * 3);
    expect(marks(h).length).toBe(after); // no more hand-overs
    expectConverged(A, B);
  });

  it("seat 1's engine failing after a hand-over: every stone alive", async () => {
    const proposeB = vi.fn(async () => {
      throw new Error('engine failed');
    });
    const { h, A, B } = await joined({ b: { propose: proposeB } });
    await play(h, [A, B], TO_SCORING);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 1, dead: [], accepted: [0, 0] });
    expect(marks(h)).toEqual([
      ['A', 0, []],
      ['B', 1, []],
    ]);
  });

  it('no engine on either device: seat 0 marks every stone alive at once, no hand-over', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], TO_SCORING);
    expect(marks(h)).toEqual([['A', 1, []]]);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 1, dead: [], accepted: [0, 0] });
  });

  it('a lost hand-over is sent again', async () => {
    const proposeB = vi.fn(() => ['gg']);
    const { h, A, B } = await joined({ b: { propose: proposeB } });
    dropFirst(h, 'mark');
    await play(h, [A, B], TO_SCORING);
    expect(scoring(B)?.rev).toBe(0);
    await h.advance(RESEND);
    for (const d of [A, B]) expect(scoring(d)).toMatchObject({ rev: 1, dead: ['gg'] });
    expect(proposeB).toHaveBeenCalledTimes(1);
    expectConverged(A, B);
  });

  it('seat 0 toggling while seat 1 proposes: the crossing marks settle on seat 0 at rev 2 on both devices', async () => {
    const answerB = deferred<Point[] | null>();
    const { h, A, B } = await joined({ b: { propose: () => answerB.promise }, memory: { delayMs: 40 } });
    await play(h, [A, B], TO_SCORING);
    await h.advance(200);
    expect(A.ctrl.snapshot.canMark).toBe(true); // seat 0 may still mark by hand
    // Both marks leave before either arrives.
    answerB.resolve(['gg']);
    await Promise.resolve();
    expect(A.ctrl.mark(['cc'])).toBe(true);
    await h.advance(500);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 2, dead: ['cc'], accepted: [0, 0] });
    expectConverged(A, B);
  });

  it('seat 0 without an engine passes second while away: it hands over when seat 1 is back', async () => {
    const proposeB = vi.fn(() => ['cc']);
    const { h, A, B } = await joined({ create: { tc: null, color: 'W' }, b: { propose: proposeB } });
    await play(h, [A, B], ['cc', 'gg', 'tt']); // B Black, A White; B passed
    h.net.link(CODE)?.disconnect();
    await h.advance(100);
    expect(A.ctrl.pass()).toBe(true); // untimed: A passes while B is away (DESIGN 9.3)
    await h.advance(100);
    expect(scoring(A)).toMatchObject({ round: 1, rev: 0 });
    expect(A.ctrl.snapshot.proposing).toBe(1); // A remembers that B has an engine
    expect(scoring(B)).toBeUndefined();
    h.net.link(CODE)?.reconnect();
    await h.advance(500);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 1, dead: ['cc'], accepted: [0, 0] });
    expect(proposeB).toHaveBeenCalledTimes(1);
    expectConverged(A, B);
  });

  it('seat 0 reloaded during scoring without an engine: it waits for the hello, then hands over', async () => {
    const proposeB = vi.fn(() => ['gg']);
    const { h, A, B } = await joined({ b: { propose: proposeB } });
    await play(h, [A, B], ['cc', 'gg', 'cg', 'gc', 'tt']);
    A.ctrl.leave();
    await h.advance(100);
    expect(B.ctrl.pass()).toBe(true); // B passes second while A is away
    expect(scoring(B)).toMatchObject({ rev: 0 });
    expect(B.ctrl.snapshot.canMark).toBe(false);
    const A2 = h.device('A2', { storage: A.storage });
    await h.advance(1000);
    for (const d of [A2, B]) expect(scoring(d)).toEqual({ round: 1, rev: 1, dead: ['gg'], accepted: [0, 0] });
    expect(proposeB).toHaveBeenCalledTimes(1);
    expectConverged(A2, B);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Marks, accepts, resume                                                                           */
/* ---------------------------------------------------------------------------------------------- */

describe('marking, accepting and resuming', () => {
  it('a full scoring: proposal, a toggle clears both acceptances, both accept the same rev, the same result', async () => {
    const proposeB = vi.fn(() => ['cc', 'cg']);
    const { h, A, B } = await joined({ create: { tc: null, color: 'B', rules: 'territory' }, a: { propose: () => ['gg'] }, b: { propose: proposeB } });
    await play(h, [A, B], TO_SCORING);
    for (const d of [A, B]) expect(scoring(d)).toMatchObject({ rev: 1, dead: ['gg'] });
    expect(A.ctrl.accept()).toBe(true);
    await h.advance(100);
    for (const d of [A, B]) expect(scoring(d)?.accepted).toEqual([1, 0]);
    // B toggles White's other group dead too: rev 2, both acceptances cleared on both boards.
    const toggled = scoringApi.toggle(B.ctrl.snapshot.game, scoring(B)?.dead ?? [], 'gc');
    expect(B.ctrl.mark(toggled)).toBe(true);
    await h.advance(100);
    for (const d of [A, B]) {
      expect(scoring(d)).toEqual({ round: 1, rev: 2, dead: ['gc', 'gg'], accepted: [0, 0] });
      expect(d.ctrl.snapshot.canAccept).toBe(true);
    }
    expect(B.ctrl.accept()).toBe(true);
    await h.advance(100);
    expect(end(A)).toBeUndefined();
    expect(A.ctrl.accept()).toBe(true);
    await h.advance(100);
    const want = resultFor(A.ctrl.snapshot.game, ['gc', 'gg']);
    for (const d of [A, B]) {
      expect(end(d)).toEqual({ result: want });
      expect(scoring(d)).toEqual({ round: 1, rev: 2, dead: ['gc', 'gg'], accepted: [2, 2] });
      expect(d.ctrl.snapshot.score).toEqual([2, 0]);
    }
    expect(proposeB).not.toHaveBeenCalled();
    expect(h.sent().filter((e) => e.msg.t === 'end')).toEqual([]); // each device counted for itself
    expectConverged(A, B);
  });

  it('toggles that cross on the wire (same rev) settle on seat 0 at rev + 1 on both devices, without a toast', async () => {
    const { h, A, B } = await joined({ memory: { delayMs: 40 } });
    await play(h, [A, B], TO_SCORING);
    expect(scoring(A)?.rev).toBe(1);
    expect(A.ctrl.mark(['cc'])).toBe(true);
    expect(B.ctrl.mark(['gg'])).toBe(true);
    await h.advance(1000);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 3, dead: ['cc'], accepted: [0, 0] });
    expectConverged(A, B);
  });

  it('accepts that cross on the wire end the game on both devices', async () => {
    const { h, A, B } = await joined({ a: { propose: () => ['gg'] }, memory: { delayMs: 40 } });
    await play(h, [A, B], TO_SCORING);
    expect(A.ctrl.accept()).toBe(true);
    expect(B.ctrl.accept()).toBe(true);
    await h.advance(1000);
    const want = resultFor(A.ctrl.snapshot.game, ['gg']);
    for (const d of [A, B]) {
      expect(end(d)).toEqual({ result: want });
      expect(scoring(d)?.accepted).toEqual([1, 1]);
    }
    expect(A.ctrl.snapshot.score).toEqual(B.ctrl.snapshot.score);
    expectConverged(A, B);
  });

  it('an accept crossing a toggle is void: the game goes on at the new rev', async () => {
    const { h, A, B } = await joined({ memory: { delayMs: 40 } });
    await play(h, [A, B], TO_SCORING);
    expect(A.ctrl.accept()).toBe(true);
    expect(B.ctrl.mark(['gg'])).toBe(true);
    await h.advance(1000);
    for (const d of [A, B]) {
      expect(scoring(d)).toEqual({ round: 1, rev: 2, dead: ['gg'], accepted: [0, 0] });
      expect(end(d)).toBeUndefined();
    }
    expectConverged(A, B);
  });

  it('resume: play continues with the player to move; two more passes end the game at once from seat 0 (round 2)', async () => {
    const proposeA = vi.fn(async (g: Game) => (g.scoring?.round === 2 ? ['gc', 'gg'] : ['gg']));
    const proposeB = vi.fn(() => ['cc']); // would disagree; never asked
    const { h, A, B } = await joined({ a: { propose: proposeA }, b: { propose: proposeB } });
    await play(h, [A, B], TO_SCORING);
    expect(B.ctrl.resume()).toBe(true);
    await h.advance(100);
    for (const d of [A, B]) {
      expect(scoring(d)).toBeUndefined();
      expect(d.ctrl.snapshot.game.passes).toBe(0);
    }
    expect(A.ctrl.snapshot.myTurn).toBe(true); // Black after White's pass
    await play(h, [A, B], ['ee', 'tt', 'tt']);
    await h.advance(100);
    const want = resultFor(A.ctrl.snapshot.game, ['gc', 'gg']);
    for (const d of [A, B]) {
      expect(end(d)).toEqual({ result: want });
      expect(scoring(d)).toEqual({ round: 2, rev: 1, dead: ['gc', 'gg'], accepted: [1, 1] });
      expect(d.ctrl.snapshot).toMatchObject({ canMark: false, canAccept: false, canResume: false });
    }
    const ends = h.sent().filter((e) => e.msg.t === 'end');
    expect(ends.map((e) => [who(h, e.from), e.msg])).toEqual([['A', expect.objectContaining({ by: 'score', dead: ['gc', 'gg'], result: want })]]);
    expect(proposeA).toHaveBeenCalledTimes(2);
    expect(proposeB).not.toHaveBeenCalled();
    expectConverged(A, B);
  });

  it('round 2 without an engine on seat 0 counts every stone alive, even if seat 1 has one', async () => {
    const proposeB = vi.fn(() => ['gg']);
    const { h, A, B } = await joined({ b: { propose: proposeB } });
    await play(h, [A, B], TO_SCORING);
    expect(proposeB).toHaveBeenCalledTimes(1); // the round-1 hand-over
    A.ctrl.resume();
    await h.advance(100);
    await play(h, [A, B], ['ee', 'tt', 'tt']);
    for (const d of [A, B]) {
      expect(scoring(d)).toMatchObject({ round: 2, dead: [] });
      expect(end(d)).toEqual({ result: resultFor(A.ctrl.snapshot.game, []) });
    }
    expect(proposeB).toHaveBeenCalledTimes(1); // never in round 2
    expectConverged(A, B);
  });

  it('round 2 reached while apart: seat 0 ends it alone and seat 1 adopts it on reconnect', async () => {
    const { h, A, B } = await joined({ a: { propose: (g) => (g.scoring?.round === 2 ? ['gg'] : []) } });
    await play(h, [A, B], TO_SCORING);
    B.ctrl.resume();
    await h.advance(100);
    await play(h, [A, B], ['ee', 'tt']); // A plays, B passes
    h.net.link(CODE)?.disconnect();
    await h.advance(100);
    expect(A.ctrl.pass()).toBe(true); // untimed: the second pass while B is away
    await h.advance(100);
    expect(end(A)?.result).toEqual(resultFor(A.ctrl.snapshot.game, ['gg']));
    expect(end(B)).toBeUndefined();
    h.net.link(CODE)?.reconnect();
    await h.advance(1000);
    expect(end(B)).toEqual(end(A));
    expect(scoring(B)).toEqual({ round: 2, rev: 1, dead: ['gg'], accepted: [1, 1] });
    expect(B.ctrl.snapshot.score).toEqual(A.ctrl.snapshot.score);
    expectConverged(A, B);
  });

  it("seat 1 adopts round 2's end as data even though its own engine would count other stones", async () => {
    const proposeB = vi.fn(() => ['cc', 'ee']);
    const { h, A, B } = await joined({ create: { tc: null, color: 'W' }, a: { propose: () => [] }, b: { propose: proposeB } });
    await play(h, [A, B], ['cc', 'gg', 'tt', 'tt']);
    A.ctrl.resume();
    await h.advance(100);
    await play(h, [A, B], ['ee', 'tt', 'tt']);
    for (const d of [A, B]) {
      expect(scoring(d)).toMatchObject({ round: 2, dead: [] });
      expect(end(d)?.result).toEqual(resultFor(A.ctrl.snapshot.game, []));
    }
    expect(proposeB).not.toHaveBeenCalled();
    expectConverged(A, B);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Lost messages: recovered without waiting for a reconnect                                         */
/* ---------------------------------------------------------------------------------------------- */

describe('lost scoring messages are recovered on the live channel', () => {
  async function scoringLive(s: Setup = {}) {
    const r = await joined(s);
    await play(r.h, [r.A, r.B], TO_SCORING);
    expect(scoring(r.A)?.rev).toBe(1);
    return r;
  }

  /** The channel stayed up: no notice of a reconnect, no second handshake. */
  function noReconnect(h: Harness, A: Device, B: Device): void {
    for (const d of [A, B]) expect(d.kinds()).not.toContain('reconnected');
    expect(h.sent().filter((e) => e.msg.t === 'hello').length).toBe(2);
  }

  it('a lost mark', async () => {
    const { h, A, B } = await scoringLive();
    dropFirst(h, 'mark');
    expect(B.ctrl.mark(['gg'])).toBe(true);
    await h.advance(100);
    expect(scoring(A)?.rev).toBe(1);
    await h.advance(RESEND);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 2, dead: ['gg'], accepted: [0, 0] });
    noReconnect(h, A, B);
    expectConverged(A, B);
  });

  it('a lost accept: the game ends on the other device too', async () => {
    const { h, A, B } = await scoringLive();
    A.ctrl.accept();
    await h.advance(100);
    dropFirst(h, 'accept');
    B.ctrl.accept();
    await h.advance(100);
    expect(end(B)).toBeDefined();
    expect(end(A)).toBeUndefined();
    await h.advance(RESEND);
    expect(end(A)).toEqual(end(B));
    expect(A.ctrl.snapshot.score).toEqual(B.ctrl.snapshot.score);
    noReconnect(h, A, B);
    expectConverged(A, B);
  });

  it('a lost resume: play continues on both devices', async () => {
    const { h, A, B } = await scoringLive();
    dropFirst(h, 'resume');
    expect(A.ctrl.resume()).toBe(true);
    await h.advance(100);
    expect(scoring(B)).toBeDefined();
    await h.advance(RESEND);
    for (const d of [A, B]) expect(scoring(d)).toBeUndefined();
    await play(h, [A, B], ['ee']);
    noReconnect(h, A, B);
    expectConverged(A, B);
  });

  it("a lost round-2 end from seat 0", async () => {
    const { h, A, B } = await scoringLive({ a: { propose: () => ['gg'] } });
    A.ctrl.resume();
    await h.advance(100);
    dropFirst(h, 'end');
    await play(h, [A, B], ['ee', 'tt', 'tt']);
    expect(end(A)).toBeDefined();
    expect(end(B)).toBeUndefined();
    await h.advance(RESEND);
    expect(end(B)).toEqual(end(A));
    noReconnect(h, A, B);
    expectConverged(A, B);
  });

  it('a lost resignation', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['cc', 'gg']);
    dropFirst(h, 'end');
    A.ctrl.resign();
    await h.advance(100);
    expect(end(B)).toBeUndefined();
    await h.advance(RESEND);
    expect(end(B)).toEqual({ result: { winner: 'W', by: 'resign' } });
    noReconnect(h, A, B);
    expectConverged(A, B);
  });

  it('probing stops once the other side shows the same copy', async () => {
    const { h, A, B } = await scoringLive();
    B.ctrl.mark(['gg']);
    A.ctrl.accept();
    await h.advance(RESEND * 2);
    const heads = h.sent().filter((e) => e.msg.t === 'head').length;
    await h.advance(RESEND * 10);
    expect(h.sent().filter((e) => e.msg.t === 'head').length).toBe(heads);
    expectConverged(A, B);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Disconnect, takeback, rematch                                                                    */
/* ---------------------------------------------------------------------------------------------- */

describe('scoring and the connection', () => {
  it('while disconnected: accept and resume wait, marks are kept; toggles of the same rev settle on seat 0', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], TO_SCORING);
    h.net.link(CODE)?.disconnect();
    await h.advance(100);
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot).toMatchObject({ live: false, canAccept: false, canResume: false, canMark: true });
      expect(d.ctrl.accept()).toBe(false);
      expect(d.ctrl.resume()).toBe(false);
    }
    expect(A.ctrl.mark(['cc'])).toBe(true);
    expect(B.ctrl.mark(['gg'])).toBe(true);
    expect(B.ctrl.mark(['gc', 'gg'])).toBe(true); // B's rev 3 beats A's rev 2
    await h.advance(60_000);
    h.net.link(CODE)?.reconnect();
    await h.advance(1000);
    for (const d of [A, B]) {
      expect(scoring(d)).toEqual({ round: 1, rev: 3, dead: ['gc', 'gg'], accepted: [0, 0] });
      expect(d.ctrl.snapshot).toMatchObject({ canAccept: true, canResume: true });
    }
    expectConverged(A, B);

    // Again apart, both toggle once from rev 3: same rev, different stones → seat 0's at rev 5.
    h.net.link(CODE)?.disconnect();
    await h.advance(100);
    A.ctrl.mark(['cc']);
    B.ctrl.mark(['gg']);
    h.net.link(CODE)?.reconnect();
    await h.advance(1000);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 5, dead: ['cc'], accepted: [0, 0] });
    expectConverged(A, B);
  });

  it('an acceptance made before a disconnect survives it; the second acceptance after it ends the game', async () => {
    const { h, A, B } = await joined({ a: { propose: () => ['gg'] } });
    await play(h, [A, B], TO_SCORING);
    A.ctrl.accept();
    await h.advance(100);
    h.net.link(CODE)?.disconnect();
    await h.advance(100);
    expect(B.ctrl.accept()).toBe(false);
    h.net.link(CODE)?.reconnect();
    await h.advance(1000);
    expect(scoring(B)?.accepted).toEqual([1, 0]);
    expect(B.ctrl.accept()).toBe(true);
    await h.advance(100);
    for (const d of [A, B]) expect(end(d)?.result).toEqual(resultFor(A.ctrl.snapshot.game, ['gg']));
    expectConverged(A, B);
  });

  it('takeback during scoring cuts the pass, ends scoring and drops a proposal still under way', async () => {
    const answers: ReturnType<typeof deferred<Point[] | null>>[] = [];
    const proposeA = vi.fn(() => {
      const d = deferred<Point[] | null>();
      answers.push(d);
      return d.promise;
    });
    const { h, A, B } = await joined({ a: { propose: proposeA } });
    await play(h, [A, B], TO_SCORING);
    expect(scoring(A)?.rev).toBe(0);
    expect(A.ctrl.snapshot.canAsk.takeback).toBe(true); // A passed first: its takeback cuts both passes
    expect(A.ctrl.ask('takeback')).toBe(true);
    await h.advance(100);
    expect(B.ctrl.reply('takeback', true)).toBe(true);
    await h.advance(100);
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot.game.plies.map((p) => p.m)).toEqual(['cc', 'gg', 'cg', 'gc']);
      expect(scoring(d)).toBeUndefined();
      expect(d.ctrl.snapshot.epoch).toBe(1);
      expect(d.ctrl.snapshot.proposing).toBeNull();
    }
    answers[0].resolve(['gg']); // too late: that scoring is gone
    await h.advance(100);
    for (const d of [A, B]) expect(scoring(d)).toBeUndefined();
    expect(marks(h)).toEqual([]);
    // The game goes on; the next double pass is round 1 again with a fresh proposal.
    await play(h, [A, B], ['ee', 'tt', 'tt']);
    expect(proposeA).toHaveBeenCalledTimes(2);
    answers[1].resolve(['gc']);
    await h.advance(100);
    for (const d of [A, B]) expect(scoring(d)).toEqual({ round: 1, rev: 1, dead: ['gc'], accepted: [0, 0] });
    expectConverged(A, B);
  });

  it('takeback of the second pass by the player who made it, after a proposal and an acceptance', async () => {
    const { h, A, B } = await joined({ a: { propose: () => ['gg'] } });
    await play(h, [A, B], TO_SCORING);
    A.ctrl.accept();
    await h.advance(100);
    expect(B.ctrl.ask('takeback')).toBe(true);
    await h.advance(100);
    A.ctrl.reply('takeback', true);
    await h.advance(100);
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot.game.plies.map((p) => p.m)).toEqual(['cc', 'gg', 'cg', 'gc', 'tt']);
      expect(scoring(d)).toBeUndefined();
    }
    expect(B.ctrl.snapshot.myTurn).toBe(true);
    expectConverged(A, B);
  });

  it('rematch keeps size, rules, handicap and time control; in a handicap game Black stays with its seat', async () => {
    const create: RoomCreateSettings = { tc: '20m5x30', color: 'W', size: 13, rules: 'territory', handicap: 4 };
    const { h, A, B } = await joined({ create });
    const settingsOf = (d: Device) => d.ctrl.snapshot.game.settings;
    for (let n = 1; n <= 3; n++) {
      for (const d of [A, B]) {
        expect(d.ctrl.snapshot.n).toBe(n);
        expect(settingsOf(d)).toMatchObject({ size: 13, rules: 'territory', handicap: 4 });
        expect(d.ctrl.snapshot.tc).toEqual({ kind: 'byoyomi', baseMs: 1_200_000, periods: 5, periodMs: 30_000 });
      }
      expect(A.ctrl.snapshot.color).toBe('W');
      expect(B.ctrl.snapshot.color).toBe('B');
      expect(A.ctrl.snapshot.myTurn).toBe(true); // White moves first with a handicap
      expect(B.ctrl.resign()).toBe(true);
      await h.advance(100);
      expect(B.ctrl.ask('rematch')).toBe(true);
      await h.advance(100);
      expect(A.ctrl.reply('rematch', true)).toBe(true);
      await h.advance(100);
    }
    expect(A.ctrl.snapshot.score).toEqual([6, 0]);
    expectConverged(A, B);
  });

  it('rematch without a handicap swaps colors and keeps the other settings', async () => {
    const { h, A, B } = await joined({ create: { tc: '3+10', color: 'B', size: 19, rules: 'territory' } });
    A.ctrl.resign();
    await h.advance(100);
    A.ctrl.ask('rematch');
    await h.advance(100);
    B.ctrl.reply('rematch', true);
    await h.advance(100);
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot.game.settings).toMatchObject({ size: 19, rules: 'territory', handicap: 0 });
      expect(d.ctrl.snapshot.tc).toEqual({ kind: 'fischer', baseMs: 180_000, incMs: 10_000 });
    }
    expect(A.ctrl.snapshot.color).toBe('W');
    expect(B.ctrl.snapshot.color).toBe('B');
    expect(B.ctrl.snapshot.myTurn).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Byo-yomi in a room (DESIGN 9.7, 11)                                                              */
/* ---------------------------------------------------------------------------------------------- */

describe('byo-yomi in a room', () => {
  it('both devices derive the same main time, period and periods left from the log', async () => {
    const { h, A, B } = await joined({ create: { tc: '1m3x10', color: 'B' } });
    await play(h, [A, B], ['cc', 'gg']); // first moves untimed
    await play(h, [A, B], ['cg'], 65_000); // Black: main time and 5 s of the first period: kept
    await play(h, [A, B], ['gc'], 30_000);
    await play(h, [A, B], ['ce'], 25_000); // Black: 25 s in periods: two used, one kept
    const tc = A.ctrl.snapshot.tc!;
    for (const d of [A, B]) {
      expect(zengo.clocks(d.ctrl.snapshot.game, tc)).toEqual({
        B: { mainMs: 0, periodMs: 10_000, periods: 1 },
        W: { mainMs: 30_000, periodMs: 10_000, periods: 3 },
      });
    }
    expect(timeLeft(zengo, B.ctrl.snapshot.game, tc, 0)).toBe(30_000 + 3 * 10_000);
  });

  it("the opponent's flag in the last period is claimed after 2 s at zero; both show the same end", async () => {
    const h = createHarness({ code: CODE });
    let frozenAt: number | null = null;
    const A = h.device('A', { create: { tc: '1m2x10', color: 'B' }, now: () => frozenAt ?? h.time.t });
    const B = h.device('B');
    await h.settle();
    await play(h, [A, B], ['cc', 'gg']);
    frozenAt = h.time.t; // A's tab stalls on its own turn and never sees its flag fall
    const tc = B.ctrl.snapshot.tc!;
    // B's view of Black's clock: main time and both periods, then 2 s of grace.
    const left = timeLeft(zengo, B.ctrl.snapshot.game, tc, B.ctrl.elapsed());
    expect(left).toBeGreaterThan(79_000);
    await h.advance(left);
    expect(end(B)).toBeUndefined();
    await h.advance(1999);
    expect(end(B)).toBeUndefined();
    expect(B.ctrl.flag()).toBe(false);
    await h.advance(1);
    for (const d of [A, B]) expect(end(d)).toEqual({ result: { winner: 'W', by: 'time' } });
    expect(h.sent().filter((e) => e.msg.t === 'end').map((e) => who(h, e.from))).toEqual(['B']);
    expect(B.ctrl.snapshot.score).toEqual([0, 2]);
    expectConverged(A, B);
  });

  it('a disconnect in byo-yomi pauses the clock; it resumes from the time the mover reports', async () => {
    const { h, A, B } = await joined({ create: { tc: '1m2x10', color: 'B' } });
    await play(h, [A, B], ['cc', 'gg']);
    await h.advance(65_000); // Black: 5 s into the first period
    h.net.link(CODE)?.disconnect();
    await h.advance(100);
    const used = A.ctrl.elapsed();
    await h.advance(120_000);
    for (const d of [A, B]) {
      expect(end(d)).toBeUndefined();
      expect(d.ctrl.snapshot.clock.paused).toBe(true);
      expect(d.ctrl.snapshot.locked).toBe('disconnected');
    }
    expect(A.ctrl.elapsed()).toBe(used);
    h.net.link(CODE)?.reconnect();
    await h.advance(200);
    expect(A.ctrl.elapsed()).toBe(used + 200); // counting again from where it paused
    expect(B.ctrl.elapsed()).toBe(A.ctrl.elapsed()); // B took the turn time A reported
    // Black is in its first period (5 s used of it); the rest of it and the last period remain.
    const left = timeLeft(zengo, A.ctrl.snapshot.game, A.ctrl.snapshot.tc!, A.ctrl.elapsed());
    expect(left).toBe(80_000 - A.ctrl.elapsed());
    expect(left).toBeLessThan(15_000);
    await h.advance(left - 1);
    expect(end(A)).toBeUndefined();
    await h.advance(1);
    for (const d of [A, B]) expect(end(d)).toEqual({ result: { winner: 'W', by: 'time' } });
  });

  it('clocks stop during scoring; after a resume the mover continues from the log', async () => {
    const { h, A, B } = await joined({ create: { tc: '1m2x10', color: 'B' } });
    await play(h, [A, B], ['cc', 'gg']);
    await play(h, [A, B], ['tt'], 50_000); // Black: 10 s of main time left
    await play(h, [A, B], ['tt'], 20_000);
    expect(scoring(A)).toBeDefined();
    await h.advance(600_000);
    for (const d of [A, B]) {
      expect(end(d)).toBeUndefined();
      expect(d.ctrl.snapshot.clock.turnStart).toBeNull();
      expect(d.ctrl.flag()).toBe(false);
    }
    B.ctrl.resume();
    await h.advance(100);
    expect(A.ctrl.snapshot.myTurn).toBe(true);
    const left = timeLeft(zengo, A.ctrl.snapshot.game, A.ctrl.snapshot.tc!, 0);
    expect(left).toBe(10_000 + 2 * 10_000);
    await h.advance(left - 100 - 1);
    expect(end(A)).toBeUndefined();
    await h.advance(1);
    for (const d of [A, B]) expect(end(d)).toEqual({ result: { winner: 'W', by: 'time' } });
    expectConverged(A, B);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Randomized: engines, delays, lost scoring messages, disconnects                                  */
/* ---------------------------------------------------------------------------------------------- */

describe('randomized scoring sessions', () => {
  /** The stones of `g` as points. */
  function stonesOf(g: Game): Point[] {
    const out: Point[] = [];
    const n = g.settings.size;
    g.board.forEach((v, i) => {
      if (v) out.push(String.fromCharCode(97 + (i % n), 97 + Math.floor(i / n)));
    });
    return out;
  }

  /** An engine that proposes its own (arbitrary, device-specific) dead stones, sync or async, or fails. */
  function engine(kind: number, bias: number): DeviceOptions['propose'] {
    const pick = (g: Game) => stonesOf(g).filter((p) => (p.charCodeAt(0) + p.charCodeAt(1)) % 3 === bias);
    switch (kind) {
      case 0:
        return null; // no engine
      case 1:
        return (g) => pick(g);
      case 2:
        return async (g) => pick(g);
      default:
        return async () => null; // an engine that never answers
    }
  }

  it('both devices always converge to identical logs, without toasts, whatever the engines and losses', async () => {
    const { seeded } = await import('./testkit');
    let scored = 0;
    let handovers = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = seeded(seed * 7121);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
      const kindA = Math.floor(rnd() * 4);
      const kindB = Math.floor(rnd() * 4);
      const { h, A, B } = await joined({
        create: { tc: null, color: pick(['B', 'W'] as const) },
        a: { propose: engine(kindA, 0) },
        b: { propose: engine(kindB, 1) },
        memory: { delayMs: Math.floor(rnd() * 60) },
      });
      const devs = [A, B];
      const link = () => h.net.link(CODE);
      let up = true;
      let dropping = false;
      const trace: string[] = [];
      for (let step = 0; step < 90; step++) {
        const r = rnd();
        const snapA = A.ctrl.snapshot;
        const inScoring = devs.some((d) => d.ctrl.snapshot.game.scoring && !d.ctrl.snapshot.game.end);
        const s = (d: Device) => {
          const g = d.ctrl.snapshot.game;
          return `${d.ctrl.snapshot.n}/${d.ctrl.snapshot.epoch}/${g.plies.length}${g.scoring ? `S${g.scoring.round}.${g.scoring.rev}[${g.scoring.accepted}]` : ''}${g.end ? 'E' : ''}`;
        };
        trace.push(`#${step} up=${up} drop=${dropping} A=${s(A)} B=${s(B)} r=${r.toFixed(2)}`);
        if (r < 0.05) {
          if (up) link()?.disconnect();
          else link()?.reconnect();
          up = !up;
        } else if (r < 0.12) {
          dropping = !dropping;
          link()?.setDrop(dropping ? (m) => ['mark', 'accept', 'resume', 'end'].includes(m.t) && rnd() < 0.5 : false);
        } else if (inScoring && r < 0.6) {
          const d = pick(devs);
          const snap = d.ctrl.snapshot;
          const k = rnd();
          if (k < 0.45 && snap.canMark && snap.game.scoring) {
            const stones = stonesOf(snap.game);
            if (stones.length) d.ctrl.mark(scoringApi.toggle(snap.game, snap.game.scoring.dead, pick(stones)));
          } else if (k < 0.9) d.ctrl.accept();
          else d.ctrl.resume();
        } else if (r < 0.8) {
          const mover = devs.find((d) => d.ctrl.snapshot.myTurn);
          const g = mover?.ctrl.snapshot.game;
          if (mover && g) {
            let p: Point = 'tt';
            if (rnd() > 0.35) {
              for (let tries = 0; tries < 20; tries++) {
                const q = String.fromCharCode(97 + Math.floor(rnd() * 9), 97 + Math.floor(rnd() * 9));
                if (zengo.isLegal(g, q)) {
                  p = q;
                  break;
                }
              }
            }
            mover.ctrl.move(p, Math.floor(rnd() * 3000));
          }
        } else if (up && r < 0.88) {
          const asker = pick(devs);
          const kind = pick(['takeback', 'rematch'] as const);
          if (asker.ctrl.ask(kind)) {
            await h.advance(200);
            devs.find((d) => d !== asker)?.ctrl.reply(kind, rnd() < 0.7);
          }
        } else if (up && !dropping && r < 0.9 && hashes(A).join() === hashes(B).join()) {
          // Resigning only on agreed copies: two different finished copies would be a true fork.
          pick(devs).ctrl.resign();
        } else if (up && snapA.game.end && r < 0.97) {
          A.ctrl.ask('rematch');
          await h.advance(200);
          B.ctrl.reply('rematch', true);
        }
        await h.advance(Math.floor(rnd() * RESEND * 1.5));
        for (const d of devs) if (d.ctrl.snapshot.game.end?.result.by === 'score') scored++;
      }
      handovers += h.sent().filter((e) => e.msg.t === 'mark' && (e.msg as MarkMsg).rev === 0).length;
      link()?.setDrop(false);
      if (!up) link()?.reconnect();
      await h.advance(RESEND * 4);
      const msg = `seed ${seed} engines ${kindA}/${kindB}\n${trace.join('\n')}`;
      expect(A.ctrl.snapshot.live && B.ctrl.snapshot.live, msg).toBe(true);
      expect(hashes(A), msg).toEqual(hashes(B));
      for (const d of devs) {
        expect(d.kinds(), msg).not.toContain('sync-error');
        expect(d.kinds(), msg).not.toContain('restored-from-opponent');
      }
      expect(A.ctrl.snapshot.score).toEqual(B.ctrl.snapshot.score);
      expect(A.ctrl.snapshot.unsent + B.ctrl.snapshot.unsent, msg).toBe(0);
      // Quiet once settled: no probes or hand-overs keep going.
      const before = h.sent().length;
      await h.advance(RESEND * 5);
      const extra = h.sent().slice(before).filter((e) => e.msg.t !== 'ping' && e.msg.t !== 'pong');
      expect(extra.map((e) => e.msg.t), msg).toEqual([]);
    }
    expect(scored).toBeGreaterThan(0);
    expect(handovers).toBeGreaterThan(0);
  }, 60_000);
});
