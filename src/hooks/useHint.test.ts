import { act, renderHook } from '@testing-library/react';
import { FakeEngine, movesKey, type FakeAnalysis } from '@/lib/engine/fake';
import type { EngineApi, Position } from '@/lib/types';
import { PASS, makeSettings, newGame, play } from '@/lib/zengo';
import { PRECOMPUTE_DELAY_MS, formatLead, useHint, type UseHintOptions } from './useHint';

const G0 = newGame(makeSettings(9));
const G1 = play(G0, 'ee', 0);

/** Top moves by position: at the start ee, cc, gg, then pass; after ee (White to move) a pass first. */
const analysis: FakeAnalysis = (pos) =>
  movesKey(pos) === ''
    ? [
        { move: 'ee', winrate: 0.5, scoreLead: 0 },
        { move: 'cc', winrate: 0.5, scoreLead: 0 },
        { move: 'gg', winrate: 0.5, scoreLead: 0 },
        { move: PASS, winrate: 0.5, scoreLead: 0 },
      ]
    : [
        { move: PASS, winrate: 0.5, scoreLead: 0 },
        { move: 'cc', winrate: 0.5, scoreLead: 0 },
      ];

/** Score leads for the side to move: Black leads 3.5 at the start; after ee White (to move) trails 3.5. */
const evals = (pos: Position) => {
  const ownership = new Float32Array(81).fill(0.25);
  return movesKey(pos) === '' ? { winrate: 0.6, scoreLead: 3.5, ownership } : { winrate: 0.4, scoreLead: -3.5, ownership };
};

function setup(engine: EngineApi, over: Partial<UseHintOptions> = {}) {
  const onAssisted = vi.fn();
  const onUnavailable = vi.fn();
  const onFail = vi.fn();
  const initialProps: UseHintOptions = { engine, game: G0, enabled: true, onAssisted, onUnavailable, onFail, sessionKey: 's', ...over };
  const hook = renderHook((p: UseHintOptions) => useHint(p), { initialProps });
  return { ...hook, onAssisted, onUnavailable, onFail, rerender: (p: Partial<UseHintOptions>) => hook.rerender({ ...initialProps, ...p }) };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function ready(engine: FakeEngine) {
  await act(async () => {
    await engine.load(1);
  });
}

const methods = (engine: FakeEngine) => engine.calls.filter((c) => c.method !== 'load').map((c) => c.method);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useHint', () => {
  it('precomputes the top moves and the ownership while the player thinks', async () => {
    const engine = new FakeEngine({ analysis, evals });
    await ready(engine);
    setup(engine);
    expect(methods(engine)).toEqual([]);
    await advance(PRECOMPUTE_DELAY_MS);
    expect(methods(engine)).toEqual(['analyze', 'evaluate']);
    const ev = engine.calls.find((c) => c.method === 'evaluate')!;
    expect(ev.args[1]).toMatchObject({ net: 'small' });
  });

  it('tap 1 pulses the best point and marks the game assisted; tap 2 shows the top three', async () => {
    const engine = new FakeEngine({ analysis, evals });
    await ready(engine);
    const hook = setup(engine);
    await advance(PRECOMPUTE_DELAY_MS);
    act(() => hook.result.current.tap());
    expect(hook.result.current.hint).toEqual({ best: 'ee' });
    expect(hook.result.current.step).toBe(1);
    expect(hook.onAssisted).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.tap());
    expect(hook.result.current.hint).toEqual({ top: ['ee', 'cc', 'gg'] });
    expect(hook.result.current.step).toBe(2);
    const first = hook.result.current.hint;
    act(() => hook.result.current.tap());
    expect(hook.result.current.hint).toEqual({ top: ['ee', 'cc', 'gg'] });
    expect(hook.result.current.hint).not.toBe(first);
    // No extra searches: the precomputation answered all taps.
    expect(methods(engine)).toEqual(['analyze', 'evaluate']);
  });

  it('asks the engine on a tap before the precomputation, and shows pending meanwhile', async () => {
    const engine = new FakeEngine({ analysis, evals, delayMs: 200 });
    const hook = setup(engine, { available: true, precomputeDelayMs: -1 });
    act(() => hook.result.current.tap());
    expect(hook.result.current.pending).toBe(true);
    expect(hook.result.current.hint).toBeNull();
    await advance(200);
    expect(hook.result.current.pending).toBe(false);
    expect(hook.result.current.hint).toEqual({ best: 'ee' });
    expect(hook.onAssisted).toHaveBeenCalledTimes(1);
  });

  it('says so when the best move is a pass', async () => {
    const engine = new FakeEngine({ analysis, evals });
    await ready(engine);
    const hook = setup(engine, { game: G1 });
    await advance(PRECOMPUTE_DELAY_MS);
    act(() => hook.result.current.tap());
    expect(hook.result.current.passBest).toBe(true);
    expect(hook.result.current.hint).toBeNull();
    act(() => hook.result.current.tap());
    expect(hook.result.current.hint).toEqual({ top: ['cc'] });
  });

  it('forgets the hint on the next move', async () => {
    const engine = new FakeEngine({ analysis, evals });
    await ready(engine);
    const hook = setup(engine);
    await advance(PRECOMPUTE_DELAY_MS);
    act(() => hook.result.current.tap());
    expect(hook.result.current.step).toBe(1);
    hook.rerender({ game: G1 });
    expect(hook.result.current.hint).toBeNull();
    expect(hook.result.current.step).toBe(0);
  });

  it('does nothing while disabled', async () => {
    const engine = new FakeEngine({ analysis, evals });
    await ready(engine);
    const hook = setup(engine, { enabled: false });
    await advance(1000);
    act(() => hook.result.current.tap());
    act(() => hook.result.current.previewStart());
    expect(hook.result.current.hint).toBeNull();
    expect(hook.result.current.preview).toBeNull();
    expect(methods(engine)).toEqual([]);
  });

  it('shows the territory preview while held, with the B+ line, and marks the game assisted', async () => {
    const engine = new FakeEngine({ analysis, evals });
    await ready(engine);
    const hook = setup(engine);
    await advance(PRECOMPUTE_DELAY_MS);
    act(() => hook.result.current.previewStart());
    expect(hook.result.current.preview?.note).toBe('B+3.5');
    expect(hook.result.current.preview?.ownership).toHaveLength(81);
    expect(hook.onAssisted).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.previewEnd());
    expect(hook.result.current.preview).toBeNull();
  });

  it('reads the lead from Black\'s view when White is to move', async () => {
    const engine = new FakeEngine({ analysis, evals });
    await ready(engine);
    const hook = setup(engine, { game: G1 });
    act(() => hook.result.current.previewStart());
    expect(hook.result.current.previewPending).toBe(true);
    await advance(10);
    expect(hook.result.current.preview?.note).toBe('B+3.5');
    expect(hook.result.current.preview?.blackLead).toBeCloseTo(3.5);
  });

  it('a preview arriving after release is not shown', async () => {
    const engine = new FakeEngine({ analysis, evals, delayMs: 300 });
    await ready(engine);
    const hook = setup(engine, { precomputeDelayMs: -1 });
    act(() => hook.result.current.previewStart());
    act(() => hook.result.current.previewEnd());
    await advance(400);
    expect(hook.result.current.preview).toBeNull();
    expect(hook.onAssisted).not.toHaveBeenCalled();
  });

  it('without the engine the preview shows nothing and says the computer is still downloading', async () => {
    const engine = new FakeEngine({ analysis, evals });
    const hook = setup(engine, { available: false });
    act(() => hook.result.current.previewStart());
    expect(hook.result.current.preview).toBeNull();
    expect(hook.onUnavailable).toHaveBeenCalledTimes(1);
    expect(hook.onAssisted).not.toHaveBeenCalled();
    expect(engine.calls).toEqual([]);
  });

  it('starts a precomputation again after somebody stopped it', async () => {
    const engine = new FakeEngine({ analysis, evals, delayMs: 100 });
    await ready(engine);
    const hook = setup(engine);
    await advance(PRECOMPUTE_DELAY_MS + 50);
    await act(async () => {
      engine.stop();
    });
    await advance(PRECOMPUTE_DELAY_MS + 300);
    expect(methods(engine)).toEqual(['analyze', 'evaluate', 'analyze']);
    act(() => hook.result.current.tap());
    expect(hook.result.current.hint).toEqual({ best: 'ee' });
  });

  it('formats score leads', () => {
    expect(formatLead(3.5)).toBe('B+3.5');
    expect(formatLead(-12.2)).toBe('W+12');
    expect(formatLead(0.1)).toBe('B+0.5');
    expect(formatLead(-0.74)).toBe('W+0.5');
    expect(formatLead(7.76)).toBe('B+8');
  });
});
