import { describe, expect, it, vi } from 'vitest';
import { FakeEngine } from './engine/fake';
import { PROPOSAL_TIMEOUT_MS, PROPOSAL_VISITS, createDeadStoneProposer, proposalNet, proposeDeadStones } from './proposal';
import type { DeadStoneProposer } from '@/hooks/useGameState';
import type { EngineApi, Position } from './types';
import { fromDiagram, pass, pointToIndex } from './zengo';

/**
 * A finished 9×9 game in scoring: Black owns the left, White the right; a white stone at b5 (`be`)
 * sits dead inside Black's area and a black stone at h5 (`he`) inside White's.
 */
const ROWS = [
  '...xo....',
  '...xo....',
  '...xo....',
  '...xo....',
  '.o.xo..x.',
  '...xo....',
  '...xo....',
  '...xo....',
  '...xo....',
];
const SCORING = pass(pass(fromDiagram(ROWS, 'B'), 0), 0);

/** Ownership: left of column e Black (+0.95), the rest White (−0.95). */
function ownership(): Float32Array {
  const o = new Float32Array(81);
  for (let i = 0; i < 81; i++) o[i] = i % 9 <= 3 ? 0.95 : -0.95;
  return o;
}

describe('proposeDeadStones (DESIGN 8.4)', () => {
  it('runs a 100-visit search on the small net and marks stones owned by the opponent', async () => {
    const engine = new FakeEngine({ evals: () => ({ winrate: 0.5, scoreLead: 0, ownership: ownership() }) });
    expect(SCORING.scoring?.round).toBe(1);
    const dead = await proposeDeadStones(engine, SCORING);
    expect(dead).toEqual(['be', 'he']);
    const call = engine.calls.find((c) => c.method === 'evaluate')!;
    expect(call.args[1]).toEqual({ visits: PROPOSAL_VISITS, timeMs: 3000, net: 'small' });
    expect(call.args[2]).toBe(PROPOSAL_TIMEOUT_MS);
    expect((call.args[0] as Position).moves).toEqual(['tt', 'tt']);
  });

  it('uses the large net when it is loaded', async () => {
    const engine = new FakeEngine({ evals: () => ({ winrate: 0.5, scoreLead: 0, ownership: ownership() }) });
    await engine.load(2);
    expect(proposalNet(engine)).toBe('large');
    await proposeDeadStones(engine, SCORING);
    expect(engine.calls.find((c) => c.method === 'evaluate')!.args[1]).toMatchObject({ net: 'large' });
  });

  it('keeps stones the engine is unsure about alive (below 0.7)', async () => {
    const o = ownership();
    o[pointToIndex('be', 9)] = 0.6;
    const engine = new FakeEngine({ evals: () => ({ winrate: 0.5, scoreLead: 0, ownership: o }) });
    expect(await proposeDeadStones(engine, SCORING)).toEqual(['he']);
  });

  it('proposes nothing (every stone alive) without an answer', async () => {
    const none = new FakeEngine({ evals: () => null });
    expect(await proposeDeadStones(none, SCORING)).toBeNull();
    const failed = new FakeEngine({ loadResult: 'fail' });
    await failed.load(1).catch(() => undefined);
    expect(failed.state).toBe('failed');
    expect(await proposeDeadStones(failed, SCORING)).toBeNull();
    const throwing = { ...new FakeEngine(), state: 'ready', nets: { small: true, large: false }, evaluate: () => Promise.reject(new Error('x')) } as unknown as EngineApi;
    expect(await proposeDeadStones(throwing, SCORING)).toBeNull();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const slow = new FakeEngine({ delayMs: 60_000, evals: () => ({ winrate: 0.5, scoreLead: 0, ownership: ownership() }) });
      let out: unknown = 'pending';
      void proposeDeadStones(slow, SCORING, { timeoutMs: 1000 }).then((d) => (out = d));
      await vi.advanceTimersByTimeAsync(1000);
      expect(out).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('works as useGameState\'s proposeDead, reading the engine at call time', async () => {
    const engine = new FakeEngine({ evals: () => ({ winrate: 0.5, scoreLead: 0, ownership: ownership() }) });
    let current: EngineApi | null = null;
    const propose = createDeadStoneProposer(() => current);
    expect(await propose(SCORING)).toBeNull();
    current = engine;
    expect(await propose(SCORING)).toEqual(['be', 'he']);
    const asOption: DeadStoneProposer = createDeadStoneProposer(engine);
    expect(await asOption(SCORING)).toEqual(['be', 'he']);
  });
});
