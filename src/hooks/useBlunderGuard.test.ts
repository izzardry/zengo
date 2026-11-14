import { act, renderHook } from '@testing-library/react';
import { FakeEngine, movesKey, type FakeEval } from '@/lib/engine/fake';
import { BEFORE_TIMEOUT_MS, CONFIRM_WINDOW_MS } from '@/lib/blunder';
import type { EngineApi, Game, Position } from '@/lib/types';
import { fromDiagram, play } from '@/lib/zengo';
import { useBlunderGuard, type BlunderCheck, type UseBlunderGuardOptions } from './useBlunderGuard';

/**
 * Prepared 9×9 position, Black (the player) to move. Black's two stones c5–d5 have two liberties;
 * d4 (`df`) self-ataris three stones (rules check). Black a9 (`aa`) is scripted as a big drop
 * (the engine check); Black g3 (`gg`) is scripted as a fine move.
 */
const POS = fromDiagram([
  '.........',
  '.........',
  '.........',
  '..ooo....',
  '.oxx.o...',
  '..o.o....',
  '...o.....',
  '.........',
  '.........',
]);

/** Evaluations by plies: '' = before (Black to move), 'aa' / 'gg' = after (White to move). */
const EVALS: Record<string, FakeEval> = {
  '': { winrate: 0.6, scoreLead: 2 },
  // Black's view after a9: lead −6, win rate 0.3 → a drop of 8 points and 30 win-rate points.
  aa: { winrate: 0.7, scoreLead: 6 },
  // Black's view after g3: lead +1.5, win rate 0.55 → fine.
  gg: { winrate: 0.45, scoreLead: -1.5 },
};

let t = 0;
const now = () => t;

async function advance(ms: number) {
  t += ms;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function ready(engine: FakeEngine) {
  await act(async () => {
    await engine.load(1);
  });
}

function setup(engine: EngineApi, over: Partial<UseBlunderGuardOptions> = {}) {
  const onAssisted = vi.fn();
  const initialProps: UseBlunderGuardOptions = {
    engine,
    game: POS,
    enabled: true,
    playerColor: 'B',
    now,
    onAssisted,
    sessionKey: 's1',
    ...over,
  };
  const hook = renderHook((p: UseBlunderGuardOptions) => useBlunderGuard(p), { initialProps });
  return { ...hook, onAssisted, rerender: (p: Partial<UseBlunderGuardOptions>) => hook.rerender({ ...initialProps, ...p }) };
}

/** Runs `check` and lets timers and promises settle for up to `ms`. */
async function check(hook: { result: { current: { check(p: string): Promise<BlunderCheck> } } }, point: string, ms = 200) {
  let out: BlunderCheck | undefined;
  let p!: Promise<BlunderCheck>;
  act(() => {
    p = hook.result.current.check(point);
  });
  void p.then((r) => (out = r));
  await advance(ms);
  return out;
}

const evaluations = (engine: FakeEngine) =>
  engine.calls.filter((c) => c.method === 'evaluate').map((c) => movesKey(c.args[0] as Position));

beforeEach(() => {
  vi.useFakeTimers();
  t = 1000;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useBlunderGuard', () => {
  it('evaluates the position with the small net when the player\'s turn begins', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const hook = setup(engine);
    expect(hook.result.current.active).toBe(true);
    const calls = engine.calls.filter((c) => c.method === 'evaluate');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toEqual({ net: 'small' });
    expect(calls[0].args[2]).toBe(BEFORE_TIMEOUT_MS);
    expect(movesKey(calls[0].args[0] as Position)).toBe('');
  });

  it('starts nothing while the engine is not ready, off, or on the computer\'s turn', async () => {
    const idle = new FakeEngine({ evals: EVALS });
    setup(idle);
    expect(idle.calls).toEqual([]);

    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const off = setup(engine, { enabled: false });
    expect(off.result.current.active).toBe(false);
    const theirs = setup(engine, { playerColor: 'W' });
    expect(theirs.result.current.active).toBe(false);
    expect(evaluations(engine)).toEqual([]);
  });

  it('bounces a stone that drops the score lead and the win rate, once; the same stone within 5 s commits', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);

    const first = await check(hook, 'aa');
    expect(first).toEqual({ action: 'refuse', point: 'aa', reason: 'drop' });
    expect(hook.result.current.blunder).toBe('aa');
    expect(hook.result.current.blunderKey).toBe(1);
    expect(hook.onAssisted).toHaveBeenCalledTimes(1);
    // The turn's "before" evaluation was reused: only one more evaluation (the "after").
    expect(evaluations(engine)).toEqual(['', 'aa']);

    await advance(CONFIRM_WINDOW_MS - 1000);
    expect(await check(hook, 'aa')).toEqual({ action: 'commit' });
    expect(hook.onAssisted).toHaveBeenCalledTimes(1);
  });

  it('bounces again after the 5-second window', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);
    expect((await check(hook, 'aa'))?.action).toBe('refuse');
    await advance(CONFIRM_WINDOW_MS + 100);
    expect((await check(hook, 'aa'))?.action).toBe('refuse');
    expect(hook.result.current.blunderKey).toBe(2);
  });

  it('lets a good stone through', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);
    expect(await check(hook, 'gg')).toEqual({ action: 'commit' });
    expect(hook.result.current.blunder).toBeNull();
    expect(hook.onAssisted).not.toHaveBeenCalled();
  });

  it('bounces a self-atari of three stones without the engine', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    const hook = setup(engine);
    const out = await check(hook, 'df', 0);
    expect(out).toEqual({ action: 'refuse', point: 'df', reason: 'self-atari' });
    expect(engine.calls).toEqual([]);
    expect(hook.onAssisted).toHaveBeenCalledTimes(1);
    expect(await check(hook, 'df', 0)).toEqual({ action: 'commit' });
  });

  it('lets the stone through when the engine is late (150 ms)', async () => {
    const engine = new FakeEngine({ evals: EVALS, delayMs: 1000 });
    await ready(engine);
    const hook = setup(engine);
    await advance(1100);
    let out: BlunderCheck | undefined;
    act(() => {
      void hook.result.current.check('aa').then((r) => (out = r));
    });
    await advance(149);
    expect(out).toBeUndefined();
    expect(hook.result.current.checking).toBe('aa');
    await advance(1);
    // No "after" evaluation in time: the stone goes through.
    expect(out).toEqual({ action: 'commit' });
    expect(hook.result.current.checking).toBeNull();
    expect(hook.result.current.blunder).toBeNull();
  });

  it('commits at once when the "after" evaluation never comes', async () => {
    const engine = new FakeEngine({ evals: { ...EVALS, aa: null as unknown as FakeEval } });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);
    expect(await check(hook, 'aa')).toEqual({ action: 'commit' });
  });

  it('frees the queue for the "after" evaluation (stop) once the "before" one is in', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);
    const stops = engine.stops;
    await check(hook, 'gg');
    expect(engine.stops).toBe(stops + 1);
  });

  it('commits passes, illegal points, and everything while off or not the player\'s turn', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);
    expect(await check(hook, 'tt')).toEqual({ action: 'commit' });
    expect(await check(hook, 'cd')).toEqual({ action: 'commit' });
    const off = setup(engine, { enabled: false });
    expect(await check(off, 'df')).toEqual({ action: 'commit' });
    const theirs = setup(engine, { playerColor: 'W' });
    expect(await check(theirs, 'df')).toEqual({ action: 'commit' });
  });

  it('answers stale when the position changes during the check, and forgets the pulse', async () => {
    const engine = new FakeEngine({ evals: EVALS, delayMs: 100 });
    await ready(engine);
    const hook = setup(engine);
    await advance(200);
    let out: BlunderCheck | undefined;
    act(() => {
      void hook.result.current.check('aa').then((r) => (out = r));
    });
    const next: Game = play(POS, 'gg', 0);
    hook.rerender({ game: next });
    await advance(200);
    expect(out).toEqual({ action: 'stale' });
    expect(hook.result.current.blunder).toBeNull();
  });

  it('clear() forgets the refusal: the same stone is checked again', async () => {
    const engine = new FakeEngine({ evals: EVALS });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);
    expect((await check(hook, 'aa'))?.action).toBe('refuse');
    act(() => hook.result.current.clear());
    expect(hook.result.current.blunder).toBeNull();
    expect((await check(hook, 'aa'))?.action).toBe('refuse');
  });
});
