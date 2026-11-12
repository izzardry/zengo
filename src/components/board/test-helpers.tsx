/**
 * Test helpers for the board package (not shipped: only tests import this file).
 * jsdom has no PointerEvent and no layout, so tests install a PointerEvent built on MouseEvent
 * and give the board grid a fixed box at (0, 0) whose pitch is `PITCH` px for every size.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '@/lib/i18n';
import type { Point } from '@/lib/types';
import { extent, pointCenter, type Box } from './geometry';

/** Pixel pitch of the laid-out test board. */
export const PITCH = 40;

/** The test box of a board of `size` (pitch `PITCH`). */
export function boxFor(size: number): Box & { right: number; bottom: number; x: number; y: number } {
  const w = PITCH * extent(size);
  return { left: 0, top: 0, width: w, height: w, right: w, bottom: w, x: 0, y: 0 };
}

/** Installs a minimal PointerEvent (MouseEvent + pointerId + pointerType) if jsdom lacks one. */
export function installPointerEvent(): void {
  if (typeof window.PointerEvent === 'function') return;
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
}

export function renderWithI18n(ui: ReactElement) {
  return render(
    <I18nProvider language="en">
      {ui}
    </I18nProvider>,
  );
}

function boardSize(grid: HTMLElement): number {
  const s = Number(grid.closest('[data-size]')?.getAttribute('data-size'));
  return s === 9 || s === 13 ? s : 19;
}

/** Gives the board grid a layout box so hit tests work. */
export function layoutGrid(): HTMLElement {
  const grid = screen.getByRole('grid');
  const box = boxFor(boardSize(grid));
  grid.getBoundingClientRect = () => box as DOMRect;
  return grid;
}

/** The grid cell of a point. */
export const cell = (p: Point): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[role="gridcell"][data-point="${p}"]`);
  if (!el) throw new Error(`no cell ${p}`);
  return el;
};

/** Client center of a point on the laid-out test board. */
export function center(p: Point, size?: number) {
  const s = size ?? boardSize(screen.getByRole('grid'));
  return pointCenter(p, boxFor(s), s);
}

type PointerOpts = { pointerType?: string; pointerId?: number };

function init(x: number, y: number, o: PointerOpts) {
  return { pointerId: o.pointerId ?? 1, pointerType: o.pointerType ?? 'mouse', button: 0, clientX: x, clientY: y };
}

/** A tap (pointerdown + pointerup) on a point. Mouse by default; `{ pointerType: 'touch' }` for a finger. */
export function tap(p: Point, o: PointerOpts = {}) {
  const { x, y } = center(p);
  fireEvent.pointerDown(cell(p), init(x, y, o));
  fireEvent.pointerUp(cell(p), init(x, y, o));
}

/** A tap at client coordinates on the grid. */
export function tapAt(x: number, y: number, o: PointerOpts = {}) {
  const grid = screen.getByRole('grid');
  fireEvent.pointerDown(grid, init(x, y, o));
  fireEvent.pointerUp(grid, init(x, y, o));
}

export function pointerDownAt(x: number, y: number, o: PointerOpts = {}) {
  fireEvent.pointerDown(screen.getByRole('grid'), init(x, y, o));
}

export function pointerMoveTo(x: number, y: number, o: PointerOpts = {}) {
  fireEvent.pointerMove(screen.getByRole('grid'), init(x, y, o));
}

export function pointerUpAt(x: number, y: number, o: PointerOpts = {}) {
  fireEvent.pointerUp(screen.getByRole('grid'), init(x, y, o));
}

/** Drag from one client position to another with intermediate moves. */
export function dragBetween(a: { x: number; y: number }, b: { x: number; y: number }, o: PointerOpts = {}) {
  pointerDownAt(a.x, a.y, o);
  pointerMoveTo(a.x + (b.x - a.x) / 2 + 12, a.y + (b.y - a.y) / 2 + 12, o);
  pointerMoveTo(b.x, b.y, o);
  pointerUpAt(b.x, b.y, o);
}

/** The ghost element, or null. */
export function ghostEl(): Element | null {
  return document.querySelector('[data-testid="ghost"]');
}
