import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { extent, pointCenter, LIFT_PX } from '@/components/board/geometry';
import type { Size } from '@/lib/types';
import { inputClass, isCoordChar, isPassText, useBoardInput, type BoardInputOptions } from './useBoardInput';

const PITCH = 40;
const boxOf = (size: number) => ({ left: 0, top: 0, width: PITCH * extent(size), height: PITCH * extent(size) });

function opts(over: Partial<BoardInputOptions> = {}): BoardInputOptions {
  const size = (over.size ?? 9) as Size;
  return {
    size,
    board: new Uint8Array(size * size),
    interactive: true,
    helpers: true,
    scoring: false,
    onPlay: vi.fn(),
    onIllegal: vi.fn(),
    onToggleGroup: vi.fn(),
    getBox: () => boxOf(size),
    captureKeys: false,
    ...over,
  };
}

type Ev = Partial<{ x: number; y: number; type: string; id: number }>;

/** A fake React pointer event at a point (or at x/y). Hit tests use the box, not the DOM. */
function pe(size: number, p: string | null, over: Ev = {}) {
  const c = p ? pointCenter(p, boxOf(size), size) : { x: 0, y: 0 };
  const el = document.createElement('div');
  return {
    target: el,
    currentTarget: el,
    clientX: over.x ?? c.x,
    clientY: over.y ?? c.y,
    pointerId: over.id ?? 1,
    pointerType: over.type ?? 'mouse',
    button: 0,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as PointerEvent<HTMLElement>;
}

function ke(key: string, extra: Partial<{ shiftKey: boolean; repeat: boolean }> = {}) {
  return {
    key,
    shiftKey: extra.shiftKey ?? false,
    repeat: extra.repeat ?? false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: document.body,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as KeyboardEvent<HTMLElement>;
}

type H = { current: ReturnType<typeof useBoardInput> };
const down = (h: H, size: number, p: string | null, o: Ev = {}) => act(() => h.current.gridHandlers.onPointerDown(pe(size, p, o)));
const move = (h: H, size: number, p: string | null, o: Ev = {}) => act(() => h.current.gridHandlers.onPointerMove(pe(size, p, o)));
const up = (h: H, size: number, p: string | null, o: Ev = {}) => act(() => h.current.gridHandlers.onPointerUp(pe(size, p, o)));
const tap = (h: H, size: number, p: string, o: Ev = {}) => {
  down(h, size, p, o);
  up(h, size, p, o);
};
const key = (h: H, k: string, extra: Partial<{ shiftKey: boolean; repeat: boolean }> = {}) => act(() => h.current.gridHandlers.onKeyDown(ke(k, extra)));
const touch = { type: 'touch' };

function setup(over: Partial<BoardInputOptions> = {}) {
  const o = opts(over);
  const r = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
  return { ...r, o };
}

describe('helpers', () => {
  it('picks the size class from the pointer and the board size', () => {
    expect(inputClass(9, 'mouse')).toBe('fine');
    expect(inputClass(19, 'pen')).toBe('fine');
    expect(inputClass(9, 'touch')).toBe('tap');
    expect(inputClass(13, 'touch')).toBe('confirm');
    expect(inputClass(19, 'touch')).toBe('confirm');
  });

  it('types GTP letters (no I) and digits, never z', () => {
    for (const c of ['a', 'H', 'j', 'T', '1', '9', 'p', 's']) expect(isCoordChar(c)).toBe(true);
    for (const c of ['i', 'I', 'u', 'z', 'Z', ' ', 'Enter']) expect(isCoordChar(c)).toBe(false);
    expect(isPassText('pass')).toBe(true);
    expect(isPassText('P')).toBe(true);
    expect(isPassText('PA')).toBe(false);
    expect(isPassText('P16')).toBe(false);
  });
});

describe('fine pointer', () => {
  it('hovers empty points only and places on click', () => {
    const board = new Uint8Array(81);
    board[0] = 1;
    const { result, o } = setup({ board });
    move(result, 9, 'cc');
    expect(result.current.hover).toBe('cc');
    move(result, 9, 'aa');
    expect(result.current.hover).toBeNull();
    tap(result, 9, 'dd');
    expect(o.onPlay).toHaveBeenCalledWith('dd');
    expect(result.current.ghost).toBeNull();
  });

  it('places at the release point after a mouse drag', () => {
    const { result, o } = setup({ size: 19 });
    down(result, 19, 'cc');
    move(result, 19, 'ff');
    up(result, 19, 'ff');
    expect(o.onPlay).toHaveBeenCalledWith('ff');
  });

  it('ignores the margin and a disabled board', () => {
    const { result, o, rerender } = setup();
    down(result, 9, null, { x: 2, y: 2 });
    up(result, 9, null, { x: 2, y: 2 });
    expect(o.onPlay).not.toHaveBeenCalled();
    rerender({ ...o, interactive: false });
    tap(result, 9, 'cc');
    expect(o.onPlay).not.toHaveBeenCalled();
  });
});

describe('touch on 9×9 (tap places)', () => {
  it('places on a tap; a drag shows the ghost and the release places', () => {
    const { result, o } = setup();
    tap(result, 9, 'ee', touch);
    expect(o.onPlay).toHaveBeenLastCalledWith('ee');
    down(result, 9, 'aa', touch);
    move(result, 9, 'cc', touch);
    expect(result.current.ghost).toBe('cc');
    up(result, 9, 'cc', touch);
    expect(o.onPlay).toHaveBeenLastCalledWith('cc');
    expect(result.current.ghost).toBeNull();
  });

  it('a cancelled drag places nothing and drops the ghost', () => {
    const { result, o } = setup();
    down(result, 9, 'aa', touch);
    move(result, 9, 'cc', touch);
    act(() => result.current.gridHandlers.onPointerCancel(pe(9, 'cc', touch)));
    expect(result.current.ghost).toBeNull();
    expect(o.onPlay).not.toHaveBeenCalled();
  });
});

describe('touch on 13×13 and 19×19 (ghost, then confirm)', () => {
  it('never commits on the first tap; commits on a tap on the ghost', () => {
    const { result, o } = setup({ size: 13 });
    tap(result, 13, 'dd', touch);
    expect(result.current.ghost).toBe('dd');
    expect(o.onPlay).not.toHaveBeenCalled();
    tap(result, 13, 'dd', touch);
    expect(o.onPlay).toHaveBeenCalledWith('dd');
    expect(result.current.ghost).toBeNull();
  });

  it('a drag lifts the ghost a finger-width, clamps it to the board and never commits', () => {
    const { result, o } = setup({ size: 19 });
    const c = pointCenter('jj', boxOf(19), 19);
    down(result, 19, null, { ...touch, x: c.x, y: c.y + LIFT_PX });
    move(result, 19, null, { ...touch, x: c.x + 3, y: c.y + LIFT_PX + 30 });
    move(result, 19, null, { ...touch, x: c.x, y: c.y + LIFT_PX });
    expect(result.current.ghost).toBe('jj');
    move(result, 19, null, { ...touch, x: -500, y: -500 });
    expect(result.current.ghost).toBe('aa');
    up(result, 19, null, { ...touch, x: -500, y: -500 });
    expect(result.current.ghost).toBe('aa');
    expect(o.onPlay).not.toHaveBeenCalled();
  });

  it('ignores a second finger', () => {
    const { result, o } = setup({ size: 19 });
    tap(result, 19, 'dd', touch);
    down(result, 19, 'dd', { ...touch, id: 1 });
    down(result, 19, 'pp', { ...touch, id: 2 });
    up(result, 19, 'pp', { ...touch, id: 2 });
    expect(o.onPlay).not.toHaveBeenCalled();
    up(result, 19, 'dd', { ...touch, id: 1 });
    expect(o.onPlay).toHaveBeenCalledWith('dd');
  });

  it('tells the reason for an illegal ghost with helpers on, and never commits it', () => {
    const illegalReason = vi.fn((p: string) => (p === 'dd' ? ('suicide' as const) : null));
    const { result, o } = setup({ size: 13, illegalReason });
    tap(result, 13, 'dd', touch);
    expect(o.onIllegal).toHaveBeenCalledWith('dd', 'suicide');
    tap(result, 13, 'dd', touch);
    expect(o.onPlay).not.toHaveBeenCalled();
    expect(result.current.ghost).toBe('dd');
  });

  it('reports the ghost to the parent and drops it when the board stops taking stones', () => {
    const onGhostChange = vi.fn();
    const { result, o, rerender } = setup({ size: 13, onGhostChange });
    tap(result, 13, 'ff', touch);
    expect(onGhostChange).toHaveBeenLastCalledWith('ff');
    rerender({ ...o, onGhostChange, interactive: false });
    expect(result.current.ghost).toBeNull();
    expect(onGhostChange).toHaveBeenLastCalledWith(null);
  });

  it('starts over on a new size', () => {
    const { result, o, rerender } = setup({ size: 13 });
    tap(result, 13, 'ff', touch);
    const size = 19 as const;
    rerender({ ...o, size, board: new Uint8Array(361), getBox: () => boxOf(19) });
    expect(result.current.ghost).toBeNull();
    expect(result.current.cursor).toBe('jj');
  });
});

describe('scoring', () => {
  it('toggles on a tap on a stone, not on a drag, never places', () => {
    const board = new Uint8Array(81);
    board[0] = 2;
    const { result, o } = setup({ board, scoring: true });
    tap(result, 9, 'aa', touch);
    expect(o.onToggleGroup).toHaveBeenCalledWith('aa');
    down(result, 9, 'aa', touch);
    move(result, 9, 'ee', touch);
    up(result, 9, 'aa', touch);
    expect(o.onToggleGroup).toHaveBeenCalledTimes(1);
    tap(result, 9, 'ee');
    expect(o.onToggleGroup).toHaveBeenCalledTimes(1);
    expect(o.onPlay).not.toHaveBeenCalled();
    expect(result.current.ghost).toBeNull();
  });
});

describe('keyboard', () => {
  it('moves the cursor, jumps with Home and End, places with Enter (not on key repeat)', () => {
    const { result, o } = setup();
    expect(result.current.cursor).toBe('ee');
    key(result, 'ArrowDown');
    key(result, 'ArrowRight');
    expect(result.current.cursor).toBe('ff');
    key(result, 'Home');
    expect(result.current.cursor).toBe('af');
    key(result, 'End');
    expect(result.current.cursor).toBe('if');
    key(result, 'Enter', { repeat: true });
    expect(o.onPlay).not.toHaveBeenCalled();
    key(result, 'Enter');
    expect(o.onPlay).toHaveBeenCalledWith('if');
  });

  it('types up to four characters, edits with Backspace, clears with Escape', () => {
    const { result } = setup({ size: 19 });
    for (const k of ['q', '1', '6', '1', '1']) key(result, k);
    expect(result.current.typed).toBe('Q161');
    key(result, 'Backspace');
    expect(result.current.typed).toBe('Q16');
    key(result, 'Escape');
    expect(result.current.typed).toBe('');
  });

  it('places a typed point and moves the cursor there; refuses an illegal one', () => {
    const illegalReason = (p: string) => (p === 'cc' ? ('ko' as const) : null);
    const { result, o } = setup({ size: 19, illegalReason });
    for (const k of ['q', '1', '6', 'Enter']) key(result, k);
    expect(o.onPlay).toHaveBeenCalledWith('pd');
    expect(result.current.cursor).toBe('pd');
    for (const k of ['c', '1', '7', 'Enter']) key(result, k);
    expect(o.onPlay).toHaveBeenCalledTimes(1);
    expect(o.onIllegal).toHaveBeenCalledWith('cc', 'ko');
    expect(result.current.typedError).toBe('C17');
  });

  it('passes on typed pass, undoes and redoes on Z', () => {
    const onPass = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { result } = setup({ onPass, onUndo, onRedo });
    for (const k of ['p', 'Enter']) key(result, k);
    expect(onPass).toHaveBeenCalledTimes(1);
    key(result, 'z');
    key(result, 'Z', { shiftKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('toggles a group with Enter while scoring and ignores typing', () => {
    const board = new Uint8Array(81);
    board[40] = 1;
    const { result, o } = setup({ board, scoring: true });
    key(result, 'Enter');
    expect(o.onToggleGroup).toHaveBeenCalledWith('ee');
    key(result, 'd');
    expect(result.current.typed).toBe('');
  });
});
