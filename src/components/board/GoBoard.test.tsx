import { Profiler, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { fromDiagram, fromGtp, makeSettings, newGame, play } from '@/lib/zigo';
import type { Game, Size } from '@/lib/types';
import { GoBoard } from './GoBoard';
import { goBoardGameProps } from './gameProps';
import { COORD_FALLBACK, LIFT_PX, coordFontPitches, coordFontPx, extent } from './geometry';
import { renderStats } from './marks';
import type { GoBoardProps } from './types';
import {
  PITCH,
  cell,
  center,
  dragBetween,
  ghostEl,
  installPointerEvent,
  layoutGrid,
  pointerDownAt,
  pointerMoveTo,
  pointerUpAt,
  tap,
  tapAt,
} from './test-helpers';

beforeAll(installPointerEvent);

const P = (s: string, size: Size) => fromGtp(s, size) as string;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider language="en">
      {children}
    </I18nProvider>
  );
}

type Props = Partial<GoBoardProps> & { game?: Game };

function element({ game, ...over }: Props) {
  const g = game ?? newGame(makeSettings(over.size ?? 9));
  return <GoBoard {...goBoardGameProps(g)} helpers {...over} />;
}

function renderBoard(props: Props = {}) {
  const r = render(element(props), { wrapper: Wrapper });
  layoutGrid();
  return { ...r, update: (next: Props) => (r.rerender(element(next)), layoutGrid()) };
}

const svg = () => screen.getByTestId('board-svg');
const stones = (color?: 'B' | 'W') => svg().querySelectorAll(`[data-layer="stones"] use${color ? `[data-stone="${color}"]` : ''}`);
const marks = (kind: string) => svg().querySelectorAll(`[data-mark="${kind}"]`);
const touch = { pointerType: 'touch' } as const;

describe('GoBoard drawing', () => {
  it.each([9, 13, 19] as const)('draws a %i×%i grid of labelled cells in one SVG', (size) => {
    renderBoard({ size, game: newGame(makeSettings(size)) });
    const grid = screen.getByRole('grid', { name: `Go board, ${size}×${size}` });
    expect(grid.querySelectorAll('[role="row"]').length).toBe(size);
    expect(screen.getAllByRole('gridcell').length).toBe(size * size);
    expect(document.querySelectorAll('svg[data-testid="board-svg"]').length).toBe(1);
    expect(svg().getAttribute('viewBox')).toBe(`-0.8 -0.8 ${size + 0.6} ${size + 0.6}`);
    expect(svg().querySelectorAll('[data-star]').length).toBe(size === 19 ? 9 : 5);
    expect(screen.getByTestId('go-board').getAttribute('data-size')).toBe(String(size));
  });

  it('never clips: the SVG overflows visibly and pulses sit above the stones', () => {
    renderBoard();
    expect(svg().getAttribute('overflow')).toBe('visible');
    expect(svg().getAttribute('class')).toContain('overflow-visible');
    expect(document.querySelector('[data-testid="go-board"] .overflow-hidden')).toBeNull();
    const layers = [...svg().querySelectorAll('[data-layer]')].map((g) => g.getAttribute('data-layer'));
    expect(layers.indexOf('pulses')).toBeGreaterThan(layers.indexOf('stones'));
    expect(layers.indexOf('stones')).toBeGreaterThan(layers.indexOf('grid'));
  });

  it('sits in the rounded frame and sizes from --board-size', () => {
    renderBoard({ boardSize: '300px' });
    const root = screen.getByTestId('go-board');
    expect(root.style.getPropertyValue('--board-size')).toBe('300px');
    expect(root.firstElementChild!.className).toContain('rounded-lg bg-foreground/10 p-1 shadow-lg');
  });

  it('draws stones as shared symbols with theme-stable inks', () => {
    const game = fromDiagram(['xo.......', ...Array(8).fill('.........')]);
    renderBoard({ game });
    expect(stones('B').length).toBe(1);
    expect(stones('W').length).toBe(1);
    const href = stones('B')[0].getAttribute('href')!;
    const symbol = document.getElementById(href.slice(1))!;
    expect(symbol.tagName.toLowerCase()).toBe('symbol');
    expect((symbol.querySelector('circle') as SVGElement).style.fill).toContain('--ink-dark');
    const white = document.getElementById(stones('W')[0].getAttribute('href')!.slice(1))!;
    expect((white.querySelector('circle') as SVGElement).style.fill).toContain('--ink-light');
  });

  it('labels cells for screen readers (DESIGN 14.1)', () => {
    let game = newGame(makeSettings(19));
    game = play(game, P('D4', 19), 0);
    renderBoard({ size: 19, game, helpers: false });
    expect(cell(P('D4', 19))).toHaveAttribute('aria-label', 'black stone, D4');
    expect(cell(P('Q16', 19))).toHaveAttribute('aria-label', 'empty, Q16, star point');
    expect(cell(P('A1', 19))).toHaveAttribute('aria-label', 'empty, A1');
  });

  it('names the ko point', () => {
    // Black takes the ko at D4 (capturing C4); White may not retake at C4 this turn.
    const game = fromDiagram(
      [
        '.........',
        '.........',
        '.........',
        '.........',
        '..xo.....',
        '.xo.o....',
        '..xo.....',
        '.........',
        '.........',
      ],
      'B',
    );
    const after = play(game, P('D4', 9), 0);
    expect(after.ko).toBe(P('C4', 9));
    renderBoard({ game: after });
    expect(cell(P('C4', 9))).toHaveAttribute('aria-label', 'empty, C4, ko');
    expect(marks('ko').length).toBe(1);
  });

  it('shows coordinates, last move, ko and atari only with helpers', () => {
    const base = fromDiagram(['.x.......', 'xo.......', '.........', ...Array(6).fill('.........')], 'B');
    const game = play(base, 'ca', 0);
    renderBoard({ game, helpers: true });
    const coords = svg().querySelector('[data-layer="coordinates"]')!;
    expect(coords.textContent).toContain('J');
    expect(coords.textContent).not.toContain('I');
    expect(marks('last').length).toBe(1);
    cleanup();
    renderBoard({ game, helpers: false });
    expect(svg().querySelector('[data-layer="coordinates"]')).toBeNull();
    expect(marks('last').length).toBe(0);
  });

  it('keeps coordinate labels between 7 px and 0.5rem whatever the pitch (DESIGN 5.4)', () => {
    // 19×19 on a 320 px phone (pitch ≈ 15 px) and a 390 px phone (≈ 19 px), 9×9 on a desktop (≈ 80 px).
    expect(coordFontPx(15.3)).toBe(7);
    expect(coordFontPx(18.7)).toBe(8);
    expect(coordFontPx(80)).toBe(8);
    expect(coordFontPx(16.5)).toBeCloseTo(7.425, 5);
    for (const [width, size] of [[300.8, 19], [366.6, 19], [280, 19], [366.6, 13], [768, 9], [592, 9]] as const) {
      const pitch = width / extent(size);
      const px = coordFontPitches(width, size) * pitch;
      expect(px).toBeGreaterThanOrEqual(7);
      expect(px).toBeLessThanOrEqual(8);
      // A two-digit row label (about 1.1 em wide) centred 0.64 pitch out stays inside the margin
      // plus the frame's 4 px padding.
      expect(0.64 * pitch + 0.55 * px).toBeLessThanOrEqual(0.8 * pitch + 4);
    }
    expect(coordFontPitches(0, 19)).toBe(COORD_FALLBACK);
    expect(coordFontPitches(Number.NaN, 19)).toBe(COORD_FALLBACK);
  });

  it('sizes the coordinate labels from the measured board, also for the far side', () => {
    const spy = vi.spyOn(SVGElement.prototype, 'clientWidth', 'get').mockReturnValue(300.8);
    try {
      renderBoard({ size: 19, game: newGame(makeSettings(19)), helpers: true, seating: 'face' });
      const coords = svg().querySelector<SVGGElement>('[data-layer="coordinates"]')!;
      const pitch = 300.8 / extent(19);
      // 7 px on screen; the group draws at 100× and scales down by 1/100.
      expect(parseFloat(coords.style.fontSize)).toBeCloseTo((7 / pitch) * 100, 3);
      expect(coords.querySelectorAll('text').length).toBe(19 * 4);
      expect(coords.textContent).toContain('19');
      expect(coords.textContent).toContain('T');
    } finally {
      spy.mockRestore();
    }
  });

  it('rings and pulses the mover’s groups in atari', () => {
    // Black to move; the black stone at B8 has one liberty.
    const game = fromDiagram(['.o.......', 'oxo......', '.........', ...Array(6).fill('.........')], 'B');
    renderBoard({ game });
    expect(marks('atari').length).toBe(1);
    expect(marks('atari-pulse').length).toBe(1);
    expect(cell('bb').getAttribute('aria-label')).toBe('black stone, B8, atari');
  });

  it('announces moves, captures and atari in a polite live region', () => {
    const game = fromDiagram(['.o.......', 'ox.......', '.........', ...Array(6).fill('.........')], 'W');
    const r = renderBoard({ game });
    const live = screen.getByTestId('board-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    const next = play(game, 'cb', 0); // B8 is left with one liberty
    r.update({ game: next });
    expect(live.textContent).toContain('White: C8');
    expect(live.textContent).toContain('Your group at B8 is in atari');
    const away = play(next, 'ii', 0);
    const done = play(away, 'bc', 0); // White captures B8
    r.update({ game: away });
    r.update({ game: done });
    expect(live.textContent).toContain('White: B7, captures 1');
  });

  it('draws the scoring layer: dead stones faded with ×, territory squares', () => {
    const game = fromDiagram(['xo.......', ...Array(8).fill('.........')]);
    renderBoard({ game, scoring: { dead: ['ba'], territory: { ca: 'B', da: 'W', ea: null } } });
    const dead = svg().querySelector('use[data-state="dead"]')!;
    expect(dead.getAttribute('opacity')).toBe('0.4');
    expect(marks('dead').length).toBe(1);
    expect(marks('territory-B').length).toBe(1);
    expect(marks('territory-W').length).toBe(1);
    expect(cell('ba').getAttribute('aria-label')).toBe('white stone, B9, dead');
    expect(cell('ca').getAttribute('aria-label')).toBe('empty, C9, Black territory');
  });

  it('previews territory: squares by strength, opponent-owned stones faded', () => {
    const game = fromDiagram(['xo.......', ...Array(8).fill('.........')]);
    const ownership = new Float32Array(81).fill(0);
    ownership[0] = -0.9; // black stone owned by White → faded
    ownership[2] = 0.8;
    renderBoard({ game, territoryPreview: { ownership } });
    expect(svg().querySelector('use[data-state="faded"]')!.getAttribute('opacity')).toBe('0.5');
    expect(marks('preview-B').length).toBe(1);
  });

  it('pulses the best hint, numbers the top three and moves focus there', () => {
    const r = renderBoard({ hint: { best: 'ee' } });
    expect(marks('hint').length).toBe(1);
    expect(document.activeElement).toBe(cell('ee'));
    r.update({ hint: { top: ['cc', 'gg', 'cg'] } });
    expect([...marks('hint-n')].map((m) => m.textContent)).toEqual(['1', '2', '3']);
    expect(cell('gg').getAttribute('aria-label')).toBe('empty, G3, star point, hint 2');
    expect(document.activeElement).toBe(cell('cc'));
  });

  it('pulses a bounced stone with helpers only', () => {
    const r = renderBoard({ blunder: 'ee' });
    expect(marks('blunder').length).toBe(1);
    r.update({ blunder: 'ee', helpers: false });
    expect(marks('blunder').length).toBe(0);
  });

  it('re-renders only the rows that changed after a move', () => {
    let game = newGame(makeSettings(19));
    const r = renderBoard({ size: 19, game });
    renderStats.stoneRows = 0;
    game = play(game, P('D4', 19), 0);
    r.update({ size: 19, game });
    expect(renderStats.stoneRows).toBe(1);
  });

  it('draws 361 stones and updates one in reasonable time (jsdom)', () => {
    const full = new Uint8Array(361).map((_, i) => ((i + Math.floor(i / 19)) % 2 ? 1 : 2));
    const durations: number[] = [];
    const onRender = (_id: string, _phase: string, actual: number) => durations.push(actual);
    const props = { size: 19 as const, board: full, turn: 'B' as const, helpers: true };
    const { rerender } = render(
      <Profiler id="b" onRender={onRender}>
        <GoBoard {...props} />
      </Profiler>,
      { wrapper: Wrapper },
    );
    expect(stones().length).toBe(361);
    const next = full.slice();
    next[0] = 0;
    rerender(
      <Profiler id="b" onRender={onRender}>
        <GoBoard {...props} board={next} />
      </Profiler>,
    );
    expect(stones().length).toBe(360);
    // jsdom is several times slower than a browser; this guards against regressions only.
    expect(durations[durations.length - 1]).toBeLessThan(250);
    console.info(`[GoBoard] 361 stones: mount ${durations[0].toFixed(1)} ms, update ${durations[durations.length - 1].toFixed(1)} ms (jsdom)`);
  });
});

describe('GoBoard input: mouse (fine pointer)', () => {
  it('shows a hover stone and places on click, on every size', () => {
    for (const size of [9, 19] as const) {
      cleanup();
      const onPlay = vi.fn();
      renderBoard({ size, game: newGame(makeSettings(size)), onPlay });
      const c = center('cc');
      pointerMoveTo(c.x, c.y);
      expect(screen.getByTestId('hover').getAttribute('data-point')).toBe('cc');
      expect(marks('crosshair').length).toBe(0); // hover has no crosshairs
      tap('cc');
      expect(onPlay).toHaveBeenCalledWith('cc');
    }
  });

  it('never commits an illegal point; tells the reason with helpers on only', () => {
    const game = fromDiagram(['x........', ...Array(8).fill('.........')]);
    const onPlay = vi.fn();
    const onIllegal = vi.fn();
    const r = renderBoard({ game, onPlay, onIllegal });
    tap('aa');
    expect(onPlay).not.toHaveBeenCalled();
    expect(onIllegal).toHaveBeenCalledWith('aa', 'occupied');
    onIllegal.mockClear();
    r.update({ game, onPlay, onIllegal, illegalReason: (p) => (p === 'ee' ? 'ko' : null) });
    tap('ee');
    expect(onIllegal).toHaveBeenCalledWith('ee', 'ko');
    onIllegal.mockClear();
    r.update({ game, onPlay, onIllegal, helpers: false, illegalReason: (p) => (p === 'ee' ? 'superko' : null) });
    tap('ee');
    expect(onIllegal).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('takes no input when not interactive', () => {
    const onPlay = vi.fn();
    renderBoard({ onPlay, interactive: false });
    tap('cc');
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
  });
});

describe('GoBoard input: touch on 9×9', () => {
  it('places at once on a tap', () => {
    const onPlay = vi.fn();
    renderBoard({ onPlay });
    tap('ee', touch);
    expect(onPlay).toHaveBeenCalledWith('ee');
    expect(ghostEl()).toBeNull();
  });

  it('shows the ghost under a dragging finger and places on release', () => {
    const onPlay = vi.fn();
    renderBoard({ onPlay });
    const a = center('cc');
    const b = center('ff');
    pointerDownAt(a.x, a.y, touch);
    pointerMoveTo(a.x + 20, a.y + 20, touch);
    pointerMoveTo(b.x, b.y, touch);
    expect(ghostEl()!.getAttribute('data-point')).toBe('ff');
    expect(marks('crosshair').length).toBe(1);
    expect(onPlay).not.toHaveBeenCalled();
    pointerUpAt(b.x, b.y, touch);
    expect(onPlay).toHaveBeenCalledWith('ff');
  });
});

describe.each([13, 19] as const)('GoBoard input: touch on %i×%i (ghost, then confirm)', (size) => {
  const game = () => newGame(makeSettings(size));

  it('shows the ghost on the first tap and commits on a second tap on it', () => {
    const onPlay = vi.fn();
    const onGhostChange = vi.fn();
    renderBoard({ size, game: game(), onPlay, onGhostChange });
    tap('dd', touch);
    expect(onPlay).not.toHaveBeenCalled();
    expect(ghostEl()!.getAttribute('data-point')).toBe('dd');
    expect(ghostEl()!.getAttribute('opacity')).toBe('0.45');
    expect(marks('crosshair').length).toBe(1);
    expect(onGhostChange).toHaveBeenLastCalledWith('dd');
    // The confirming tap may land off-center: the hit area is the cell plus half a pitch.
    const c = center('dd');
    tapAt(c.x + PITCH * 0.9, c.y - PITCH * 0.9, touch);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith('dd');
    expect(ghostEl()).toBeNull();
    expect(onGhostChange).toHaveBeenLastCalledWith(null);
  });

  it('moves the ghost on a tap elsewhere and cancels it off the board', () => {
    const onPlay = vi.fn();
    renderBoard({ size, game: game(), onPlay });
    tap('dd', touch);
    tap('jj', touch);
    expect(ghostEl()!.getAttribute('data-point')).toBe('jj');
    expect(onPlay).not.toHaveBeenCalled();
    tapAt(2, 2, touch); // the margin outside the edge lines
    expect(ghostEl()).toBeNull();
    tap('jj', touch);
    expect(ghostEl()).not.toBeNull();
    fireEvent.pointerDown(document.body, { pointerId: 2, pointerType: 'touch' });
    expect(ghostEl()).toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('floats the ghost one finger-width above a drag, snapping, and never commits a drag', () => {
    const onPlay = vi.fn();
    renderBoard({ size, game: game(), onPlay });
    const target = center('gg');
    dragBetween({ x: target.x - 60, y: target.y + LIFT_PX + 60 }, { x: target.x + 5, y: target.y + LIFT_PX - 4 }, touch);
    expect(ghostEl()!.getAttribute('data-point')).toBe('gg');
    expect(onPlay).not.toHaveBeenCalled();
    // A drag that starts on the ghost moves it and still does not commit.
    dragBetween(target, { x: target.x + PITCH * 2, y: target.y + LIFT_PX }, touch);
    expect(ghostEl()!.getAttribute('data-point')).toBe('ig');
    expect(onPlay).not.toHaveBeenCalled();
    tap('ig', touch);
    expect(onPlay).toHaveBeenCalledWith('ig');
  });

  it('lifts downwards for the far player in face-to-face seating', () => {
    renderBoard({ size, game: game(), seating: 'face', farColor: 'B' });
    const target = center('gg');
    dragBetween({ x: target.x, y: target.y - LIFT_PX - 60 }, { x: target.x, y: target.y - LIFT_PX }, touch);
    expect(ghostEl()!.getAttribute('data-point')).toBe('gg');
  });

  it('keeps the ghost across re-renders', () => {
    const onPlay = vi.fn();
    const g0 = game();
    const r = renderBoard({ size, game: g0, onPlay });
    tap('dd', touch);
    r.update({ size, game: g0, onPlay, hint: { best: 'jj' } });
    r.update({ size, game: play(g0, 'jj', 0), onPlay });
    expect(ghostEl()!.getAttribute('data-point')).toBe('dd');
  });

  it('turns the ghost hollow with × on an illegal point and never commits it', () => {
    const onPlay = vi.fn();
    const onIllegal = vi.fn();
    renderBoard({ size, game: game(), onPlay, onIllegal, illegalReason: (p) => (p === 'dd' ? 'ko' : null) });
    tap('dd', touch);
    expect(ghostEl()!.getAttribute('data-illegal')).toBe('true');
    expect(onIllegal).toHaveBeenCalledWith('dd', 'ko');
    tap('dd', touch);
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('GoBoard keyboard', () => {
  it('moves a roving focus with the arrows and places with Enter or Space', () => {
    const onPlay = vi.fn();
    renderBoard({ onPlay });
    const start = cell('ee');
    expect(start).toHaveAttribute('tabindex', '0');
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cell('dd'));
    expect(cell('dd')).toHaveAttribute('tabindex', '0');
    expect(cell('ee')).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onPlay).toHaveBeenCalledWith('dd');
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(onPlay).toHaveBeenCalledTimes(2);
  });

  it('places a typed coordinate with Enter, anywhere on the page', () => {
    const onPlay = vi.fn();
    renderBoard({ size: 19, game: newGame(makeSettings(19)), onPlay });
    for (const key of ['d', '4']) fireEvent.keyDown(document.body, { key });
    expect(screen.getByTestId('board-typed').textContent).toContain('D4');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onPlay).toHaveBeenCalledWith(P('D4', 19));
  });

  it('passes on P or pass + Enter, and shakes off nonsense', () => {
    const onPass = vi.fn();
    const onPlay = vi.fn();
    renderBoard({ onPass, onPlay });
    for (const key of ['p', 'a', 's', 's', 'Enter']) fireEvent.keyDown(document.body, { key });
    expect(onPass).toHaveBeenCalledTimes(1);
    for (const key of ['P', 'Enter']) fireEvent.keyDown(document.body, { key });
    expect(onPass).toHaveBeenCalledTimes(2);
    for (const key of ['T', '1', '9', 'Enter']) fireEvent.keyDown(document.body, { key }); // off a 9×9 board
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-typed').textContent).toBe('T19');
  });

  it('calls undo and redo on Z and Shift+Z, and takes the key', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    renderBoard({ onUndo, onRedo });
    const ev = new KeyboardEvent('keydown', { key: 'z', cancelable: true });
    window.dispatchEvent(ev);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Z', shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('ignores typing in fields and with modifiers', () => {
    const onPlay = vi.fn();
    renderBoard({ onPlay });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'd' });
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    expect(screen.queryByTestId('board-typed')).toBeNull();
  });
});

describe('GoBoard scoring', () => {
  const game = fromDiagram(['xo.......', 'xo.......', ...Array(7).fill('.........')]);
  const scoring = { dead: [] as string[], territory: {} };

  it('toggles a group on a tap on a stone, with any pointer, and never plays', () => {
    const onToggleGroup = vi.fn();
    const onPlay = vi.fn();
    renderBoard({ size: 9, game, scoring, onToggleGroup, onPlay });
    tap('ba', touch);
    expect(onToggleGroup).toHaveBeenCalledWith('ba');
    tap('ab');
    expect(onToggleGroup).toHaveBeenCalledWith('ab');
    tap('ee', touch);
    expect(onToggleGroup).toHaveBeenCalledTimes(2);
    expect(onPlay).not.toHaveBeenCalled();
    expect(ghostEl()).toBeNull();
  });

  it('toggles with Enter on a focused stone', () => {
    const onToggleGroup = vi.fn();
    renderBoard({ size: 9, game, scoring, onToggleGroup });
    act(() => cell('ee').focus());
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    for (let i = 0; i < 4; i++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cell('aa'));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onToggleGroup).toHaveBeenCalledWith('aa');
  });
});
