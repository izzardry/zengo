/**
 * Board input (DESIGN 6.1, 6.2, 8.4): one pointer state machine per size class, the keyboard
 * focus ring, typed coordinates and `pass`. Used by `GoBoard`; the board is controlled, so this
 * hook never changes a game, it only calls back (`onPlay`, `onPass`, `onToggleGroup`, …).
 *
 * Size classes (by the pointer that is used, not by the device):
 * - `fine` (mouse, pen), any size: a hover ghost follows the pointer; a click places.
 * - `tap` (touch on 9×9): a tap places at once; a drag shows the ghost under the finger and the
 *   release places.
 * - `confirm` (touch on 13×13 and 19×19): the first tap or drag only shows the ghost (a drag floats
 *   it one finger-width above the touch point, snapping to intersections); a second tap on the
 *   ghost (its cell plus half a pitch) commits; a tap elsewhere on the board moves it; a tap off the
 *   board cancels it. Neither the first tap nor a drag ever commits.
 *
 * An illegal point never commits. With helpers on, `onIllegal` tells the parent why; with helpers
 * off the attempt is ignored without comment. While scoring, a tap or Enter on a stone calls
 * `onToggleGroup` instead.
 *
 * Interaction state that changes on every pointer move lives in refs; the ghost and hover points
 * are state, so they survive any re-render of the board or its parent.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { fromGtp, pointToIndex } from '@/lib/zengo';
import type { IllegalReason, Point, Size } from '@/lib/types';
import {
  DRAG_THRESHOLD,
  LIFT_PX,
  centerPoint,
  inGhostHitArea,
  pointAt,
  pointToCell,
  stepPoint,
  type Box,
} from '@/components/board/geometry';

/** How a pointer places stones on this board (see the module comment). */
export type InputClass = 'fine' | 'tap' | 'confirm';

/** The size class of a pointer on a board of `size`. */
export function inputClass(size: number, pointerType: string): InputClass {
  if (pointerType !== 'touch') return 'fine';
  return size === 9 ? 'tap' : 'confirm';
}

export interface BoardInputOptions {
  readonly size: Size;
  readonly board: Uint8Array;
  readonly interactive: boolean;
  readonly helpers: boolean;
  /** Scoring phase: taps and Enter on a stone toggle its group; nothing is placed. */
  readonly scoring: boolean;
  readonly illegalReason?: (p: Point) => IllegalReason | null;
  readonly onPlay?: (p: Point) => void;
  readonly onIllegal?: (p: Point, reason: IllegalReason) => void;
  readonly onPass?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onToggleGroup?: (p: Point) => void;
  readonly onGhostChange?: (p: Point | null) => void;
  /** The board drawing's client rect, for hit tests. */
  readonly getBox: () => Box | null;
  /** The finger lifts the ghost downwards (the far player in face-to-face seating). */
  readonly liftDown?: boolean;
  /** Listen for typed coordinates on the window. */
  readonly captureKeys: boolean;
  /** The board element: a press outside it cancels the ghost (DESIGN 6.1). */
  readonly rootRef?: RefObject<HTMLElement | null>;
}

export interface BoardInput {
  /** The ghost stone (with crosshairs), or null. */
  readonly ghost: Point | null;
  /** The hover stone of a fine pointer (no crosshairs), or null. */
  readonly hover: Point | null;
  /** Keyboard focus point (roving tabindex). */
  readonly cursor: Point;
  readonly setCursor: (p: Point) => void;
  /** Coordinate typed so far (`D1`, `pas`). */
  readonly typed: string;
  /** The last rejected typed text, shown briefly. */
  readonly typedError: string | null;
  readonly gridHandlers: {
    readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
    readonly onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
  /** Clear the ghost, hover and typed text. */
  readonly clear: () => void;
}

/** Characters of a typed coordinate or `pass`: GTP letters (no I, case-insensitive) and digits. Never `z`. */
const TYPE_CHAR = /^[a-hj-tA-HJ-T0-9]$/;
export function isCoordChar(key: string): boolean {
  return TYPE_CHAR.test(key);
}

/** `p` and `pass` (any case) pass; everything else is read as a coordinate. */
export function isPassText(text: string): boolean {
  return /^p(ass)?$/i.test(text.trim());
}

const MAX_TYPED = 4;

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

interface Press {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly cls: InputClass;
  readonly x: number;
  readonly y: number;
  /** The press started inside the ghost's hit area (`confirm` only). */
  readonly onGhost: boolean;
  dragging: boolean;
}

export function useBoardInput(options: BoardInputOptions): BoardInput {
  const opts = useRef(options);
  opts.current = options;
  const { size, interactive, scoring, captureKeys } = options;

  const [ghost, setGhostState] = useState<Point | null>(null);
  const ghostRef = useRef<Point | null>(null);
  const [hover, setHoverState] = useState<Point | null>(null);
  const hoverRef = useRef<Point | null>(null);
  const [cursor, setCursorState] = useState<Point>(() => centerPoint(size));
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [typed, setTypedState] = useState('');
  const typedRef = useRef('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const errorTimer = useRef<number | null>(null);
  const press = useRef<Press | null>(null);

  const setGhost = useCallback((p: Point | null) => {
    if (ghostRef.current === p) return;
    ghostRef.current = p;
    setGhostState(p);
  }, []);

  const setHover = useCallback((p: Point | null) => {
    if (hoverRef.current === p) return;
    hoverRef.current = p;
    setHoverState(p);
  }, []);

  const setTyped = useCallback((s: string) => {
    typedRef.current = s;
    setTypedState(s);
  }, []);

  const setCursor = useCallback((p: Point) => setCursorState(p), []);

  const clear = useCallback(() => {
    press.current = null;
    setGhost(null);
    setHover(null);
    setTyped('');
  }, [setGhost, setHover, setTyped]);

  /* ---- the parent hears about the ghost (the info pill previews `D4?`) ---- */

  const reported = useRef<Point | null>(null);
  useEffect(() => {
    if (reported.current === ghost) return;
    reported.current = ghost;
    opts.current.onGhostChange?.(ghost);
  }, [ghost]);

  /* ---- resets ---- */

  // A new size starts over: no ghost, the cursor on the center point.
  const lastSize = useRef(size);
  useEffect(() => {
    if (lastSize.current === size) return;
    lastSize.current = size;
    clear();
    setCursorState(centerPoint(size));
  }, [size, clear]);

  // No ghost while the board takes no stones (opponent's turn, review, scoring).
  useEffect(() => {
    if (!interactive || scoring) {
      press.current = null;
      setGhost(null);
      setHover(null);
    }
  }, [interactive, scoring, setGhost, setHover]);

  /* ---- rules, always from the latest options ---- */

  const stoneAt = useCallback((p: Point): number => {
    const o = opts.current;
    const i = pointToIndex(p, o.size);
    return i < 0 ? 0 : (o.board[i] ?? 0);
  }, []);

  const reasonAt = useCallback(
    (p: Point): IllegalReason | null => {
      if (stoneAt(p) !== 0) return 'occupied';
      return opts.current.illegalReason?.(p) ?? null;
    },
    [stoneAt],
  );

  /** Plays `p` if legal. Returns true when it was played. */
  const tryPlay = useCallback(
    (p: Point): boolean => {
      const o = opts.current;
      if (!o.interactive || o.scoring) return false;
      const reason = reasonAt(p);
      if (reason) {
        if (o.helpers) o.onIllegal?.(p, reason);
        return false;
      }
      press.current = null;
      setGhost(null);
      setHover(null);
      o.onPlay?.(p);
      return true;
    },
    [reasonAt, setGhost, setHover],
  );

  const toggleAt = useCallback(
    (p: Point) => {
      const o = opts.current;
      if (o.interactive && o.scoring && stoneAt(p) !== 0) o.onToggleGroup?.(p);
    },
    [stoneAt],
  );

  /* ---- pointer ---- */

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const o = opts.current;
      if (!o.interactive) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (press.current && press.current.pointerId !== e.pointerId) return; // a second finger
      const cls = inputClass(o.size, e.pointerType);
      const box = o.getBox();
      const g = ghostRef.current;
      press.current = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        cls,
        x: e.clientX,
        y: e.clientY,
        onGhost: !o.scoring && cls === 'confirm' && !!g && inGhostHitArea(g, e.clientX, e.clientY, box, o.size),
        dragging: false,
      };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* jsdom, or a pointer that is already gone */
      }
      if (cls === 'fine' && !o.scoring) {
        const p = pointAt(e.clientX, e.clientY, box, o.size);
        setHover(p && stoneAt(p) === 0 ? p : null);
      }
    },
    [setHover, stoneAt],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const o = opts.current;
      if (!o.interactive) return;
      const pr = press.current;
      const box = o.getBox();
      if (!pr) {
        if (e.pointerType !== 'touch' && !o.scoring) {
          const p = pointAt(e.clientX, e.clientY, box, o.size);
          setHover(p && stoneAt(p) === 0 ? p : null);
        }
        return;
      }
      if (pr.pointerId !== e.pointerId) return;
      if (!pr.dragging) {
        const limit = DRAG_THRESHOLD[pr.pointerType] ?? DRAG_THRESHOLD.touch;
        if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < limit) return;
        pr.dragging = true;
      }
      if (o.scoring) return; // a drag while scoring toggles nothing
      if (pr.cls === 'confirm') {
        const lift = o.liftDown ? -LIFT_PX : LIFT_PX;
        setGhost(pointAt(e.clientX, e.clientY - lift, box, o.size, true));
      } else if (pr.cls === 'tap') {
        setGhost(pointAt(e.clientX, e.clientY, box, o.size));
      } else {
        const p = pointAt(e.clientX, e.clientY, box, o.size);
        setHover(p && stoneAt(p) === 0 ? p : null);
      }
    },
    [setGhost, setHover, stoneAt],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const pr = press.current;
      if (!pr || pr.pointerId !== e.pointerId) return;
      press.current = null;
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        /* not captured */
      }
      const o = opts.current;
      if (!o.interactive) return;
      const box = o.getBox();
      const here = pointAt(e.clientX, e.clientY, box, o.size);
      if (o.scoring) {
        if (!pr.dragging && here) toggleAt(here);
        return;
      }
      switch (pr.cls) {
        case 'fine':
          if (here) tryPlay(here);
          return;
        case 'tap':
          setGhost(null);
          if (here) tryPlay(here);
          return;
        case 'confirm': {
          if (pr.dragging) return; // a drag never commits
          const g = ghostRef.current;
          if (pr.onGhost && g) {
            tryPlay(g);
            return;
          }
          setGhost(here);
          if (here && o.helpers) {
            const reason = reasonAt(here);
            if (reason) o.onIllegal?.(here, reason);
          }
          return;
        }
      }
    },
    [reasonAt, setGhost, toggleAt, tryPlay],
  );

  const onPointerCancel = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const pr = press.current;
      if (!pr || pr.pointerId !== e.pointerId) return;
      press.current = null;
      if (pr.cls === 'tap') setGhost(null);
    },
    [setGhost],
  );

  const onPointerLeave = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' && !press.current) setHover(null);
    },
    [setHover],
  );

  // A press anywhere outside the board cancels the ghost (DESIGN 6.1: "a tap off the board cancels it").
  useEffect(() => {
    if (!ghost && !hover) return;
    const onDown = (e: Event) => {
      const root = opts.current.rootRef?.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      setGhost(null);
      setHover(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [ghost, hover, setGhost, setHover]);

  /* ---- typed coordinates ---- */

  const flashError = useCallback((text: string) => {
    setTypedError(text);
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => {
      errorTimer.current = null;
      setTypedError(null);
    }, 700);
  }, []);

  useEffect(
    () => () => {
      if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    },
    [],
  );

  const submitTyped = useCallback(() => {
    const o = opts.current;
    const text = typedRef.current.trim();
    setTyped('');
    if (!text) return;
    if (isPassText(text)) {
      if (o.onPass && o.interactive && !o.scoring) o.onPass();
      else flashError(text);
      return;
    }
    const p = fromGtp(text, o.size);
    if (p && p !== 'tt') {
      setCursorState(p);
      if (tryPlay(p)) return;
    }
    flashError(text);
  }, [flashError, setTyped, tryPlay]);

  /**
   * Keys shared by the grid and the window listener: typing, Enter / Backspace while typing,
   * Escape, Z / Shift+Z. Returns true when the key was taken.
   */
  const commonKey = useCallback(
    (key: string, shift: boolean): boolean => {
      const o = opts.current;
      if ((key === 'z' || key === 'Z') && (o.onUndo || o.onRedo)) {
        if (shift) o.onRedo?.();
        else o.onUndo?.();
        return true;
      }
      if (key === 'Escape') {
        const had = !!typedRef.current || !!ghostRef.current;
        setTyped('');
        setGhost(null);
        return had;
      }
      if (o.scoring) return false;
      if (key === 'Enter' && typedRef.current) {
        submitTyped();
        return true;
      }
      if (key === 'Backspace' && typedRef.current) {
        setTyped(typedRef.current.slice(0, -1));
        return true;
      }
      if (isCoordChar(key)) {
        if (typedRef.current.length < MAX_TYPED) setTyped(typedRef.current + key.toUpperCase());
        return true;
      }
      return false;
    },
    [setGhost, setTyped, submitTyped],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const o = opts.current;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const step = arrows[e.key];
      if (step) {
        e.preventDefault();
        setCursorState((c) => stepPoint(c, step[0], step[1], o.size));
        return;
      }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const c = pointToCell(cursorRef.current, o.size);
        if (c) setCursorState(stepPoint(cursorRef.current, e.key === 'Home' ? -c.col : o.size - 1 - c.col, 0, o.size));
        return;
      }
      if (!o.interactive) return;
      if ((e.key === 'Enter' || e.key === ' ') && !typedRef.current) {
        e.preventDefault();
        if (e.repeat) return;
        if (o.scoring) toggleAt(cursorRef.current);
        else tryPlay(cursorRef.current);
        return;
      }
      if (commonKey(e.key, e.shiftKey)) e.preventDefault();
    },
    [commonKey, toggleAt, tryPlay],
  );

  // Typed coordinates anywhere on the page (not in fields, not with modifiers).
  useEffect(() => {
    if (!captureKeys || !interactive) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      // A focused control's own Enter / Space stays its own; only typing continues.
      if ((e.key === 'Enter' || e.key === 'Backspace') && !typedRef.current) return;
      if (e.key === 'Escape' && !typedRef.current) return;
      if (commonKey(e.key, e.shiftKey)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captureKeys, interactive, commonKey]);

  return {
    ghost,
    hover,
    cursor,
    setCursor,
    typed,
    typedError,
    gridHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onKeyDown },
    clear,
  };
}
