import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { Language, SavedGame } from '@/lib/types';
import { handicapPoints, pointToIndex } from '@/lib/zigo';
import { DIAL_GEOMETRY, DIAL_MAX_ITEMS, dialAim, dialItemOffset, nearestIndex } from './dialGeometry';
import { HandicapDial, type HandicapDialProps } from './HandicapDial';
import { previewGame } from './preview';
import { RulesDial, type RulesDialProps } from './RulesDial';

const wrap = (ui: ReactElement, language: Language = 'en') => render(<I18nProvider language={language}>{ui}</I18nProvider>);

const X = 500;
const Y = 400;
const winPointer = (type: 'pointermove' | 'pointerup', x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  });
const down = (el: Element) =>
  act(() => {
    fireEvent(el, new MouseEvent('pointerdown', { clientX: X, clientY: Y, bubbles: true, cancelable: true }));
  });
const values = (dial: HTMLElement) => [...dial.querySelectorAll('[data-value]')].map((e) => e.getAttribute('data-value'));

/* ---------------------------------------------------------------------------------------------- */

describe('dial geometry', () => {
  it('puts item 0 at 12 o’clock and turns the ring by a rotation', () => {
    expect(dialItemOffset(0, 9, 60)).toEqual({ x: 0, y: -60 });
    expect(dialItemOffset(0, 2, 60, -0.25)).toEqual({ x: -60, y: 0 });
    expect(dialItemOffset(1, 2, 60, -0.25)).toEqual({ x: 60, y: 0 });
  });

  it('aims at what lies in the pointer’s direction, rotated or not', () => {
    expect(dialAim(0, -60, 9)).toEqual({ zone: 'commit', index: 0 });
    expect(dialAim(60, 0, 9).index).toBe(2);
    expect(dialAim(-60, 0, 2, -0.25)).toEqual({ zone: 'commit', index: 0 });
    expect(dialAim(45, 0, 2, -0.25)).toEqual({ zone: 'aim', index: 1 });
    // Up or down on a two-item horizontal dial still picks a side, by the half it leans to.
    expect(dialAim(-5, -60, 2, -0.25).index).toBe(0);
    expect(dialAim(5, 60, 2, -0.25).index).toBe(1);
    expect(dialAim(10, 10, 2)).toEqual({ zone: 'center', index: null });
    expect(dialAim(30, 0, 2)).toEqual({ zone: 'none', index: null });
    expect(dialAim(Number.NaN, Number.NaN, 9)).toEqual({ zone: 'none', index: null });
  });

  it('finds the nearest value (ties: the earlier) and keeps to nine items', () => {
    expect(nearestIndex([1, 3, 5], 4)).toBe(1);
    expect(nearestIndex([1, 3, 5], 9)).toBe(2);
    expect(DIAL_MAX_ITEMS).toBe(9);
    expect(DIAL_GEOMETRY.reach).toBe(DIAL_GEOMETRY.radius + 20);
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('HandicapDial (DESIGN 4.1, 8.2)', () => {
  function mount(props: Partial<HandicapDialProps> = {}, language: Language = 'en') {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const utils = wrap(<HandicapDial x={X} y={Y} size={19} value={0} onPick={onPick} onCancel={onCancel} {...props} />, language);
    return { ...utils, onPick, onCancel, dial: () => screen.getByTestId('handicap-dial') };
  }

  it('offers 0 and 2 … 9 on 19×19 and 13×13, the current one noted', () => {
    const { dial, unmount } = mount({ value: 4 });
    expect(values(dial())).toEqual(['0', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(dial().querySelector('[data-value="4"]')).toHaveClass('dial-item--noted');
    expect(dial()).toHaveAccessibleName('Handicap on 19×19');
    expect(dial().querySelector('[data-value="0"]')).toHaveAccessibleName('No handicap');
    expect(dial().querySelector('[data-value="3"]')).toHaveAccessibleName('3 handicap stones');
    unmount();
    const b = mount({ size: 13 });
    expect(values(b.dial())).toHaveLength(9);
  });

  it('offers 0 and 2 … 5 on 9×9', () => {
    const { dial } = mount({ size: 9, value: 5 });
    expect(values(dial())).toEqual(['0', '2', '3', '4', '5']);
    expect(dial().querySelector('[data-value="5"]')).toHaveAttribute('aria-checked', 'true');
  });

  it('draws the stone glyph in its caption', () => {
    const { dial } = mount();
    const caption = dial().querySelector('[data-part="caption"]')!;
    expect(caption).toHaveTextContent('Handicap · 19×19');
    expect(caption.querySelector('svg')).not.toBeNull();
  });

  it('picks by drag from the hold, by tap and by keyboard', () => {
    const a = mount({ dragging: true });
    // Straight up: the first item, 0.
    winPointer('pointermove', X, Y - 60);
    winPointer('pointerup', X, Y - 60);
    expect(a.onPick).toHaveBeenCalledWith(0);
    a.unmount();
    const b = mount();
    down(b.dial().querySelector('[data-value="7"]')!);
    expect(b.onPick).toHaveBeenCalledWith(7);
    b.unmount();
    const c = mount({ value: 3 });
    fireEvent.keyDown(c.dial(), { key: 'ArrowRight' });
    fireEvent.keyDown(c.dial(), { key: 'ArrowRight' });
    fireEvent.keyDown(c.dial(), { key: 'Enter' });
    expect(c.onPick).toHaveBeenCalledWith(4);
    fireEvent.keyDown(c.dial(), { key: 'Escape' });
    expect(c.onCancel).toHaveBeenCalledTimes(1);
  });

  it('is translated with the glossary words', () => {
    const { dial } = mount({ size: 9 }, 'de');
    expect(dial()).toHaveAccessibleName('Vorgabe auf 9×9');
    expect(dial().querySelector('[data-value="2"]')).toHaveAccessibleName('2 Vorgabesteine');
    expect(screen.getByRole('menuitem', { name: 'Abbrechen' })).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('RulesDial (DESIGN 4.1, 8.2)', () => {
  function mount(props: Partial<RulesDialProps> = {}, language: Language = 'en') {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const utils = wrap(<RulesDial x={X} y={Y} value="area" onPick={onPick} onCancel={onCancel} {...props} />, language);
    return { ...utils, onPick, onCancel, dial: () => screen.getByTestId('rules-dial') };
  }

  it('offers area (CN, komi 7.5) at 9 o’clock and territory (JP, komi 6.5) at 3 o’clock', () => {
    const { dial } = mount({ value: 'territory' });
    expect(values(dial())).toEqual(['area', 'territory']);
    const area = dial().querySelector<HTMLElement>('[data-value="area"]')!;
    const territory = dial().querySelector<HTMLElement>('[data-value="territory"]')!;
    expect(area).toHaveTextContent('CN');
    expect(territory).toHaveTextContent('JP');
    expect(area).toHaveAccessibleName('Area scoring, komi 7.5');
    expect(territory).toHaveAccessibleName('Territory scoring, komi 6.5');
    expect(territory).toHaveClass('dial-item--noted');
    expect(area.style.left).toBe(`${-DIAL_GEOMETRY.radius - 20}px`);
    expect(territory.style.left).toBe(`${DIAL_GEOMETRY.radius - 20}px`);
  });

  it('names the aimed rule set in the caption and picks it on release', () => {
    const { dial, onPick } = mount({ dragging: true });
    const caption = () => dial().querySelector('[data-part="caption"]')!;
    expect(caption()).toHaveTextContent('Rules');
    winPointer('pointermove', X + 60, Y);
    expect(caption()).toHaveTextContent('Territory · komi 6.5');
    winPointer('pointermove', X - 60, Y);
    expect(caption()).toHaveTextContent('Area · komi 7.5');
    winPointer('pointermove', X + 60, Y);
    winPointer('pointerup', X + 60, Y);
    expect(onPick).toHaveBeenCalledWith('territory');
  });

  it('Enter without an aim keeps the current rules', () => {
    const { dial, onPick } = mount({ value: 'territory' });
    fireEvent.keyDown(dial(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('territory');
  });

  it('is translated', () => {
    const { dial } = mount({}, 'es');
    expect(dial()).toHaveAccessibleName('Reglas');
    expect(dial().querySelector('[data-value="territory"]')).toHaveAccessibleName('Puntuación por territorio, komi 6.5');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('previewGame (DESIGN 4: the blurred board)', () => {
  it('is an empty board of the selected size', () => {
    for (const size of [9, 13, 19] as const) {
      const g = previewGame({ size, rules: 'area', handicap: 0 });
      expect(g.settings.size).toBe(size);
      expect(g.board).toHaveLength(size * size);
      expect(g.board.every((v) => v === 0)).toBe(true);
    }
  });

  it('shows the selected handicap stones on their star points', () => {
    const g = previewGame({ size: 13, rules: 'territory', handicap: 3 });
    const black = handicapPoints(13, 3).map((p) => pointToIndex(p, 13));
    expect(black).toHaveLength(3);
    for (const i of black) expect(g.board[i]).toBe(1);
    expect(g.board.filter((v) => v !== 0)).toHaveLength(3);
    expect(g.settings.rules).toBe('territory');
  });

  it('shows the position of the saved game the code refers to', () => {
    const saved: SavedGame = {
      id: 'ABC',
      code: 'ABC',
      mode: 'local',
      color: 'B',
      size: 9,
      rules: 'area',
      handicap: 0,
      tc: null,
      moves: 'eeff',
      ms: [0, 0],
      assisted: false,
      createdAt: 1,
      lastPlayedAt: 1,
    };
    const g = previewGame({ size: 19, rules: 'area', handicap: 0 }, saved);
    expect(g.settings.size).toBe(9);
    expect(g.board[pointToIndex('ee', 9)]).toBe(1);
    expect(g.board[pointToIndex('ff', 9)]).toBe(2);
    // A damaged record shows what can be read.
    const broken = previewGame({ size: 19, rules: 'area', handicap: 0 }, { ...saved, moves: 'eeeeff' });
    expect(broken.board[pointToIndex('ee', 9)]).toBe(1);
  });
});
