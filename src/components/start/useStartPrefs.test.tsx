import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGoStore, memoryStorage } from '@/lib/storage';
import { readClocks, readColor, readHandicaps, readOpponent, useStartPrefs } from './useStartPrefs';

const setup = (initial: Record<string, string> = {}) => {
  const mem = memoryStorage(initial);
  return { mem, store: createGoStore(mem) };
};

describe('useStartPrefs', () => {
  it('uses the first-run defaults: COMPUTER 5, random, 9×9, area, no handicap, clock off', () => {
    const { store } = setup();
    const { result } = renderHook(() => useStartPrefs(store));
    expect(result.current.opponent).toEqual({ mode: 'computer', level: 5 });
    expect(result.current.color).toBe('random');
    expect(result.current.size).toBe(9);
    expect(result.current.rules).toBe('area');
    expect(result.current.handicap).toBe(0);
    expect(result.current.handicaps).toEqual({ 9: 0, 13: 0, 19: 0 });
    expect(result.current.clock).toBeNull();
    expect(result.current.clocks).toEqual({ 9: null, 13: null, 19: null });
  });

  it('persists every change under its zengo: key', () => {
    const { store, mem } = setup();
    const { result } = renderHook(() => useStartPrefs(store));
    act(() => result.current.setOpponent({ mode: 'room' }));
    act(() => result.current.setColor('B'));
    act(() => result.current.setRules('territory'));
    act(() => result.current.setClock({ kind: 'fischer', baseMs: 120_000, incMs: 7000 }));
    act(() => result.current.setHandicap(4));
    expect(result.current.opponent).toEqual({ mode: 'room' });
    expect(result.current.color).toBe('B');
    expect(result.current.rules).toBe('territory');
    expect(result.current.clock).toEqual({ kind: 'fischer', baseMs: 120_000, incMs: 7000 });
    expect(result.current.handicap).toBe(4);
    expect(mem.dump()).toMatchObject({
      'zengo:opponent': '{"mode":"room"}',
      'zengo:color': '"B"',
      'zengo:rules': '"territory"',
      'zengo:clock': '{"9":"2+7"}',
      'zengo:handicap': '{"9":4}',
    });
    act(() => result.current.setClock(null));
    expect(mem.dump()['zengo:clock']).toBe('{"9":null}');
  });

  it('remembers handicap and clock per size and switches them with the size (DESIGN 4.1)', () => {
    const { store, mem } = setup();
    const { result } = renderHook(() => useStartPrefs(store));
    act(() => result.current.setHandicap(5));
    act(() => result.current.setClock({ kind: 'byoyomi', baseMs: 300_000, periods: 5, periodMs: 30_000 }));
    act(() => result.current.setSize(19));
    expect(result.current.size).toBe(19);
    expect(result.current.handicap).toBe(0);
    expect(result.current.clock).toBeNull();
    act(() => result.current.setHandicap(9));
    act(() => result.current.setClock({ kind: 'byoyomi', baseMs: 1_200_000, periods: 5, periodMs: 30_000 }));
    act(() => result.current.setSize(9));
    expect(result.current.handicap).toBe(5);
    expect(result.current.clock).toEqual({ kind: 'byoyomi', baseMs: 300_000, periods: 5, periodMs: 30_000 });
    expect(JSON.parse(mem.dump()['zengo:handicap'])).toEqual({ 9: 5, 19: 9 });
    expect(JSON.parse(mem.dump()['zengo:clock'])).toEqual({ 9: '5m5x30', 19: '20m5x30' });
    expect(mem.dump()['zengo:size']).toBe('9');
    // A size can be set explicitly; the handicap is clamped to that size's limit.
    act(() => result.current.setHandicap(9, 9));
    expect(result.current.handicaps[9]).toBe(5);
  });

  it('restores remembered values', () => {
    const { store } = setup({
      'zengo:opponent': '{"mode":"computer","level":11}',
      'zengo:color': '"W"',
      'zengo:size': '13',
      'zengo:rules': '"territory"',
      'zengo:handicap': '{"13":3}',
      'zengo:clock': '{"13":"10m5x30","19":"5+7"}',
    });
    const { result } = renderHook(() => useStartPrefs(store));
    expect(result.current.opponent).toEqual({ mode: 'computer', level: 11 });
    expect(result.current.color).toBe('W');
    expect(result.current.size).toBe(13);
    expect(result.current.rules).toBe('territory');
    expect(result.current.handicap).toBe(3);
    expect(result.current.clock).toEqual({ kind: 'byoyomi', baseMs: 600_000, periods: 5, periodMs: 30_000 });
    expect(result.current.clocks[19]).toEqual({ kind: 'fischer', baseMs: 300_000, incMs: 7000 });
  });

  it('falls back to defaults on corrupt or foreign values (including lowercase colors and a plain clock string)', () => {
    const { store } = setup({
      'zengo:opponent': '{"mode":"computer","level":99}',
      'zengo:color': '"w"',
      'zengo:clock': '"15+10"',
      'zengo:handicap': '{bad json',
    });
    expect(readOpponent(store)).toEqual({ mode: 'computer', level: 5 });
    expect(readColor(store)).toBe('random');
    expect(readClocks(store)).toEqual({ 9: null, 13: null, 19: null });
    expect(readHandicaps(store)).toEqual({ 9: 0, 13: 0, 19: 0 });
  });

  it('ignores invalid values passed to the setters', () => {
    const { store, mem } = setup();
    const { result } = renderHook(() => useStartPrefs(store));
    // @ts-expect-error runtime guard
    act(() => result.current.setColor('green'));
    // @ts-expect-error runtime guard
    act(() => result.current.setSize(11));
    // @ts-expect-error runtime guard
    act(() => result.current.setRules('ing'));
    expect(result.current.color).toBe('random');
    expect(result.current.size).toBe(9);
    expect(result.current.rules).toBe('area');
    expect(mem.dump()['zengo:color']).toBeUndefined();
    expect(mem.dump()['zengo:size']).toBeUndefined();
    expect(mem.dump()['zengo:rules']).toBeUndefined();
  });
});
