/**
 * The integrated stage (Integrator 1): start ⇄ game, pass-and-play, undo/redo, hidden chrome,
 * passes with their undo toast, resign with undo, scoring with a marked group and Accept, game over,
 * history, review, continue from here, the ko toast and the live region. Computer and room Start
 * answer `Coming soon` until milestones 2 and 3.
 * The real browser paths (touch ghost, dials, reload, share) are covered by e2e/m1.spec.ts.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/lib/i18n';
import zigo, { encodeMoves, fromGtp, makeSettings } from '@/lib/zigo';
import type { Point } from '@/lib/types';
import { cell, installPointerEvent, layoutGrid, tap } from '@/components/board/test-helpers';
import Index from './Index';

function renderStage(path = '/') {
  return render(
    <I18nProvider language="en">
      <TooltipProvider>
        <Toaster />
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Index />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </I18nProvider>,
  );
}

const stage = () => screen.getByTestId('stage');
const pt = (s: string, size: 9 | 13 | 19 = 9): Point => fromGtp(s, size) as Point;
const cellName = (s: string) => cell(pt(s)).getAttribute('aria-label');

/** Places a stone with the mouse (9×9: a click places at once). */
function place(s: string) {
  layoutGrid();
  act(() => tap(pt(s)));
}

function selectOpponent(name: string) {
  const value = () => screen.queryByText(name, { exact: true });
  for (let i = 0; i < 14 && !value(); i++) fireEvent.click(screen.getByRole('button', { name: 'Previous opponent' }));
  expect(value()).toBeInTheDocument();
}

function startTwoPlayers() {
  selectOpponent('Two players');
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  expect(stage()).toHaveAttribute('data-phase', 'playing');
}

const toolbar = () => screen.getByRole('toolbar');
const toolbarButton = (name: string | RegExp) => within(toolbar()).getByRole('button', { name });
const flag = () => toolbarButton(/^Pass/);

beforeAll(() => {
  installPointerEvent();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('zigo:tutorial-seen', 'true');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Index stage', () => {
  it('shows the start screen with a blurred 9×9 preview and the Start pill', () => {
    renderStage();
    expect(stage()).toHaveAttribute('data-phase', 'start');
    expect(screen.getByRole('heading', { name: 'ZIGO' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByTestId('board-preview').firstElementChild).toHaveAttribute('data-blurred', 'true');
    expect(screen.getAllByRole('gridcell', { hidden: true })).toHaveLength(81);
    // Default opponent: COMPUTER 5 MEDIUM (DESIGN 4.1).
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('answers Start with the computer or a room with Coming soon until milestones 2 and 3', async () => {
    renderStage();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Coming soon')).toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-phase', 'start');
    selectOpponent('Room');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(stage()).toHaveAttribute('data-phase', 'start');
  });

  it('the size pill switches the preview to 13×13 and 19×19', () => {
    renderStage();
    const pill = screen.getByRole('button', { name: /9×9/ });
    fireEvent.click(pill);
    expect(screen.getAllByRole('gridcell', { hidden: true })).toHaveLength(169);
    fireEvent.click(screen.getByRole('button', { name: /13×13/ }));
    expect(screen.getAllByRole('gridcell', { hidden: true })).toHaveLength(361);
    expect(localStorage.getItem('zigo:size')).toBe('19');
  });

  it('plays pass-and-play with undo and redo from the toolbar and the keyboard', () => {
    renderStage();
    startTwoPlayers();
    expect(screen.getByTestId('board-preview').firstElementChild).toHaveAttribute('data-blurred', 'false');
    place('D4');
    expect(cellName('D4')).toMatch(/^black stone, D4/);
    expect(screen.getByTestId('board-live')).toHaveTextContent('Black: D4');
    place('E5');
    expect(cellName('E5')).toMatch(/^white stone, E5/);
    expect(screen.getByTestId('board-live')).toHaveTextContent('White: E5');
    // The move strip shows the last move in GTP.
    expect(screen.getByRole('group', { name: 'Game info' })).toHaveTextContent('2.E5');

    fireEvent.click(toolbarButton('Undo'));
    expect(cellName('E5')).toMatch(/^empty, E5/);
    fireEvent.keyDown(window, { key: 'z' });
    expect(cellName('D4')).toMatch(/^empty, D4/);
    fireEvent.keyDown(window, { key: 'Z', shiftKey: true });
    expect(cellName('D4')).toMatch(/^black stone, D4/);
    fireEvent.click(toolbarButton('Redo'));
    expect(cellName('E5')).toMatch(/^white stone, E5/);
  });

  it('places a typed coordinate and passes on `pass` + Enter (DESIGN 6.1)', () => {
    renderStage();
    startTwoPlayers();
    for (const key of ['d', '4', 'Enter']) fireEvent.keyDown(window, { key });
    expect(cellName('D4')).toMatch(/^black stone, D4/);
    for (const key of ['p', 'a', 's', 's', 'Enter']) fireEvent.keyDown(window, { key });
    expect(screen.getByTestId('board-live')).toHaveTextContent('White passes');
    expect(screen.getByText('passed')).toBeInTheDocument();
  });

  it('hides and shows the chrome when the empty stage is tapped', () => {
    renderStage();
    startTwoPlayers();
    const bar = toolbar();
    expect(bar).not.toHaveAttribute('aria-hidden');
    fireEvent.click(stage());
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    // The clocks stay: both timers are still there.
    expect(screen.getAllByRole('timer')).toHaveLength(2);
    fireEvent.click(stage());
    expect(bar).not.toHaveAttribute('aria-hidden');
  });

  it('switches seating face to face: the far side is drawn upside down', () => {
    renderStage();
    startTwoPlayers();
    const seat = toolbarButton(/face to face|side by side/i);
    const before = document.querySelectorAll('.rotate-180').length;
    fireEvent.click(seat);
    const after = document.querySelectorAll('.rotate-180').length;
    expect(after).not.toBe(before);
  });

  it('face to face in mobile landscape: the far strip and clock in the left rail are rotated too (DESIGN 5.2)', () => {
    const size = { w: window.innerWidth, h: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true });
    try {
      renderStage();
      startTwoPlayers();
      const seat = toolbarButton(/face to face|side by side/i);
      const rotatedTimers = () => screen.getAllByRole('timer').filter((el) => el.closest('.rotate-180')).length;
      if (rotatedTimers() === 0) fireEvent.click(seat);
      // Exactly the far player's clock is upside down.
      expect(rotatedTimers()).toBe(1);
      fireEvent.click(seat);
      expect(rotatedTimers()).toBe(0);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: size.w, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: size.h, configurable: true });
    }
  });

  it('passes on a tap of the flag; the toast takes the pass back (DESIGN 6.2)', () => {
    renderStage();
    startTwoPlayers();
    place('D4');
    fireEvent.click(flag());
    expect(screen.getByText('passed')).toBeInTheDocument();
    // After White's pass the flag carries the dot and says it ends the game.
    expect(toolbarButton('Pass and end the game (hold to resign)')).toBeInTheDocument();
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('White passed'));
    expect(status).toBeDefined();
    fireEvent.click(within(status!).getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('passed')).toBeNull();
    expect(toolbarButton('Pass (hold to resign)')).toBeInTheDocument();
    // White is to move again.
    place('E5');
    expect(cellName('E5')).toMatch(/^white stone, E5/);
  });

  it('resigns on a 500 ms hold and the toast takes it back', () => {
    vi.useFakeTimers();
    renderStage();
    startTwoPlayers();
    place('D4');
    const f = flag();
    fireEvent.pointerDown(f, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerUp(f, { button: 0, pointerId: 1 });
    // White was to move, so White resigned; the toast offers Undo for 5 s.
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('White resigned'));
    expect(status).toBeDefined();
    expect(flag()).toBeDisabled();
    fireEvent.click(within(status!).getByRole('button', { name: 'Undo' }));
    expect(flag()).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses a ko retake with a one-time toast and counts the prisoner', async () => {
    renderStage();
    startTwoPlayers();
    // Black C5 D6 D4 around D5; White E6 E4 F5 around E5; Black E5 takes White's D5.
    for (const m of ['C5', 'E6', 'D6', 'E4', 'D4', 'F5', 'A1', 'D5', 'E5']) place(m);
    expect(cellName('D5')).toMatch(/^empty, D5/);
    expect(screen.getByTestId('board-live')).toHaveTextContent('Black: E5, captures 1');
    expect(screen.getByLabelText('Black has captured 1')).toBeInTheDocument();
    place('D5');
    expect(cellName('D5')).toMatch(/^empty, D5/);
    expect(await screen.findByText(/^Ko:/)).toBeInTheDocument();
  });

  it('scores a game through two passes, a dead group and Accept (DESIGN 8.4, 8.5)', async () => {
    renderStage();
    startTwoPlayers();
    place('E5');
    place('A1');
    fireEvent.click(flag());
    fireEvent.click(flag());
    expect(stage()).toHaveAttribute('data-phase', 'scoring');
    const bar = screen.getByRole('group', { name: 'Scoring' });
    // Mark White's lone stone dead: Black owns the whole board, 81 against 7.5.
    place('A1');
    expect(cellName('A1')).toMatch(/dead/);
    expect(screen.getAllByText(/B 81 · W 0 \+ 7\.5/).length).toBeGreaterThan(0);
    fireEvent.click(within(bar).getByRole('button', { name: /^Accept/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Black wins by 73.5!' }, { timeout: 3000 });
    expect(dialog).toHaveTextContent('9×9');
    fireEvent.click(within(dialog).getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(cellName('E5')).toMatch(/^empty, E5/);
  });

  it('face to face, the game ends when both players have accepted (DESIGN 8.4)', async () => {
    localStorage.setItem('zigo:seating', JSON.stringify('face'));
    renderStage();
    startTwoPlayers();
    place('E5');
    fireEvent.click(flag());
    fireEvent.click(flag());
    expect(stage()).toHaveAttribute('data-phase', 'scoring');
    // The far player's Accept sits in the rotated far strip.
    const farAccept = screen.getByRole('button', { name: 'Accept the count for White' });
    expect(farAccept.closest('.rotate-180')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Accept the count for Black' }));
    expect(stage()).toHaveAttribute('data-phase', 'scoring');
    fireEvent.click(farAccept);
    expect(await screen.findByRole('dialog', { name: /^Black wins by/ }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('lists the game in history after Back and resumes it', () => {
    renderStage();
    startTwoPlayers();
    place('D4');
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(stage()).toHaveAttribute('data-phase', 'start');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    const card = screen.getByTestId('history-card');
    expect(card).toHaveTextContent('9×9');
    fireEvent.click(card);
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(cellName('D4')).toMatch(/^black stone, D4/);
  });

  it('opens a finished game link in review; steps; continues from here at the same size', async () => {
    const moves = ['D4', 'K10', 'K4'].map((s) => ({ m: pt(s, 13), ms: 0 }));
    const m = encodeMoves(moves);
    renderStage(`/?s=GOREV1&p=1&o=l&n=13&m=${m}&r=W%2BR`);
    await waitFor(() => expect(stage()).toHaveAttribute('data-phase', 'review'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(169);
    const name = (s: string) => cell(pt(s, 13)).getAttribute('aria-label');
    expect(name('K4')).toMatch(/^black stone, K4/);

    fireEvent.click(toolbarButton(/^Previous move/));
    expect(name('K4')).toMatch(/^empty, K4/);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(name('K4')).toMatch(/^black stone, K4/);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.click(toolbarButton('Continue from here'));
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(screen.getAllByRole('gridcell')).toHaveLength(169);
    expect(name('K10')).toMatch(/^white stone, K10/);
    expect(name('K4')).toMatch(/^empty, K4/);
    expect(within(screen.getByRole('group', { name: 'Game info' })).queryByText('GOREV1')).toBeNull();
  });

  it('starts a handicap game with the stones on the star points and White to move', () => {
    localStorage.setItem('zigo:size', '13');
    localStorage.setItem('zigo:handicap', JSON.stringify({ 13: 3 }));
    renderStage();
    startTwoPlayers();
    const name = (s: string) => cell(pt(s, 13)).getAttribute('aria-label');
    const expected = zigo.newGame(makeSettings(13, 'area', 3));
    expect(expected.turn).toBe('W');
    for (const s of ['D4', 'K10', 'D10']) expect(name(s)).toMatch(/^black stone/);
    // Komi 0.5 on White's strip.
    expect(screen.getByText('+0.5')).toBeInTheDocument();
    layoutGrid();
    act(() => tap(pt('G7', 13)));
    expect(name('G7')).toMatch(/^white stone, G7/);
  });
});
