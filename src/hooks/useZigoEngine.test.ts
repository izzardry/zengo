import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setSharedEngine, sharedEngine, useZigoEngine } from './useZigoEngine';
import { FakeEngine } from '@/lib/engine/fake';
import { EngineDriver } from '@/lib/engine/driver';
import { makeSettings, newGame, position } from '@/lib/zigo';
import type { EngineApi } from '@/lib/types';

const START = position(newGame(makeSettings(9)));

afterEach(() => setSharedEngine(null));

describe('useZigoEngine', () => {
  it('creates one lazy browser engine and shares it', () => {
    setSharedEngine(null);
    const a = sharedEngine();
    expect(a).toBeInstanceOf(EngineDriver);
    expect(sharedEngine()).toBe(a);
    expect(a.state).toBe('idle'); // no worker started
  });

  it('re-renders on snapshot changes; methods stay stable', async () => {
    const fake = new FakeEngine({ backend: 'webgpu' });
    setSharedEngine(fake);
    const { result } = renderHook(() => useZigoEngine());
    expect(result.current.state).toBe('idle');
    expect(result.current.nets).toEqual({ small: false, large: false });
    const first = result.current;
    await act(async () => {
      await result.current.load(2);
    });
    expect(result.current.state).toBe('ready');
    expect(result.current.progress).toBe(1);
    expect(result.current.backend).toBe('webgpu');
    expect(result.current.nets).toEqual({ small: true, large: true });
    expect(result.current).not.toBe(first);
    expect(result.current.genmove).toBe(first.genmove);
    expect(result.current.evaluate).toBe(first.evaluate);
    expect(result.current.analyze).toBe(first.analyze);
    expect(result.current.stop).toBe(first.stop);
  });

  it('two hook users share one engine', async () => {
    const fake = new FakeEngine();
    setSharedEngine(fake);
    const a = renderHook(() => useZigoEngine());
    const b = renderHook(() => useZigoEngine());
    let move = '';
    await act(async () => {
      move = (await a.result.current.genmove(START, 5)).move;
    });
    expect(move).toBe('aa');
    expect(b.result.current.state).toBe('ready');
    await act(async () => {
      await b.result.current.evaluate(START, { visits: 1 });
      await b.result.current.analyze(START, 3);
    });
    expect(fake.calls.map((c) => c.method)).toEqual(['genmove', 'evaluate', 'analyze']);
    b.result.current.stop();
    expect(fake.stops).toBe(1);
  });

  it('accepts an explicit engine and passes genmove options through', async () => {
    const fake = new FakeEngine();
    const { result } = renderHook(() => useZigoEngine(fake));
    let m = '';
    await act(async () => {
      m = (await result.current.genmove(START, 1, undefined, { avoid: ['aa'] })).move;
    });
    expect(m).toBe('ba');
    const api: EngineApi = result.current;
    expect(api.analyze).toBeTypeOf('function');
  });
});
