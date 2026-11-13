/**
 * The stage in room mode (Integrator 3): Start with ROOM creates the room of the shown code, an
 * invite link joins it, and the room chrome follows the controller (DESIGN 4.2, 8.4, 8.5, 9). The
 * opponent is a second device: a real room controller with its own store, joined to the stage's
 * room through the memory network (PLAN 7: room logic is tested over the memory transport, never
 * PeerJS). The app's PeerJS factory is replaced by that memory network.
 *
 * The determinism rule (PLAN 7) is covered from the stage's side: as seat 1 its own engine would
 * mark other stones dead, and it is never asked; the count shown is seat 0's proposal, as data.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cell, installPointerEvent, layoutGrid, tap } from '@/components/board/test-helpers';
import { setSharedEngine } from '@/hooks/useZigoEngine';
import { FakeEngine, type FakeEngineOptions } from '@/lib/engine/fake';
import { I18nProvider } from '@/lib/i18n';
import { createRoomController, type RoomControllerApi, type RoomControllerOptions } from '@/lib/room';
import { createStore, memoryStorage } from '@/lib/storage';
import type { MemoryNetwork } from '@/lib/transport';
import type { Point, Size } from '@/lib/types';
import { fromGtp } from '@/lib/zigo';
import Index from './Index';

const broker = vi.hoisted(() => ({ net: null as MemoryNetwork | null, fail: false }));

vi.mock('@/lib/transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/transport')>();
  return {
    ...real,
    // The app's broker is the memory network of the test (or a broker that cannot be reached).
    createPeerJsFactory: () => (code: string) =>
      broker.fail ? Promise.reject(new Error('broker unreachable')) : broker.net!.factory(code),
  };
});

const { createMemoryNetwork } = await import('@/lib/transport');

function renderStage(path: string) {
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
const toolbar = () => screen.getByRole('toolbar');
const pt = (s: string, size: Size = 9): Point => fromGtp(s, size) as Point;
const cellName = (s: string, size: Size = 9) => cell(pt(s, size)).getAttribute('aria-label');

/** Places a stone (or, in scoring, toggles a group) with the mouse. */
function place(s: string, size: Size = 9) {
  layoutGrid();
  act(() => tap(pt(s, size)));
}

/** The other device: a room controller with its own storage, over the test's memory network. */
function opponent(code: string, extra: Partial<RoomControllerOptions> = {}): RoomControllerApi {
  const c = createRoomController({ code, store: createStore(memoryStorage()), factory: broker.net!.factory, ...extra });
  others.push(c);
  return c;
}

/** The whole board is Black's in the engine's eyes: every white stone is proposed dead. */
const fill = (size: number, v: number) => new Float32Array(size * size).fill(v);
function blackOwnsAll(): FakeEngineOptions {
  return { evals: (pos, opts) => (opts.visits === 100 ? { winrate: 0.99, scoreLead: 70, ownership: fill(pos.size, 1) } : undefined) };
}

let others: RoomControllerApi[] = [];
let engine: FakeEngine;

beforeAll(() => {
  installPointerEvent();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('zigo:tutorial-seen', 'true');
  localStorage.setItem('zigo:opponent', JSON.stringify({ mode: 'room' }));
  localStorage.setItem('zigo:color', JSON.stringify('B'));
  broker.net = createMemoryNetwork();
  broker.fail = false;
  others = [];
  engine = new FakeEngine(blackOwnsAll());
  setSharedEngine(engine);
});

afterEach(() => {
  for (const o of others) o.leave();
  setSharedEngine(null);
});

/** Starts the room of `code` from the start screen and waits until `other` has joined it. */
async function createAndJoin(code: string, extra: Partial<RoomControllerOptions> = {}): Promise<RoomControllerApi> {
  renderStage(`/?s=${code}`);
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  expect(stage()).toHaveAttribute('data-phase', 'playing');
  await screen.findByTestId('invite-sheet');
  const other = opponent(code, extra);
  await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
  await waitFor(() => expect(screen.queryByTestId('invite-sheet')).toBeNull());
  return other;
}

/** Both pass (this device first, as Black to move); the stage enters scoring. */
async function bothPass(other: RoomControllerApi) {
  fireEvent.click(within(toolbar()).getByRole('button', { name: /^Pass/ }));
  await waitFor(() => expect(other.snapshot.game.plies.length).toBeGreaterThan(0));
  await waitFor(() => expect(other.snapshot.myTurn).toBe(true));
  act(() => {
    expect(other.pass()).toBe(true);
  });
  await waitFor(() => expect(stage()).toHaveAttribute('data-phase', 'scoring'));
}

const scoringBar = () => screen.getByRole('group', { name: 'Scoring' });

describe('Index stage in a room', () => {
  it('creates the room, plays, takes back, scores with a toggled group, and asks for a rematch from the overlay', async () => {
    renderStage('/?s=RMG001');
    expect(stage()).toHaveAttribute('data-phase', 'start');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(screen.queryByText('Coming soon')).toBeNull();

    // The creator's room is open: the invite sheet shows by itself (DESIGN 9).
    const invite = await screen.findByTestId('invite-sheet');
    expect(within(invite).getByText('RMG001')).toBeInTheDocument();
    expect((within(invite).getByRole('textbox', { name: 'Invite link' }) as HTMLInputElement).value).toMatch(/#\/\?s=RMG001&o=r$/);
    expect(localStorage.getItem('zigo:rooms')).toContain('RMG001');

    // The opponent joins: presence turns connected, the sheet closes, a toast says so.
    const other = opponent('RMG001');
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    await waitFor(() => expect(screen.queryByTestId('invite-sheet')).toBeNull());
    expect(await screen.findByText('Opponent joined')).toBeInTheDocument();
    expect(other.snapshot.color).toBe('W');

    // The room column of the toolbar (DESIGN 4.2): takeback request, no redo, no hint, no seating.
    const bar = toolbar();
    expect(bar).toHaveAttribute('data-mode', 'room');
    expect(within(bar).getByRole('button', { name: 'Ask for a takeback' })).toBeDisabled();
    expect(within(bar).queryByRole('button', { name: /redo/i })).toBeNull();
    expect(within(bar).queryByRole('button', { name: /hint/i })).toBeNull();
    expect(bar.querySelector('[data-slot="seating"]')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Share invite link' })).toBeInTheDocument();
    // Info pill: presence dot and the room score.
    expect(screen.getByRole('button', { name: 'Opponent connected. Show invite' })).toBeInTheDocument();
    expect(screen.getByText('0 – 0')).toBeInTheDocument();

    // A stone on the board goes to the room; the opponent's reply arrives.
    place('E5');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(1));
    act(() => {
      expect(other.move(pt('C3'))).toBe(true);
    });
    await waitFor(() => expect(cellName('C3')).toMatch(/^white stone/));
    // Room addresses never carry moves (DESIGN 13.2).
    expect(window.location.hash).not.toMatch(/m=/);

    // Undo asks for a takeback; the button shows the pending state until the answer.
    place('D4');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(3));
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Ask for a takeback' }));
    await waitFor(() => expect(other.snapshot.requests.incoming).toBe('takeback'));
    expect(within(toolbar()).getByRole('button', { name: 'Takeback requested' })).toBeDisabled();
    act(() => {
      expect(other.reply('takeback', true)).toBe(true);
    });
    await waitFor(() => expect(cellName('D4')).toMatch(/^empty/));
    expect(cellName('E5')).toMatch(/^black stone/);

    // Both pass: scoring, with seat 0's (this device's) engine proposal on both boards (DESIGN 9.5).
    await bothPass(other);
    await waitFor(() => expect(cellName('C3')).toMatch(/dead/));
    await waitFor(() => expect(other.snapshot.game.scoring?.dead).toEqual([pt('C3')]));
    expect(other.snapshot.game.scoring?.rev).toBe(1);

    // The opponent marks the group alive: it shows here at once and flashes once (DESIGN 9.5).
    act(() => {
      expect(other.mark([])).toBe(true);
    });
    await waitFor(() => expect(cellName('C3')).not.toMatch(/dead/));
    const flash = screen.getByTestId('toggle-flash');
    expect(flash.querySelector(`[data-point="${pt('C3')}"]`)).not.toBeNull();
    expect(within(flash).getByTestId('toggle-said')).toHaveTextContent('Your opponent marked the group at C3 alive');

    // This device marks it dead again; Accept shows the pending state until the opponent accepts.
    place('C3');
    await waitFor(() => expect(other.snapshot.game.scoring?.dead).toEqual([pt('C3')]));
    fireEvent.click(within(scoringBar()).getByRole('button', { name: /^Accept/ }));
    await waitFor(() => expect(screen.getByText('Waiting for your opponent to accept')).toBeInTheDocument());
    expect(within(scoringBar()).getByRole('button', { name: /^Accepted/ })).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      expect(other.accept()).toBe(true);
    });

    // Both accepted the same rev: both devices count the same result (DESIGN 9.5).
    const over = await screen.findByRole('dialog', { name: 'You won by 73.5!' }, { timeout: 4000 });
    expect(over).toHaveTextContent('B 81 · W 0 + 7.5');
    await waitFor(() => expect(other.snapshot.game.end?.result).toEqual({ winner: 'B', by: 'score', margin: 147 }));

    // Rematch from the overlay: pending until the opponent says yes (DESIGN 8.5, 9.4).
    fireEvent.click(within(over).getByRole('button', { name: 'Rematch' }));
    await waitFor(() => expect(other.snapshot.requests.incoming).toBe('rematch'));
    await waitFor(() => expect(within(over).getByRole('button', { name: 'Rematch' })).toBeDisabled());
    expect(within(over).getByRole('status')).toHaveTextContent('Waiting for your opponent');
    act(() => {
      expect(other.reply('rematch', true)).toBe(true);
    });
    // Game 2: colors swapped, the score from this device's side.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /You won/ })).toBeNull());
    await waitFor(() => expect(other.snapshot.color).toBe('B'));
    expect(other.snapshot.n).toBe(2);
    expect(screen.getByText('1 – 0')).toBeInTheDocument();
    act(() => {
      expect(other.move(pt('D4'))).toBe(true);
    });
    await waitFor(() => expect(cellName('D4')).toMatch(/^black stone/));

    // Share opens the invite sheet.
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Share invite link' }));
    expect(await screen.findByTestId('invite-sheet')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('invite-sheet')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('invite-sheet')).toBeNull());

    // Back leaves the room; the history lists both games with the game number and the score.
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(stage()).toHaveAttribute('data-phase', 'start');
    await waitFor(() => expect(other.snapshot.presence).not.toBe('connected'));
    const cards = await screen.findAllByTestId('history-card');
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringMatching(/^RMG001.*Game 2.*1 – 0/),
      expect.stringMatching(/^RMG001.*Game 1.*1 – 0/),
    ]);
    // The room's settings apply: the pills show them dimmed; the opponent stays free (DESIGN 4.1, 9.1).
    expect(screen.getByRole('button', { name: /^Board of this game: 9×9/ })).toBeDisabled();

    // Resuming the current game reconnects to the room.
    fireEvent.click(cards[0]);
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    expect(cellName('D4')).toMatch(/^black stone/);
  }, 20_000);

  it('an invite link joins at once with the creator’s settings; seat 1’s own engine is never asked for the count', async () => {
    // The host (seat 0) creates a 13×13 territory room and plays Black; its engine sees nothing dead.
    const hostPropose = vi.fn(() => [] as Point[]);
    const host = createRoomController({
      code: 'RMG002',
      store: createStore(memoryStorage()),
      factory: broker.net!.factory,
      create: { tc: null, color: 'B', size: 13, rules: 'territory', handicap: 0 },
      propose: hostPropose,
    });
    others.push(host);
    // This device's engine would mark every white stone dead (it disagrees with the host's).
    localStorage.setItem('zigo:opponent', JSON.stringify({ mode: 'local' }));
    renderStage('/?s=RMG002&o=r');
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    expect(screen.queryByTestId('invite-sheet')).toBeNull();
    await waitFor(() => expect(stage()).toHaveAttribute('data-size', '13'));
    expect(stage()).toHaveAttribute('data-room-seat', '1');
    expect(screen.getAllByRole('gridcell')).toHaveLength(169);

    act(() => {
      expect(host.move(pt('D4', 13))).toBe(true);
    });
    await waitFor(() => expect(cellName('D4', 13)).toMatch(/^black stone/));
    place('K10', 13);
    await waitFor(() => expect(host.snapshot.game.cursor).toBe(2));
    act(() => {
      expect(host.pass()).toBe(true);
    });
    await waitFor(() => expect(within(toolbar()).getByRole('button', { name: /^Pass and end the game/ })).toBeEnabled());
    fireEvent.click(within(toolbar()).getByRole('button', { name: /^Pass and end the game/ }));
    await waitFor(() => expect(stage()).toHaveAttribute('data-phase', 'scoring'));

    // The count is the host's proposal, sent as data: nothing dead here, although this device's
    // engine would have marked K10 dead (PLAN 7).
    await waitFor(() => expect(host.snapshot.game.scoring?.rev).toBe(1));
    await waitFor(() => expect(within(scoringBar()).getByRole('button', { name: /^Accept/ })).toBeEnabled());
    expect(cellName('K10', 13)).not.toMatch(/dead/);
    expect(hostPropose).toHaveBeenCalledTimes(1);
    expect(engine.calls.filter((c) => c.method === 'evaluate')).toHaveLength(0);

    // The opponent goes away: scoring waits for them (DESIGN 9.3).
    act(() => host.leave());
    expect(await screen.findByText('Scoring continues when your opponent is back', {}, { timeout: 20_000 })).toBeInTheDocument();
    expect(within(scoringBar()).getByRole('button', { name: /^Accept/ })).toBeDisabled();

    // Back: with ROOM selected the start screen shows the room's settings, dimmed (DESIGN 4.1, 9.1).
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(stage()).toHaveAttribute('data-phase', 'start');
    const size = screen.getByRole('button', { name: /^Board of this game: 13×13, territory/ });
    expect(size).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next opponent' })).toBeEnabled();
  }, 30_000);

  it('a host without an engine hands the first proposal to this device (seat 1), whose engine proposes (DESIGN 9.5)', async () => {
    const host = createRoomController({
      code: 'RMG007',
      store: createStore(memoryStorage()),
      factory: broker.net!.factory,
      create: { tc: null, color: 'W' },
    });
    others.push(host);
    renderStage('/?s=RMG007&o=r');
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    // This device plays Black.
    place('E5');
    await waitFor(() => expect(host.snapshot.game.cursor).toBe(1));
    act(() => void host.move(pt('C3')));
    await waitFor(() => expect(cellName('C3')).toMatch(/^white stone/));
    await bothPass(host);
    // The proposal came from this device's engine and reached the host as data (rev 1).
    await waitFor(() => expect(host.snapshot.game.scoring?.dead).toEqual([pt('C3')]));
    expect(host.snapshot.game.scoring?.rev).toBe(1);
    expect(cellName('C3')).toMatch(/dead/);
    expect(engine.calls.some((c) => c.method === 'evaluate')).toBe(true);
  }, 20_000);

  it('Resume plays on; the next double pass is scored at once from seat 0’s proposal (DESIGN 8.4, 9.5)', async () => {
    const other = await createAndJoin('RMG003');
    place('E5');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(1));
    act(() => void other.move(pt('C3')));
    await waitFor(() => expect(cellName('C3')).toMatch(/^white stone/));
    await bothPass(other);
    await waitFor(() => expect(other.snapshot.game.scoring?.rev).toBe(1));

    // The opponent resumes: play continues with the player to move (this device, Black).
    act(() => {
      expect(other.resume()).toBe(true);
    });
    await waitFor(() => expect(stage()).toHaveAttribute('data-phase', 'playing'));
    place('G7');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(5));
    act(() => void other.pass());
    await waitFor(() => expect(within(toolbar()).getByRole('button', { name: /^Pass and end the game/ })).toBeEnabled());
    fireEvent.click(within(toolbar()).getByRole('button', { name: /^Pass and end the game/ }));

    // Round 2 ends at once from this device's (seat 0's) engine: C3 dead, Black wins on both devices.
    const over = await screen.findByRole('dialog', { name: 'You won by 73.5!' }, { timeout: 4000 });
    expect(over).toBeInTheDocument();
    await waitFor(() => expect(other.snapshot.game.end?.result).toEqual({ winner: 'B', by: 'score', margin: 147 }));
    expect(other.snapshot.game.scoring?.dead).toEqual([pt('C3')]);
  }, 20_000);

  it('offers Connect manually when the broker cannot be reached (DESIGN 9)', async () => {
    broker.fail = true;
    renderStage('/?s=RMG004');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const invite = await screen.findByTestId('invite-sheet');
    expect(await within(invite).findByText('Could not reach the connection service.')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getAllByText('Could not reach the connection service.')).toHaveLength(1);
    fireEvent.click(within(invite).getByRole('button', { name: 'Connect manually' }));
    // jsdom has no WebRTC: the manual sheet says so calmly and offers to start over.
    const sheet = await screen.findByTestId('manual-sheet');
    expect(await within(sheet).findByText('This browser cannot open a direct connection.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Start over' })).toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-room-cause', 'broker-unreachable');
  });

  it('a finished older room game opens in review; deleting a room game removes the room record with undo', async () => {
    const other = await createAndJoin('RMG005');
    act(() => {
      expect(other.resign()).toBe(true);
    });
    const over = await screen.findByRole('dialog', { name: 'You won by resignation!' }, { timeout: 4000 });
    fireEvent.click(within(over).getByRole('button', { name: 'Rematch' }));
    await waitFor(() => expect(other.snapshot.requests.incoming).toBe('rematch'));
    act(() => void other.reply('rematch', true));
    await waitFor(() => expect(other.snapshot.n).toBe(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /You won/ })).toBeNull());

    // Dismissed overlay of a finished room game: the toolbar's flag slot brings it back.
    act(() => void other.resign());
    let again = await screen.findByRole('dialog', { name: 'You won by resignation!' }, { timeout: 4000 });
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /You won/ })).toBeNull());
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Rematch' }));
    again = await screen.findByRole('dialog', { name: 'You won by resignation!' }, { timeout: 4000 });
    expect(screen.getByText('2 – 0')).toBeInTheDocument();
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /You won/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));

    const cards = await screen.findAllByTestId('history-card');
    expect(cards).toHaveLength(2);
    // Game 1 (finished, not the current game) opens read-only in review, without connecting.
    fireEvent.click(cards[1]);
    expect(stage()).toHaveAttribute('data-phase', 'review');
    expect(stage()).not.toHaveAttribute('data-room-phase');
    expect(screen.getByText('2 – 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));

    // Delete game 2: the room record goes too; Undo brings both back.
    const card = (await screen.findAllByTestId('history-card'))[0];
    fireEvent.click(within(card.parentElement!).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(localStorage.getItem('zigo:rooms')).toBe('[]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(localStorage.getItem('zigo:rooms')).toContain('RMG005'));
    expect(await screen.findAllByTestId('history-card')).toHaveLength(2);
  }, 20_000);

  it('a timed room: the controller clock runs the strips, and a disconnect pauses both (DESIGN 9.7)', async () => {
    localStorage.setItem('zigo:clock', JSON.stringify({ 9: '2+7' }));
    const other = await createAndJoin('RMG006');
    const timer = (c: 'B' | 'W') => document.querySelector(`[data-color="${c}"] [role="timer"]`)!;
    expect(timer('B').textContent).toBe('2:00');

    // Each side's first move is untimed; from Black's second move on, Black's clock runs.
    place('E5');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(1));
    act(() => void other.move(pt('C3'), 1200));
    await waitFor(() => expect(cellName('C3')).toMatch(/^white stone/));
    await waitFor(() => expect(timer('B')).toHaveAttribute('data-running', 'true'));

    // The opponent goes away: both clocks pause, the strips say so, the board locks.
    act(() => other.leave());
    await waitFor(() => expect(stage()).not.toHaveAttribute('data-room-presence', 'connected'), { timeout: 20_000 });
    await waitFor(() => expect(screen.getAllByText('Paused')).toHaveLength(2));
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
    expect(timer('B')).not.toHaveAttribute('data-running');
  }, 30_000);
});
