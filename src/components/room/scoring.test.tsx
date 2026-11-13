/** The room's scoring UI (DESIGN 8.4, 9.3, 9.5): the scoring bar's states and the opponent's toggle flash. */
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useRoom, type RoomScoringView, type RoomToggle, type UseRoomOptions } from '@/hooks/useRoom';
import { dictionaries } from '@/lib/i18n';
import type { RoomControllerOptions } from '@/lib/room';
import type { Game, Scoring } from '@/lib/types';
import zigo, { makeSettings } from '@/lib/zigo';
import { RoomScoringBar, ToggleFlash, roomScoringBar } from './index';
import { createFakeController, renderRoom, type FakeController } from './testUtils';

const view = (patch: Partial<RoomScoringView> = {}): RoomScoringView => ({
  round: 1,
  rev: 1,
  dead: [],
  accepted: [0, 0],
  mine: false,
  theirs: false,
  canMark: true,
  canAccept: true,
  canResume: true,
  paused: false,
  proposing: null,
  ...patch,
});

const toggle = (patch: Partial<RoomToggle> = {}): RoomToggle => ({ points: ['cc'], dead: ['cc'], alive: [], key: 1, ...patch });

/* ---------------------------------------------------------------------------------------------- */
/* roomScoringBar                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

describe('roomScoringBar', () => {
  it.each<[string, Partial<RoomScoringView>, ReturnType<typeof roomScoringBar>]>([
    ['open marking: both buttons work, no note', {}, { accepted: false, disabled: false, resumeDisabled: false, note: null }],
    ['own Accept pressed: pending, waiting for the opponent', { mine: true, canAccept: false }, { accepted: true, disabled: false, resumeDisabled: false, note: 'room.scoring.waiting' }],
    ['the opponent accepted first', { theirs: true }, { accepted: false, disabled: false, resumeDisabled: false, note: 'room.scoring.theyAccepted' }],
    ['both accepted (the end follows)', { mine: true, theirs: true, canAccept: false }, { accepted: true, disabled: false, resumeDisabled: false, note: null }],
    [
      'the opponent away: both locked, scoring continues when they are back',
      { paused: true, canAccept: false, canResume: false },
      { accepted: false, disabled: true, resumeDisabled: true, note: 'game.scoringPaused' },
    ],
    [
      'away after accepting: still shows the acceptance',
      { paused: true, mine: true, canAccept: false, canResume: false },
      { accepted: true, disabled: true, resumeDisabled: true, note: 'game.scoringPaused' },
    ],
    [
      'first proposal under way',
      { rev: 0, canAccept: false, proposing: 'opponent' },
      { accepted: false, disabled: true, resumeDisabled: true, note: 'room.scoring.proposing' },
    ],
    [
      'round 2: counted at once by seat 0',
      { round: 2, rev: 0, canMark: false, canAccept: false, canResume: false, proposing: 'opponent' },
      { accepted: false, disabled: true, resumeDisabled: true, note: 'room.scoring.counting' },
    ],
    ['nothing allowed (locked)', { canAccept: false, canResume: false }, { accepted: false, disabled: true, resumeDisabled: true, note: null }],
  ])('%s', (_name, patch, expected) => {
    expect(roomScoringBar(view(patch))).toEqual(expected);
  });

  it('every note has a string in all four languages', () => {
    const keys = ['room.scoring.waiting', 'room.scoring.theyAccepted', 'room.scoring.proposing', 'room.scoring.counting', 'room.scoring.toggledDead', 'room.scoring.toggledAlive', 'game.scoringPaused'] as const;
    for (const lang of ['en', 'de', 'fr', 'es'] as const) {
      for (const k of keys) expect(dictionaries[lang][k], `${lang} ${k}`).toMatch(/\S/);
    }
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* RoomScoringBar                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

describe('RoomScoringBar', () => {
  it('accepts and resumes; a pressed Accept shows pending and does not send again', async () => {
    const onAccept = vi.fn();
    const onResume = vi.fn();
    const { rerender } = renderRoom(<RoomScoringBar scoring={view()} onAccept={onAccept} onResume={onResume} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledTimes(1);

    rerender(<RoomScoringBar scoring={view({ mine: true, canAccept: false })} onAccept={onAccept} onResume={onResume} />);
    const accepted = screen.getByRole('button', { name: 'Accepted' });
    expect(accepted).toHaveAttribute('aria-pressed', 'true');
    expect(accepted).toBeEnabled(); // pending, not unavailable
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your opponent to accept');
    await userEvent.click(accepted);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  it('while the opponent is away both buttons are locked with the note of DESIGN 9.3', () => {
    renderRoom(<RoomScoringBar scoring={view({ paused: true, canAccept: false, canResume: false })} onAccept={() => {}} onResume={() => {}} />);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Scoring continues when your opponent is back');
  });

  it('shows the proposal under way and the opponent’s acceptance, in German', () => {
    const { rerender } = renderRoom(<RoomScoringBar scoring={view({ rev: 0, canAccept: false, proposing: 'me' })} onAccept={() => {}} onResume={() => {}} />, 'de');
    expect(screen.getByRole('status')).toHaveTextContent('Suche tote Steine …');
    expect(screen.getByRole('button', { name: 'Annehmen' })).toBeDisabled();
    rerender(<RoomScoringBar scoring={view({ theirs: true })} onAccept={() => {}} onResume={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Dein Gegner hat diese Zählung angenommen');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* ToggleFlash                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

describe('ToggleFlash', () => {
  it('rings each changed stone once, in the board viewBox, without catching taps', () => {
    renderRoom(<ToggleFlash size={9} toggle={toggle({ points: ['cc', 'cd'], dead: ['cc', 'cd'] })} />);
    const root = screen.getByTestId('toggle-flash');
    expect(root.className).toContain('pointer-events-none');
    expect(root.className).toContain('absolute');
    const svg = root.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('-0.8 -0.8 9.6 9.6');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const rings = [...root.querySelectorAll('[data-mark="toggle"]')];
    expect(rings.map((r) => r.getAttribute('data-point'))).toEqual(['cc', 'cd']);
    expect(rings[0].getAttribute('cx')).toBe('2');
    expect(rings[0].getAttribute('cy')).toBe('2');
    expect(rings[1].getAttribute('cy')).toBe('3');
    expect(rings[0].getAttribute('class')).toBe('zigo-toggle-flash');
  });

  it('says what the opponent marked, and again for each new change', () => {
    const { rerender } = renderRoom(<ToggleFlash size={9} toggle={toggle()} />);
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('Your opponent marked the group at C7 dead');
    const ring = screen.getByTestId('toggle-flash').querySelector('[data-mark="toggle"]');
    rerender(<ToggleFlash size={9} toggle={toggle({ dead: [], alive: ['cc'], key: 2 })} />);
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('Your opponent marked the group at C7 alive');
    // A new key remounts the ring, so the animation runs again.
    expect(screen.getByTestId('toggle-flash').querySelector('[data-mark="toggle"]')).not.toBe(ring);
    rerender(<ToggleFlash size={9} toggle={toggle({ points: ['cc', 'gg'], dead: ['gg'], alive: ['cc'], key: 3 })} />);
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('Your opponent marked the group at G3 dead. Your opponent marked the group at C7 alive');
    rerender(<ToggleFlash size={9} toggle={null} />);
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('');
    expect(screen.getByTestId('toggle-flash').querySelectorAll('[data-mark="toggle"]')).toHaveLength(0);
  });

  it('speaks French and Spanish', () => {
    const { unmount } = renderRoom(<ToggleFlash size={19} toggle={toggle({ points: ['dd'], dead: ['dd'] })} />, 'fr');
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('Votre adversaire a marqué le groupe en D16 comme mort');
    unmount();
    renderRoom(<ToggleFlash size={13} toggle={toggle({ points: ['dd'], dead: [], alive: ['dd'] })} />, 'es');
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('Tu rival marcó el grupo en D10 como vivo');
  });

  it('ignores points off the board', () => {
    renderRoom(<ToggleFlash size={9} toggle={toggle({ points: ['ss', 'aa'], dead: ['ss', 'aa'] })} />);
    expect([...screen.getByTestId('toggle-flash').querySelectorAll('[data-mark="toggle"]')].map((r) => r.getAttribute('data-point'))).toEqual(['aa']);
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('A9');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Over useRoom                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

function scoringGame(scoring: Partial<Scoring>): Game {
  let g = zigo.newGame(makeSettings(9));
  for (const p of ['cc', 'gg', 'cg', 'gc']) g = zigo.play(g, p, 0);
  g = zigo.pass(zigo.pass(g, 0), 0);
  return zigo.setScoring(g, { ...g.scoring!, ...scoring });
}

function ScoringScreen({ opts }: { opts: UseRoomOptions }) {
  const room = useRoom('K7QW2M', opts);
  return (
    <div className="relative">
      {room.game && <ToggleFlash size={room.game.settings.size} toggle={room.lastToggle} />}
      {room.scoring && <RoomScoringBar scoring={room.scoring} onAccept={room.accept} onResume={room.resume} />}
    </div>
  );
}

describe('room scoring over useRoom', () => {
  it("shows the opponent's toggle, the own pending Accept and the pause, and accepts through the controller", async () => {
    const made: FakeController[] = [];
    const opts: UseRoomOptions = {
      broker: null,
      locks: null,
      turnStorage: null,
      window: null,
      document: null,
      createController: (o: RoomControllerOptions) => {
        const c = createFakeController(o);
        made.push(c);
        return c;
      },
    };
    renderRoom(<ScoringScreen opts={opts} />);
    const c = made[0];
    expect(screen.queryByTestId('scoring-bar')).toBeNull();
    act(() => c.set({ seat: 0, live: true, phase: 'live', presence: 'connected', game: scoringGame({ rev: 1, dead: ['gg'] }), canMark: true, canAccept: true, canResume: true }));
    expect(screen.getByTestId('scoring-bar')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-flash').querySelectorAll('[data-mark="toggle"]')).toHaveLength(0);

    act(() => c.set({ game: scoringGame({ rev: 2, dead: ['cc', 'gg'] }) }));
    expect([...screen.getByTestId('toggle-flash').querySelectorAll('[data-mark="toggle"]')].map((r) => r.getAttribute('data-point'))).toEqual(['cc']);
    expect(screen.getByTestId('toggle-said')).toHaveTextContent('Your opponent marked the group at C7 dead');

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(c.accept).toHaveBeenCalledTimes(1);
    act(() => c.set({ game: scoringGame({ rev: 2, dead: ['cc', 'gg'], accepted: [2, 0] }), canAccept: false }));
    expect(screen.getByRole('button', { name: 'Accepted' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Waiting for your opponent to accept')).toBeInTheDocument();

    act(() => c.set({ live: false, presence: 'reconnecting', canAccept: false, canResume: false }));
    expect(screen.getByText('Scoring continues when your opponent is back')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
  });
});
