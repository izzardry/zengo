import { describe, expect, it, vi } from 'vitest';
import { FakeEngine, gameFromPosition, isPassMove, movesKey, neutralEval, sensiblePoints } from './fake';
import { isEngineAbort } from './handle';
import { fromDiagram, makeSettings, newGame, pass, play, position, replay } from '../zigo';
import type { Position } from '../types';

const EMPTY9 = position(newGame(makeSettings(9)));

/** A 9×9 position after `moves` (SGF points, `tt` = pass). */
function after(...moves: string[]): Position {
  return position(replay(makeSettings(9), moves));
}

describe('gameFromPosition', () => {
  it('rebuilds setup stones, plies, ko and the side to move', () => {
    const g = replay(makeSettings(13, 'area', 3), ['ff', 'hh']);
    const back = gameFromPosition(position(g));
    expect(back.turn).toBe(g.turn);
    expect([...back.board]).toEqual([...g.board]);
    // A ko from a capture survives the round trip.
    const ko = fromDiagram(
      [
        '.xo......',
        'x.xo.....',
        '.xo......',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
        '.........',
      ],
      'W',
    );
    const taken = play(ko, 'bb', 0); // White captures at a2 → ko at the captured point
    expect(taken.ko).not.toBeNull();
    expect(gameFromPosition(position(taken)).ko).toBe(taken.ko);
  });
});

describe('sensiblePoints and neutralEval', () => {
  it('lists the legal points row-major and skips the mover’s own one-point eyes', () => {
    expect(sensiblePoints(EMPTY9)).toHaveLength(81);
    expect(sensiblePoints(EMPTY9)[0]).toBe('aa');
    const eye = position(
      fromDiagram(
        [
          '.x.......',
          'x........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
        ],
        'B',
      ),
    );
    const pts = sensiblePoints(eye);
    expect(pts).not.toContain('aa');
    expect(pts[0]).toBe('ca');
  });

  it('is empty during scoring', () => {
    expect(sensiblePoints(after('ee', 'tt', 'tt'))).toEqual([]);
  });

  it('neutral: 0.5, 0, zero ownership, policy uniform over legal points and pass', () => {
    const e = neutralEval(after('ee'));
    expect(e.winrate).toBe(0.5);
    expect(e.scoreLead).toBe(0);
    expect(e.ownership).toHaveLength(81);
    expect(e.ownership.every((v) => v === 0)).toBe(true);
    expect(e.policy).toHaveLength(82);
    expect(e.policy[4 * 9 + 4]).toBe(0); // occupied
    expect(e.policy[81]).toBeCloseTo(1 / 81);
    expect(e.policy.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('FakeEngine', () => {
  it('loads idle → loading → ready with the small net and a backend', async () => {
    const e = new FakeEngine();
    const seen: string[] = [];
    e.subscribe(() => seen.push(`${e.state}:${e.progress}`));
    expect(e.state).toBe('idle');
    expect(e.nets).toEqual({ small: false, large: false });
    expect(e.backend).toBeNull();
    await e.load(1);
    expect(seen).toEqual(['loading:0', 'loading:0.5', 'ready:1']);
    expect(e.nets).toEqual({ small: true, large: false });
    expect(e.backend).toBe('wasm');
    expect(e.getSnapshot()).toEqual({ state: 'ready', progress: 1, backend: 'wasm', nets: { small: true, large: false } });
    await e.load(2);
    expect(e.nets).toEqual({ small: true, large: true });
    expect(e.calls).toEqual([
      { method: 'load', args: [1] },
      { method: 'load', args: [2] },
    ]);
  });

  it('stage 2 loads stage 1 first; the backend can be set', async () => {
    const e = new FakeEngine({ backend: 'webgpu' });
    await e.load(2);
    expect(e.state).toBe('ready');
    expect(e.nets).toEqual({ small: true, large: true });
    expect(e.backend).toBe('webgpu');
  });

  it('honours loadMs with timers', async () => {
    vi.useFakeTimers();
    try {
      const e = new FakeEngine({ loadMs: 1000 });
      const p = e.load(1);
      expect(e.state).toBe('loading');
      await vi.advanceTimersByTimeAsync(500);
      expect(e.progress).toBe(0.5);
      await vi.advanceTimersByTimeAsync(500);
      await p;
      expect(e.state).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('can fail to load and recover', async () => {
    const e = new FakeEngine({ loadResult: 'fail' });
    await expect(e.load(1)).rejects.toThrow();
    expect(e.state).toBe('failed');
    await expect(e.genmove(EMPTY9, 1)).rejects.toThrow();
    await expect(e.evaluate(EMPTY9, { visits: 1 })).resolves.toBeNull();
    e.setLoadResult('ready');
    await expect(e.genmove(EMPTY9, 1)).resolves.toEqual({ move: 'aa' });
    expect(e.state).toBe('ready');
  });

  it('genmove: scripted (by plies or a function), else the first sensible legal point, else pass', async () => {
    const e = new FakeEngine({ moves: { ee: 'cc', '': 'ee' } });
    await expect(e.genmove(EMPTY9, 5)).resolves.toEqual({ move: 'ee' });
    await expect(e.genmove(after('ee'), 5)).resolves.toEqual({ move: 'cc' });
    await expect(e.genmove(after('ee', 'cc'), 5)).resolves.toEqual({ move: 'aa' });

    const f = new FakeEngine({ moves: (pos, level) => (level === 12 ? 'resign' : undefined) });
    await expect(f.genmove(EMPTY9, 12)).resolves.toEqual({ move: 'resign' });
    const clock = { tc: { kind: 'fischer', baseMs: 60_000, incMs: 0 }, left: { mainMs: 5000, periodMs: 0, periods: 0 } } as const;
    await expect(f.genmove(EMPTY9, 1, clock)).resolves.toEqual({ move: 'aa' });
    expect(f.calls.at(-1)).toEqual({ method: 'genmove', args: [EMPTY9, 1, clock] });
    expect(movesKey(after('ee', 'tt'))).toBe('eett');

    // Only own eyes left: the fake passes.
    const full = position(
      fromDiagram(
        [
          'x.xxxxxxx',
          'xxxxxxxxx',
          'xxxxxxxxx',
          'xxxxxxxxx',
          'xxxxxxxxx',
          'xxxxxxxxx',
          'xxxxxxxxx',
          'xxxxxxxx.',
          'xxxxxxx.x',
        ],
        'B',
      ),
    );
    const r = await new FakeEngine().genmove(full, 3);
    expect(r).toEqual({ move: 'tt' });
    expect(isPassMove(r.move)).toBe(true);
    expect(isPassMove('resign')).toBe(false);
  });

  it('every genmove of a fake self-play game is legal and the game ends in two passes', async () => {
    const e = new FakeEngine();
    let g = newGame(makeSettings(9));
    for (let i = 0; i < 200 && !g.scoring; i++) {
      const { move } = await e.genmove(position(g), 1);
      expect(move).not.toBe('resign');
      g = move === 'tt' ? pass(g, 0) : play(g, move as string, 0);
    }
    expect(g.scoring).toBeDefined();
  });

  it('evaluate: scripted (null = no answer), else neutral; missing arrays are filled', async () => {
    const own = new Float32Array(81).fill(1);
    const e = new FakeEngine({ evals: { '': { winrate: 0.7, scoreLead: 3.5, ownership: own }, ee: null } });
    const a = await e.evaluate(EMPTY9, { visits: 10 });
    expect(a).toMatchObject({ winrate: 0.7, scoreLead: 3.5 });
    expect(a?.ownership).toBe(own);
    expect(a?.policy).toHaveLength(82);
    await expect(e.evaluate(after('ee'), { visits: 10 })).resolves.toBeNull();
    const n = await e.evaluate(after('ee', 'cc'), { timeMs: 100, net: 'small' });
    expect(n).toMatchObject({ winrate: 0.5, scoreLead: 0 });
    expect(e.calls.map((c) => c.method)).toEqual(['evaluate', 'evaluate', 'evaluate']);
    const f = new FakeEngine({ evals: (pos, opts) => (opts.net === 'large' ? { winrate: 0.1, scoreLead: -9 } : undefined) });
    await expect(f.evaluate(EMPTY9, { net: 'large' })).resolves.toMatchObject({ winrate: 0.1, scoreLead: -9 });
  });

  it('evaluate times out when the search is slower than timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const e = new FakeEngine({ delayMs: 300 });
      const slow = e.evaluate(EMPTY9, { visits: 1 }, 150);
      await vi.advanceTimersByTimeAsync(150);
      await expect(slow).resolves.toBeNull();
      const fast = e.evaluate(EMPTY9, { visits: 1 }, 500);
      await vi.advanceTimersByTimeAsync(300);
      await expect(fast).resolves.toMatchObject({ winrate: 0.5 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('analyze returns n legal points, or the scripted list', async () => {
    const e = new FakeEngine();
    const r = await e.analyze(after('aa'), 3);
    expect(r).toEqual([
      { move: 'ba', winrate: 0.5, scoreLead: 0 },
      { move: 'ca', winrate: 0.5, scoreLead: 0 },
      { move: 'da', winrate: 0.5, scoreLead: 0 },
    ]);
    const s = new FakeEngine({ analysis: () => [{ move: 'ee', winrate: 0.6, scoreLead: 2 }, { move: 'cc', winrate: 0.5, scoreLead: 1 }] });
    await expect(s.analyze(EMPTY9, 1)).resolves.toEqual([{ move: 'ee', winrate: 0.6, scoreLead: 2 }]);
  });

  it('stop() aborts pending searches', async () => {
    vi.useFakeTimers();
    try {
      const e = new FakeEngine({ delayMs: 1000 });
      const best = e.genmove(EMPTY9, 5);
      const top = e.analyze(EMPTY9, 2);
      const ev = e.evaluate(EMPTY9, { visits: 2 });
      await vi.advanceTimersByTimeAsync(10);
      e.stop();
      await expect(best).rejects.toSatisfy(isEngineAbort);
      await expect(top).rejects.toSatisfy(isEngineAbort);
      await expect(ev).resolves.toBeNull();
      expect(e.stops).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose refuses further work', async () => {
    const e = new FakeEngine();
    await e.load(1);
    e.dispose();
    expect(e.state).toBe('idle');
    expect(e.nets).toEqual({ small: false, large: false });
    await expect(e.load(1)).rejects.toThrow();
  });
});
