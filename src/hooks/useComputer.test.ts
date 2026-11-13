import { act, renderHook } from '@testing-library/react';
import { FakeEngine, movesKey } from '@/lib/engine/fake';
import { ENGINE_STAGES, downloadStage, runningDownload, type EngineStage } from '@/lib/engine/offline';
import { seededRng } from '@/lib/levels';
import type { ClockInfo, EngineApi, EngineGenmoveOptions, EngineMove, Game, Position } from '@/lib/types';
import { PASS, fromDiagram, indexToPoint, isLegal, makeSettings, newGame, pass, play, undo } from '@/lib/zigo';
import { computerResignation, lineKey, useComputer, useEngineStart, type UseComputerOptions } from './useComputer';

type Props = UseComputerOptions;

function setup(over: Partial<Props> & { engine: EngineApi }) {
  const onMove = vi.fn();
  const onFail = vi.fn();
  const onResign = vi.fn();
  const initialProps: Props = {
    game: newGame(makeSettings(9)),
    enabled: true,
    computerColor: 'B',
    level: 5,
    onMove,
    onFail,
    onResign,
    now: () => Date.now(),
    rng: seededRng(1),
    sessionKey: 's1',
    ...over,
  };
  const hook = renderHook((p: Props) => useComputer(p), { initialProps });
  const rerender = (p: Partial<Props>) => hook.rerender({ ...initialProps, ...p });
  return { ...hook, onMove, onFail, onResign, initialProps, rerender };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const genmoves = (engine: FakeEngine) => engine.calls.filter((c) => c.method === 'genmove');

/** A FakeEngine whose genmove answers also carry a win rate and score lead (the real engine's fields). */
function withViews(base: FakeEngine, view: (pos: Position) => Partial<EngineMove>): EngineApi {
  return {
    get state() {
      return base.state;
    },
    get progress() {
      return base.progress;
    },
    get backend() {
      return base.backend;
    },
    get nets() {
      return base.nets;
    },
    load: base.load,
    evaluate: base.evaluate,
    analyze: base.analyze,
    stop: base.stop,
    genmove: (pos: Position, level: number, clock?: ClockInfo, opts?: EngineGenmoveOptions) =>
      base.genmove(pos, level, clock, opts).then((r) => ({ ...r, ...view(pos) })),
  };
}

/** A 9×9 game of `n` legal plies, filling points row-major where legal. */
function longGame(n: number): Game {
  let g = newGame(makeSettings(9));
  let i = 0;
  while (g.cursor < n && i < 400) {
    const p = indexToPoint((i * 7) % 81, 9);
    if (isLegal(g, p)) g = play(g, p, 0);
    i++;
  }
  return g;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useComputer', () => {
  it('moves first as Black in an even game, never before 400 ms', async () => {
    const engine = new FakeEngine({ moves: { '': 'ee' } });
    const { result, onMove } = setup({ engine });
    expect(result.current.thinking).toBe(true);
    await advance(399);
    expect(onMove).not.toHaveBeenCalled();
    await advance(1);
    expect(onMove).toHaveBeenCalledWith('ee', 400);
    expect(result.current.thinking).toBe(false);
    const [call] = genmoves(engine);
    const [pos, level, clock, opts] = call.args as [Position, number, ClockInfo | undefined, EngineGenmoveOptions];
    expect(movesKey(pos)).toBe('');
    expect(level).toBe(5);
    expect(clock).toBeUndefined();
    expect(opts.avoid).toEqual([]);
    expect(Number.isInteger(opts.seed)).toBe(true);
  });

  it('plays as soon as a slow search is done, and reports the time from `elapsed`', async () => {
    const engine = new FakeEngine({ delayMs: 1200 });
    const { onMove } = setup({ engine, elapsed: () => 777 });
    await advance(1199);
    expect(onMove).not.toHaveBeenCalled();
    await advance(1);
    expect(onMove).toHaveBeenCalledWith('aa', 777);
  });

  it('waits for its turn and answers the player\'s stone', async () => {
    const engine = new FakeEngine();
    const g0 = newGame(makeSettings(9));
    const { onMove, rerender } = setup({ engine, game: g0, computerColor: 'W' });
    await advance(1000);
    expect(onMove).not.toHaveBeenCalled();
    expect(engine.calls).toEqual([]);
    rerender({ game: play(g0, 'ee', 0), computerColor: 'W' });
    await advance(400);
    expect(onMove).toHaveBeenCalledWith('aa', expect.any(Number));
  });

  it('moves first as White in a handicap game, and waits as Black', async () => {
    const h2 = newGame(makeSettings(9, 'area', 2));
    expect(h2.turn).toBe('W');
    const white = new FakeEngine();
    const w = setup({ engine: white, game: h2, computerColor: 'W' });
    await advance(400);
    expect(w.onMove).toHaveBeenCalledTimes(1);
    const pos = genmoves(white)[0].args[0] as Position;
    expect(pos.setup.B).toHaveLength(2);
    expect(pos.first).toBe('W');

    const black = new FakeEngine();
    const b = setup({ engine: black, game: h2, computerColor: 'B' });
    await advance(1000);
    expect(b.onMove).not.toHaveBeenCalled();
    expect(genmoves(black)).toEqual([]);
  });

  it('moves again after the very first turn is undone (DESIGN 10.3)', async () => {
    const engine = new FakeEngine();
    const g0 = newGame(makeSettings(9));
    const { onMove, rerender } = setup({ engine, game: g0, computerColor: 'B' });
    await advance(400);
    expect(onMove).toHaveBeenCalledTimes(1);
    const g2 = play(play(g0, 'aa', 0), 'ii', 0);
    rerender({ game: g2 });
    await advance(400);
    expect(onMove).toHaveBeenCalledTimes(2);
    // The player (White) undoes the full turn back to the start: the computer is to move again.
    const back = undo(g2, 2);
    expect(back.cursor).toBe(0);
    rerender({ game: back });
    await advance(400);
    expect(onMove).toHaveBeenCalledTimes(3);
    expect(genmoves(engine).map((c) => movesKey(c.args[0] as Position))).toEqual(['', 'aaii', '']);
  });

  it('asks the engine to avoid big self-ataris from level 3', async () => {
    const g = fromDiagram([
      '.........',
      '.........',
      '.........',
      '..ooo....',
      '.oxxxo...',
      '..o......',
      '...o.....',
      '.........',
      '.........',
    ]);
    const e5 = new FakeEngine();
    setup({ engine: e5, game: g, level: 5 });
    await advance(400);
    expect((genmoves(e5)[0].args[3] as EngineGenmoveOptions).avoid).toEqual(['df']);
    const e2 = new FakeEngine();
    setup({ engine: e2, game: g, level: 2 });
    await advance(400);
    expect((genmoves(e2)[0].args[3] as EngineGenmoveOptions).avoid).toEqual([]);
  });

  it('tells the engine its own clock in a timed game', async () => {
    const engine = new FakeEngine();
    const tc = { kind: 'byoyomi' as const, baseMs: 60_000, periods: 3, periodMs: 10_000 };
    setup({ engine, tc });
    await advance(400);
    expect(genmoves(engine)[0].args[2]).toEqual({ tc, left: { mainMs: 60_000, periodMs: 10_000, periods: 3 } });
    const e2 = new FakeEngine();
    setup({ engine: e2, tc: '5+7' });
    await advance(400);
    expect(genmoves(e2)[0].args[2]).toEqual({ tc: { kind: 'fischer', baseMs: 300_000, incMs: 7000 }, left: { mainMs: 300_000, periodMs: 0, periods: 0 } });
  });

  it('passes when the engine passes; after the player\'s pass that opens scoring', async () => {
    const engine = new FakeEngine({ moves: () => PASS });
    const g0 = pass(newGame(makeSettings(9, 'territory')), 0);
    const { onMove } = setup({ engine, game: g0, computerColor: 'W' });
    await advance(400);
    expect(onMove).toHaveBeenCalledWith(PASS, expect.any(Number));
    const after = pass(g0, 0);
    expect(after.scoring?.round).toBe(1);
  });

  it('fills an open dame instead of passing under area rules, and passes under territory rules', async () => {
    const rows = [
      '.xxxxooo.',
      'xxxxxoooo',
      '.xxxxooo.',
      'xxxxxoooo',
      '.xxx.ooo.',
      'xxxxooooo',
      '.xxxoooo.',
      'xxxxooooo',
      '.xxxoooo.',
    ];
    const area = new FakeEngine({ moves: () => PASS });
    const a = setup({ engine: area, game: fromDiagram(rows, 'B', { rules: 'area' }) });
    await advance(400);
    expect(a.onMove).toHaveBeenCalledWith('ee', expect.any(Number));
    expect(area.calls.filter((c) => c.method === 'evaluate')).toHaveLength(1);

    const territory = new FakeEngine({ moves: () => PASS });
    const t = setup({ engine: territory, game: fromDiagram(rows, 'B', { rules: 'territory' }) });
    await advance(400);
    expect(t.onMove).toHaveBeenCalledWith(PASS, expect.any(Number));
    expect(territory.calls.filter((c) => c.method === 'evaluate')).toHaveLength(0);
  });

  it('resigns at level 5 after three hopeless turns past the opening (DESIGN 10.4)', async () => {
    const base = new FakeEngine();
    const engine = withViews(base, () => ({ winrate: 0.01, scoreLead: -25 }));
    let g = longGame(34);
    expect(g.turn).toBe('B');
    const { onMove, onResign, rerender } = setup({ engine, game: g, computerColor: 'B', level: 5 });
    for (let turn = 1; turn <= 2; turn++) {
      await advance(400);
      expect(onResign).not.toHaveBeenCalled();
      expect(onMove).toHaveBeenCalledTimes(turn);
      const m = onMove.mock.calls[turn - 1][0] as string;
      g = play(g, m, 0);
      const reply = Array.from({ length: 81 }, (_, i) => indexToPoint(i, 9)).find((p) => isLegal(g, p))!;
      g = play(g, reply, 0);
      rerender({ game: g });
    }
    await advance(399);
    expect(onResign).not.toHaveBeenCalled();
    await advance(1);
    expect(onResign).toHaveBeenCalledWith({ winner: 'W', by: 'resign' });
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('never resigns at levels 1–4, nor before 0.4 moves per point', async () => {
    const base = new FakeEngine();
    const engine = withViews(base, () => ({ winrate: 0.01, scoreLead: -25 }));
    for (const [level, plies] of [
      [4, 40],
      [5, 20],
    ] as const) {
      let g = longGame(plies);
      const color = g.turn;
      const { onMove, onResign, rerender, unmount } = setup({ engine, game: g, computerColor: color, level });
      for (let turn = 1; turn <= 4; turn++) {
        await advance(400);
        const m = onMove.mock.calls[turn - 1][0] as string;
        g = play(g, m, 0);
        const reply = Array.from({ length: 81 }, (_, i) => indexToPoint(i, 9)).find((p) => isLegal(g, p)) ?? PASS;
        g = play(g, reply, 0);
        rerender({ game: g });
      }
      expect(onResign).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('ignores a stale answer and stops its search when the position changes', async () => {
    const engine = new FakeEngine({ delayMs: 1000 });
    const g0 = newGame(makeSettings(9));
    const { onMove, rerender } = setup({ engine, game: g0, computerColor: 'B' });
    await advance(300);
    rerender({ enabled: false });
    expect(engine.stops).toBe(1);
    await advance(2000);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('retries a search that somebody else stopped', async () => {
    const engine = new FakeEngine({ delayMs: 500 });
    const { onMove } = setup({ engine });
    await advance(100);
    act(() => engine.stop());
    await advance(1000);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(genmoves(engine)).toHaveLength(2);
  });

  it('reports a failed engine and tries again on retry()', async () => {
    const engine = new FakeEngine({ loadResult: 'fail' });
    const { result, onFail, onMove } = setup({ engine });
    await advance(10);
    expect(result.current.failed).toBe(true);
    expect(onFail).toHaveBeenCalledTimes(1);
    engine.setLoadResult('ready');
    act(() => result.current.retry());
    await advance(400);
    expect(result.current.failed).toBe(false);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('does nothing in scoring, after the end, or when off', async () => {
    const engine = new FakeEngine();
    const scoring = pass(pass(newGame(makeSettings(9)), 0), 0);
    setup({ engine, game: scoring, computerColor: scoring.turn });
    setup({ engine, enabled: false });
    await advance(1000);
    expect(engine.calls).toEqual([]);
  });

  it('helpers', () => {
    expect(computerResignation('B')).toEqual({ winner: 'W', by: 'resign' });
    expect(computerResignation('W')).toEqual({ winner: 'B', by: 'resign' });
    const g = play(play(newGame(makeSettings(9)), 'ee', 0), 'cc', 0);
    expect(lineKey(g)).toBe('eecc');
    expect(lineKey(undo(g, 1))).toBe('ee');
  });
});

describe('useEngineStart', () => {
  it('loads stage 1 for levels 1–7 and stage 2 for 8–12, with the spinner meanwhile', async () => {
    const engine = new FakeEngine({ loadMs: 100 });
    const hook = renderHook((e: EngineApi) => useEngineStart(e), { initialProps: engine as EngineApi });
    let ok: boolean | undefined;
    act(() => {
      void hook.result.current.prepare(5).then((r) => (ok = r));
    });
    expect(hook.result.current.loading).toBe(true);
    await advance(100);
    expect(ok).toBe(true);
    expect(hook.result.current.loading).toBe(false);
    expect(engine.calls.filter((c) => c.method === 'load').map((c) => c.args[0])).toEqual([1]);

    act(() => {
      void hook.result.current.prepare(8).then((r) => (ok = r));
    });
    await advance(10);
    expect(engine.calls.filter((c) => c.method === 'load').map((c) => c.args[0])).toEqual([1, 2]);
    expect(engine.nets.large).toBe(true);
    hook.rerender(engine);
    // Ready with both nets: no load at all.
    let again: boolean | undefined;
    await act(async () => {
      again = await hook.result.current.prepare(12);
    });
    expect(again).toBe(true);
    expect(engine.calls.filter((c) => c.method === 'load')).toHaveLength(2);
  });

  /**
   * The page's download of `stage` (lib/engine/offline.ts), fed by hand: `feed(fraction)` delivers that
   * share of every file, `end()` the rest, `fail()` errors every file.
   */
  function pageDownload(stage: EngineStage) {
    const BASE = 'https://example.test/zigo/';
    const SIZE = 1000;
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const sent: number[] = [];
    const fetch = (async (url: string) => {
      const asset = ENGINE_STAGES[stage].find((a) => BASE + a.path === url)!;
      const head = asset.kind === 'wasm' ? [0x00, 0x61, 0x73, 0x6d] : [0x1f, 0x8b];
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          streams.push(c);
          sent.push(0);
          const first = new Uint8Array(head.length);
          first.set(head);
          c.enqueue(first);
          sent[sent.length - 1] = head.length;
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(SIZE) } });
    }) as unknown as typeof globalThis.fetch;
    const store = new Map<string, Response>();
    const cache = { match: async (u: string) => store.get(u), put: async (u: string, r: Response) => void store.set(u, r) };
    const caches = { open: async () => cache } as unknown as CacheStorage;
    const done = downloadStage(stage, BASE, () => undefined, undefined, { caches, fetch }).then(
      () => true,
      () => false,
    );
    const feed = (to: number) =>
      streams.forEach((c, i) => {
        const n = Math.round(SIZE * to) - sent[i];
        if (n > 0) c.enqueue(new Uint8Array(n));
        sent[i] += Math.max(0, n);
      });
    return {
      done,
      feed,
      end: () => {
        feed(1);
        streams.forEach((c) => c.close());
      },
      fail: () => streams.forEach((c) => c.error(new Error('network'))),
    };
  }

  const loads = (engine: FakeEngine) => engine.calls.filter((c) => c.method === 'load').map((c) => c.args[0]);

  it('waits for the page\'s running stage 1 download, with its percent on the pill, then loads the engine', async () => {
    const engine = new FakeEngine({ loadMs: 100 });
    const page = pageDownload(1);
    await advance(0);
    page.feed(0.5);
    await advance(0);
    expect(runningDownload(1)!.percent).toBe(50);
    const hook = renderHook((e: EngineApi) => useEngineStart(e), { initialProps: engine as EngineApi });
    let ok: boolean | undefined;
    act(() => {
      void hook.result.current.prepare(5).then((r) => (ok = r));
    });
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.progress).toBeCloseTo(0.5);
    page.feed(0.8);
    await advance(0);
    expect(hook.result.current.progress).toBeCloseTo(0.8);
    // The engine is not asked while the page downloads (it would fetch the same files again).
    expect(loads(engine)).toEqual([]);
    page.end();
    await advance(0);
    expect(await page.done).toBe(true);
    expect(loads(engine)).toEqual([1]);
    // Building from engine-cache: the pill stays at the end, it does not drop back to 0.
    expect(hook.result.current.progress).toBeGreaterThanOrEqual(0.99);
    hook.rerender(engine);
    await advance(100);
    expect(ok).toBe(true);
    expect(hook.result.current.loading).toBe(false);
  });

  it('a level 8–12 waits for the page\'s running stage 2 download before loading stage 2', async () => {
    const engine = new FakeEngine({ loadMs: 100 });
    const page = pageDownload(2);
    await advance(0);
    page.feed(0.25);
    await advance(0);
    const hook = renderHook((e: EngineApi) => useEngineStart(e), { initialProps: engine as EngineApi });
    let ok: boolean | undefined;
    act(() => {
      void hook.result.current.prepare(10).then((r) => (ok = r));
    });
    await advance(0);
    expect(hook.result.current.progress).toBeCloseTo(0.25);
    expect(loads(engine)).toEqual([]);
    page.end();
    await advance(0);
    expect(loads(engine)).toEqual([2]);
    await advance(100);
    expect(ok).toBe(true);
    expect(engine.nets.large).toBe(true);
  });

  it('when the page\'s download fails, the engine loads (and fetches) by itself', async () => {
    const engine = new FakeEngine({ loadMs: 100 });
    const page = pageDownload(1);
    await advance(0);
    const hook = renderHook((e: EngineApi) => useEngineStart(e), { initialProps: engine as EngineApi });
    let ok: boolean | undefined;
    act(() => {
      void hook.result.current.prepare(3).then((r) => (ok = r));
    });
    page.fail();
    await advance(0);
    expect(await page.done).toBe(false);
    expect(loads(engine)).toEqual([1]);
    hook.rerender(engine);
    expect(hook.result.current.progress).toBe(engine.progress);
    await advance(100);
    expect(ok).toBe(true);
  });

  it('reports a failure and resolves false; cancel() drops a waiting prepare', async () => {
    const onFail = vi.fn();
    const engine = new FakeEngine({ loadResult: 'fail', loadMs: 100 });
    const hook = renderHook(() => useEngineStart(engine, { onFail }));
    let ok: boolean | undefined;
    act(() => {
      void hook.result.current.prepare(3).then((r) => (ok = r));
    });
    await advance(100);
    expect(ok).toBe(false);
    expect(onFail).toHaveBeenCalledTimes(1);

    const slow = new FakeEngine({ loadMs: 1000 });
    const h2 = renderHook(() => useEngineStart(slow));
    act(() => {
      void h2.result.current.prepare(3).then((r) => (ok = r));
    });
    act(() => h2.result.current.cancel());
    expect(h2.result.current.loading).toBe(false);
    await advance(1000);
    expect(ok).toBe(false);
  });
});
