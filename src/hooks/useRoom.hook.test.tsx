/** useRoom: the session wired to React (useSyncExternalStore), with a fake controller. */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeController, fakeRoomState, type FakeController } from '@/components/room/testUtils';
import type { RoomControllerOptions } from '@/lib/room';
import type { Game, Point, RoomNotice, Scoring } from '@/lib/types';
import zigo, { makeSettings } from '@/lib/zigo';
import { IDLE_ROOM_VIEW, markingChange, roomScoringOf, roomSettingsOf, useRoom, type ManualApi, type UseRoomOptions } from './useRoom';

/** A 9×9 game in scoring: black cc, cg; white gg, gc; two passes. */
function scoringGame(scoring?: Partial<Scoring>): Game {
  let g = zigo.newGame(makeSettings(9));
  for (const p of ['cc', 'gg', 'cg', 'gc']) g = zigo.play(g, p, 0);
  g = zigo.pass(zigo.pass(g, 0), 0);
  return scoring ? zigo.setScoring(g, { ...g.scoring!, ...scoring }) : g;
}

function setup(extra: Partial<UseRoomOptions> = {}) {
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
    ...extra,
  };
  return { made, opts };
}

describe('useRoom', () => {
  it('runs a session for a valid code and follows the controller snapshot', () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    expect(made).toHaveLength(1);
    expect(made[0].opts.code).toBe('K7QW2M');
    expect(made[0].opts.readOnly).toBe(false);
    expect(result.current.tab).toBe('owner');
    expect(result.current.code).toBe('K7QW2M');
    expect(result.current.state?.presence).toBe('waiting');
    expect(result.current.controller).toBe(made[0]);
    expect(result.current.manualCause).toBe('no-broker');

    act(() => made[0].set({ presence: 'connected', live: true, phase: 'live', seat: 1, score: [3, 1] }));
    expect(result.current.state?.presence).toBe('connected');
    expect(result.current.manualCause).toBeNull();
    expect(result.current.score).toEqual([0.5, 1.5]);
  });

  it('delegates the actions to the current controller', () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const c = made[0];
    expect(result.current.move('dd', 12)).toBe(true);
    expect(c.move).toHaveBeenCalledWith('dd', 12);
    expect(result.current.pass(7)).toBe(true);
    expect(c.pass).toHaveBeenCalledWith(7);
    expect(result.current.mark(['dd'])).toBe(true);
    expect(c.mark).toHaveBeenCalledWith(['dd']);
    expect(result.current.accept()).toBe(true);
    expect(c.accept).toHaveBeenCalled();
    expect(result.current.resume()).toBe(true);
    expect(c.resume).toHaveBeenCalled();
    result.current.ask('takeback');
    expect(c.ask).toHaveBeenCalledWith('takeback');
    result.current.reply('rejoin', false);
    expect(c.reply).toHaveBeenCalledWith('rejoin', false);
    result.current.resign();
    expect(c.resign).toHaveBeenCalled();
    expect(result.current.flag()).toBe(false);
    expect(result.current.elapsed()).toBe(1234);
  });

  it('keeps the actions stable while the view changes, and delivers notices', () => {
    const onNotice = vi.fn();
    const { made, opts } = setup({ onNotice });
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const sub = result.current.onNotice;
    const seen: RoomNotice[] = [];
    const off = result.current.onNotice((n) => seen.push(n));
    act(() => made[0].set({ presence: 'connected' }));
    expect(result.current.onNotice).toBe(sub);
    act(() => made[0].notify('opponent-connected'));
    expect(seen.map((n) => n.kind)).toEqual(['opponent-connected']);
    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'opponent-connected' }));
    off();
  });

  it('disposes the session when the code changes, when disabled and on unmount', () => {
    const { made, opts } = setup();
    const { result, rerender, unmount } = renderHook(({ code, enabled }) => useRoom(code, { ...opts, enabled }), {
      initialProps: { code: 'K7QW2M' as string | null, enabled: true },
    });
    rerender({ code: 'ABC123', enabled: true });
    expect(made[0].leave).toHaveBeenCalled();
    expect(made[1].opts.code).toBe('ABC123');
    expect(result.current.code).toBe('ABC123');

    rerender({ code: 'ABC123', enabled: false });
    expect(made[1].leave).toHaveBeenCalled();
    expect(result.current).toMatchObject({ ...IDLE_ROOM_VIEW, controller: null });
    expect(result.current.move('dd')).toBe(false);
    expect(result.current.pass()).toBe(false);

    rerender({ code: 'not a code!', enabled: true });
    expect(made).toHaveLength(2);
    expect(result.current.state).toBeNull();

    rerender({ code: null, enabled: true });
    expect(result.current.state).toBeNull();

    rerender({ code: 'ZZ9', enabled: true });
    expect(made).toHaveLength(3);
    unmount();
    expect(made[2].leave).toHaveBeenCalled();
  });

  it('passes create to the owner controller only', () => {
    const { made, opts } = setup({ create: { tc: '5+0', color: 'W', size: 13, rules: 'territory', handicap: 2 } });
    renderHook(() => useRoom('K7QW2M', opts));
    expect(made[0].opts.create).toEqual({ tc: '5+0', color: 'W', size: 13, rules: 'territory', handicap: 2 });
  });

  it('follows x and y from the address bar and reports when they were used', async () => {
    const answerOffer = vi.fn(async (code: string, offer: string) => ({
      transport: { role: 'dialer', state: 'connecting', send() {}, onMessage: () => () => {}, onState: () => () => {}, close() {} } as never,
      answer: `A-${offer}`,
      link: `L#/?s=${code}&o=r&y=A-${offer}`,
    }));
    const handOver = vi.fn(async () => true);
    const onSignalUsed = vi.fn();
    const { opts } = setup({ manualApi: { answerOffer, handOver } as Partial<ManualApi>, onSignalUsed });
    const { result, rerender } = renderHook(({ offer }) => useRoom('K7QW2M', { ...opts, offer }), {
      initialProps: { offer: null as string | null },
    });
    expect(answerOffer).not.toHaveBeenCalled();
    await act(async () => rerender({ offer: 'XYZ' }));
    expect(answerOffer).toHaveBeenCalledTimes(1);
    expect(answerOffer).toHaveBeenCalledWith('K7QW2M', 'XYZ');
    expect(onSignalUsed).toHaveBeenCalledTimes(1);
    expect(result.current.manual.step).toBe('answer');
    expect(result.current.manual.link).toContain('y=A-XYZ');
    await act(async () => rerender({ offer: 'XYZ' }));
    expect(answerOffer).toHaveBeenCalledTimes(1);
  });

  it('starts a passive hand-over session for an answer link', async () => {
    const handOver = vi.fn(async () => false);
    const { made, opts } = setup({ manualApi: { handOver } as Partial<ManualApi>, answer: 'Y1' });
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    await act(async () => {});
    expect(result.current.tab).toBe('handover');
    expect(result.current.manual).toMatchObject({ step: 'handover', handedOver: false });
    expect(made.every((c) => c.opts.readOnly)).toBe(true);
    expect(handOver).toHaveBeenCalledTimes(1);
  });

  it('exposes the manual actions', async () => {
    const startHost = vi.fn(async (code: string) => ({
      transport: { role: 'anchor', state: 'connecting', send() {}, onMessage: () => () => {}, onState: () => () => {}, close: vi.fn() } as never,
      offer: 'O',
      link: `L#/?s=${code}&o=r&x=O`,
      acceptAnswer: vi.fn(async () => {}),
    }));
    const { opts } = setup({ manualApi: { startHost } as Partial<ManualApi> });
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    await act(async () => result.current.openManual());
    expect(result.current.manual.step).toBe('offer');
    let issue: unknown = 'unset';
    await act(async () => {
      issue = await result.current.acceptAnswer('y=1');
    });
    expect(issue).toBeNull();
    expect(result.current.manual.step).toBe('connecting');
    await act(async () => result.current.restartManual());
    expect(startHost).toHaveBeenCalledTimes(2);
    act(() => result.current.closeManual());
    expect(result.current.manual.step).toBe('idle');
  });

  it('toggles a group through mark, and offers the scoring actions in useScoring\'s shape', () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const c = made[0];
    // Not scoring: nothing to toggle.
    expect(result.current.toggle('cc')).toBe(false);
    act(() => c.set({ seat: 1, live: true, phase: 'live', game: scoringGame({ rev: 1, dead: ['gg'] }), canMark: true }));
    expect(result.current.toggle('cc')).toBe(true);
    expect(c.mark).toHaveBeenLastCalledWith(['cc', 'gg']);
    expect(result.current.scoringActions.toggle('gg')).toBe(true);
    expect(c.mark).toHaveBeenLastCalledWith([]);
    // An empty point is no group; marking not allowed is refused before the controller.
    expect(result.current.toggle('ee')).toBe(false);
    act(() => c.set({ canMark: false }));
    expect(result.current.toggle('cc')).toBe(false);
    expect(c.mark).toHaveBeenCalledTimes(2);
    // accept ignores a side: a room device accepts for its own seat.
    expect(result.current.scoringActions.accept('W')).toBe(true);
    expect(c.accept).toHaveBeenCalledWith();
    expect(result.current.scoringActions.resume()).toBe(true);
    expect(c.resume).toHaveBeenCalled();
    const actions = result.current.scoringActions;
    act(() => c.set({ live: false }));
    expect(result.current.scoringActions).toBe(actions);
  });

  it('derives the scoring view: own and opponent acceptance, pause, proposing', () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const c = made[0];
    expect(result.current.scoring).toBeNull();
    act(() => c.set({ seat: 1, live: true, phase: 'live', game: scoringGame(), proposing: 0 }));
    expect(result.current.scoring).toMatchObject({ round: 1, rev: 0, mine: false, theirs: false, proposing: 'opponent', paused: false });
    act(() => c.set({ game: scoringGame({ rev: 3, dead: ['gg'], accepted: [3, 2] }), proposing: null, canAccept: true, canResume: true, canMark: true }));
    expect(result.current.scoring).toMatchObject({ rev: 3, dead: ['gg'], accepted: [3, 2], mine: false, theirs: true, proposing: null, canAccept: true });
    const before = result.current.scoring;
    act(() => c.set({ presence: 'connected' }));
    expect(result.current.scoring).toBe(before); // unchanged: same object
    act(() => c.set({ live: false, canAccept: false, canResume: false }));
    expect(result.current.scoring).toMatchObject({ paused: true, canAccept: false });
    act(() => c.set({ seat: 0, proposing: 0 }));
    expect(result.current.scoring).toMatchObject({ mine: true, theirs: false, proposing: 'me' });
    // Over: no scoring view, no toggle.
    const g = scoringGame({ rev: 3, dead: ['gg'], accepted: [3, 3] });
    act(() => c.set({ game: zigo.end(g, { winner: 'B', by: 'score', margin: 9 }) }));
    expect(result.current.scoring).toBeNull();
    expect(result.current.lastToggle).toBeNull();
  });

  it("reports the opponent's change of the marking, never this device's own", () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const c = made[0];
    act(() => c.set({ seat: 0, live: true, phase: 'live', game: scoringGame({ rev: 1, dead: ['gg'] }), canMark: true }));
    expect(result.current.lastToggle).toBeNull();
    act(() => c.set({ game: scoringGame({ rev: 2, dead: ['cc', 'gg'] }) }));
    expect(result.current.lastToggle).toMatchObject({ points: ['cc'], dead: ['cc'], alive: [] });
    const first = result.current.lastToggle!;
    // Acceptances alone change nothing on the board.
    act(() => c.set({ game: scoringGame({ rev: 2, dead: ['cc', 'gg'], accepted: [0, 2] }) }));
    expect(result.current.lastToggle).toBe(first);
    // Own toggle: the controller updates its snapshot inside mark(); no new toggle.
    c.mark.mockImplementation((dead: readonly Point[]) => {
      c.set({ game: scoringGame({ rev: 3, dead: [...dead] }) });
      return true;
    });
    act(() => void result.current.toggle('gc'));
    expect(result.current.state?.game.scoring?.dead).toEqual(['cc', 'gc', 'gg']);
    expect(result.current.lastToggle).toBe(first);
    // The opponent's next toggle: a new key.
    act(() => c.set({ game: scoringGame({ rev: 4, dead: ['gc', 'gg'] }) }));
    expect(result.current.lastToggle).toMatchObject({ points: ['cc'], dead: [], alive: ['cc'] });
    expect(result.current.lastToggle!.key).toBeGreaterThan(first.key);
    // A resume (no scoring) clears it.
    const resumed = zigo.resume(scoringGame({ rev: 4, dead: ['gc', 'gg'] }));
    act(() => c.set({ game: resumed }));
    expect(result.current.lastToggle).toBeNull();
    // Round 2 has no marking round: a change of its dead stones is no toggle.
    let r2 = zigo.pass(zigo.pass(zigo.play(resumed, 'ee', 0), 0), 0);
    expect(r2.scoring?.round).toBe(2);
    act(() => c.set({ game: r2 }));
    r2 = zigo.setScoring(r2, { ...r2.scoring!, rev: 1, dead: ['gg'] });
    act(() => c.set({ game: r2 }));
    expect(result.current.lastToggle).toBeNull();
  });

  it('exposes the settings of the current game once seated', () => {
    const { made, opts } = setup();
    const { result } = renderHook(() => useRoom('K7QW2M', opts));
    const c = made[0];
    act(() => c.set({ seat: null }));
    expect(result.current.settings).toBeNull();
    const g = zigo.newGame(makeSettings(19, 'territory', 4));
    act(() => c.set({ seat: 1, color: 'B', game: g, tc: { kind: 'fischer', baseMs: 300_000, incMs: 7000 } }));
    expect(result.current.settings).toEqual({
      size: 19,
      rules: 'territory',
      handicap: 4,
      clock: { kind: 'fischer', baseMs: 300_000, incMs: 7000 },
      color: 'B',
      seat: 1,
      joiner: true,
    });
    expect(result.current.game).toBe(g);
  });

  it('passes propose to the controller', () => {
    const propose = vi.fn(() => null);
    const { made, opts } = setup({ propose });
    renderHook(() => useRoom('K7QW2M', opts));
    expect(made[0].opts.propose).toBe(propose);
    expect(propose).not.toHaveBeenCalled();
  });
});

describe('useRoom view helpers', () => {
  it('markingChange lists what turned dead and what turned alive', () => {
    expect(markingChange(['aa', 'bb'], ['aa', 'bb'])).toBeNull();
    expect(markingChange([], ['cc', 'cd'])).toEqual({ points: ['cc', 'cd'], dead: ['cc', 'cd'], alive: [] });
    expect(markingChange(['gg', 'cc'], ['dd', 'gg'])).toEqual({ points: ['cc', 'dd'], dead: ['dd'], alive: ['cc'] });
  });

  it('roomSettingsOf and roomScoringOf keep the previous object while nothing changed', () => {
    expect(roomSettingsOf(null)).toBeNull();
    expect(roomScoringOf(null)).toBeNull();
    const state = fakeRoomState({ seat: 0, live: true, game: scoringGame({ rev: 2, dead: ['gg'], accepted: [2, 0] }), tc: { kind: 'byoyomi', baseMs: 600_000, periods: 5, periodMs: 30_000 } });
    const settings = roomSettingsOf(state);
    const scoring = roomScoringOf(state);
    expect(scoring).toMatchObject({ mine: true, theirs: false });
    expect(Object.isFrozen(scoring)).toBe(true);
    // A new snapshot with equal content (a copy of the game, a copy of the clock) keeps both objects.
    const copy = fakeRoomState({ ...state, game: scoringGame({ rev: 2, dead: ['gg'], accepted: [2, 0] }), tc: { kind: 'byoyomi', baseMs: 600_000, periods: 5, periodMs: 30_000 } });
    expect(roomSettingsOf(copy, settings)).toBe(settings);
    expect(roomScoringOf(copy, scoring)).toBe(scoring);
    expect(roomScoringOf(fakeRoomState({ ...state, live: false }), scoring)).not.toBe(scoring);
    expect(roomSettingsOf(fakeRoomState({ ...state, tc: null }), settings)?.clock).toBeNull();
    // No seat yet (a joiner before welcome): neither view.
    expect(roomSettingsOf(fakeRoomState({ ...state, seat: null }))).toBeNull();
    expect(roomScoringOf(fakeRoomState({ ...state, seat: null }))).toBeNull();
  });
});

