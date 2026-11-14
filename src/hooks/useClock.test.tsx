import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerStrip } from '@/components/game/PlayerStrip';
import { I18nProvider } from '@/lib/i18n';
import type { Game, TcString, TimeControl } from '@/lib/types';
import zengo, { makeSettings } from '@/lib/zengo';
import { useClock, type UseClockOptions } from './useClock';

const S9 = makeSettings(9);

/** Plays SGF points (`tt` = pass) with the given ms each. Black moves first. */
function playAll(moves: [string, number][], g: Game = zengo.newGame(S9)): Game {
  return moves.reduce((acc, [m, ms]) => zengo.play(acc, m, ms), g);
}

/** Both sides have moved once, so Black's clock runs: E5, C7, Black to move. */
const opened = playAll([
  ['ee', 0],
  ['cc', 0],
]);
const ONE_MIN = '1+0';

let clock = 0;
const now = () => clock;
let visibility: DocumentVisibilityState = 'visible';

function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Moves the injected clock and lets the display tick run. */
function advance(ms: number) {
  act(() => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
});

interface Props {
  game: Game | null;
  tc: TimeControl | TcString | null;
  opts?: UseClockOptions;
}

function mount(game: Game | null, tc: TimeControl | TcString | null, opts: UseClockOptions = {}) {
  return renderHook((p: Props) => useClock(p.game, p.tc, { now, ...p.opts }), {
    initialProps: { game, tc, opts },
  });
}

describe('useClock', () => {
  it('counts the side to move down from performance stamps and shows it on the tick', () => {
    const { result } = mount(opened, ONE_MIN);
    expect(result.current.ticking).toBe(true);
    expect(result.current.B).toMatchObject({ text: '1:00', running: true });
    advance(1500);
    expect(result.current.elapsed()).toBe(1500);
    expect(result.current.B).toMatchObject({ text: '0:58', running: true });
    expect(result.current.W).toMatchObject({ text: '1:00', running: false });
  });

  it('derives from stamps, not ticks: a throttled tick loses nothing', () => {
    const { result } = mount(opened, ONE_MIN);
    // 30 s pass but only one tick runs (a throttled background timer).
    act(() => {
      clock += 30_000;
      vi.advanceTimersByTime(100);
    });
    expect(result.current.turnMs).toBe(30_000);
    expect(result.current.B.text).toBe('0:30');
  });

  it('pauses while the tab is hidden and resumes on return (solo)', () => {
    const { result } = mount(opened, ONE_MIN);
    advance(2000);
    setVisibility('hidden');
    expect(result.current.ticking).toBe(false);
    advance(60_000);
    expect(result.current.elapsed()).toBe(2000);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('visible');
    expect(result.current.ticking).toBe(true);
    advance(1000);
    expect(result.current.elapsed()).toBe(3000);
    expect(result.current.B.text).toBe('0:57');
  });

  it('keeps running while hidden when pauseWhenHidden is false', () => {
    const { result } = mount(opened, ONE_MIN, { pauseWhenHidden: false });
    setVisibility('hidden');
    advance(5000);
    expect(result.current.elapsed()).toBe(5000);
  });

  it('pauses on `paused` (Back / leave) and when inactive, keeping the time spent', () => {
    const { result, rerender } = mount(opened, ONE_MIN);
    advance(4000);
    rerender({ game: opened, tc: ONE_MIN, opts: { paused: true } });
    expect(result.current.ticking).toBe(false);
    expect(result.current.B).toMatchObject({ text: '0:56', running: false });
    advance(20_000);
    rerender({ game: opened, tc: ONE_MIN, opts: { active: false } });
    advance(20_000);
    expect(result.current.elapsed()).toBe(4000);
    rerender({ game: opened, tc: ONE_MIN, opts: {} });
    advance(1000);
    expect(result.current.elapsed()).toBe(5000);
  });

  it('a move starts a new turn; elapsed() is the ms of the move being made', () => {
    const { result, rerender } = mount(opened, ONE_MIN);
    advance(7000);
    const ms = result.current.elapsed();
    expect(ms).toBe(7000);
    const next = zengo.play(opened, 'gg', ms);
    rerender({ game: next, tc: ONE_MIN, opts: {} });
    expect(result.current.elapsed()).toBe(0);
    expect(result.current.B).toMatchObject({ text: '0:53', running: false });
    expect(result.current.W).toMatchObject({ text: '1:00', running: true });
    advance(2000);
    expect(result.current.W.text).toBe('0:58');
  });

  it('applies the Fischer increment after each counted move', () => {
    const tc: TcString = '1+5';
    const g = playAll([['gg', 3000]], opened);
    const { result } = mount(g, tc);
    // Black: 60 - 3 + 5 = 62 s.
    expect(result.current.B.text).toBe('1:02');
  });

  it('undo and redo restore the clocks from the log', () => {
    const g = playAll(
      [
        ['gg', 12_000],
        ['cg', 8_000],
      ],
      opened,
    );
    const { result, rerender } = mount(g, ONE_MIN);
    expect(result.current.B.text).toBe('0:48');
    expect(result.current.W.text).toBe('0:52');
    advance(3000);
    const back = zengo.undo(g, 2);
    rerender({ game: back, tc: ONE_MIN, opts: {} });
    expect(result.current.B.text).toBe('1:00');
    expect(result.current.W.text).toBe('1:00');
    expect(result.current.elapsed()).toBe(0);
    rerender({ game: zengo.redo(back, 2), tc: ONE_MIN, opts: {} });
    expect(result.current.B.text).toBe('0:48');
    expect(result.current.W.text).toBe('0:52');
  });

  it('fires onFlag once when the side to move runs out', () => {
    const onFlag = vi.fn();
    const g = playAll([['gg', 55_000], ['cg', 0]], opened);
    const { result } = mount(g, ONE_MIN, { onFlag });
    advance(4900);
    expect(result.current.B.text).toBe('0.1');
    expect(result.current.B.low).toBe(true);
    expect(onFlag).not.toHaveBeenCalled();
    advance(200);
    expect(onFlag).toHaveBeenCalledTimes(1);
    expect(onFlag).toHaveBeenCalledWith('B');
    expect(result.current.B).toMatchObject({ text: '0.0', flagged: true });
    advance(1000);
    expect(onFlag).toHaveBeenCalledTimes(1);
  });

  it('does not flag while paused or before the side has moved', () => {
    const onFlag = vi.fn();
    const { rerender } = mount(zengo.newGame(S9), ONE_MIN, { onFlag });
    advance(120_000);
    expect(onFlag).not.toHaveBeenCalled();
    rerender({ game: opened, tc: ONE_MIN, opts: { onFlag, paused: true } });
    advance(120_000);
    expect(onFlag).not.toHaveBeenCalled();
  });

  it('a game lost on time shows 0.0 and stops', () => {
    const lost = zengo.end(opened, { winner: 'W', by: 'time' });
    const { result } = mount(lost, ONE_MIN);
    expect(result.current.ticking).toBe(false);
    expect(result.current.B).toMatchObject({ text: '0.0', flagged: true });
    expect(result.current.flagged).toBe('B');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clock off: time used per side, dimmed, still measured', () => {
    const g = playAll([['gg', 4000]], opened);
    const { result } = mount(g, null);
    expect(result.current.timed).toBe(false);
    advance(2000);
    expect(result.current.W).toMatchObject({ text: '0:02', untimed: true, running: false });
    expect(result.current.B).toMatchObject({ text: '0:04', untimed: true });
    expect(result.current.elapsed()).toBe(2000);
  });

  it('a new session key starts a fresh turn; initialTurnMs restores one', () => {
    const { result, rerender } = mount(opened, ONE_MIN, { key: 'A', initialTurnMs: 9000 });
    expect(result.current.elapsed()).toBe(9000);
    expect(result.current.B.text).toBe('0:51');
    rerender({ game: opened, tc: ONE_MIN, opts: { key: 'B' } });
    expect(result.current.elapsed()).toBe(0);
  });

  it('without a game it shows the base time and does not tick', () => {
    const { result } = mount(null, '3+2');
    expect(result.current.B).toMatchObject({ text: '3:00', untimed: false });
    expect(result.current.ticking).toBe(false);
    expect(result.current.elapsed()).toBe(0);
  });

  it('byo-yomi: counts main time, then the period with the periods left, and flags after the last', () => {
    const onFlag = vi.fn();
    const { result } = mount(opened, '0.5m3x10', { onFlag });
    expect(result.current.B).toMatchObject({ text: '0:30', periods: 3, overtime: false });
    advance(36_000);
    expect(result.current.B).toMatchObject({ text: '4.0 ·3', low: true, overtime: true, running: true });
    advance(10_000);
    expect(result.current.B.text).toBe('4.0 ·2');
    expect(onFlag).not.toHaveBeenCalled();
    advance(14_000);
    expect(onFlag).toHaveBeenCalledWith('B');
    expect(result.current.B).toMatchObject({ text: '0.0', flagged: true });
  });

  it('a move inside a period keeps it', () => {
    const g = playAll([['gg', 35_000], ['cg', 0]], opened);
    const { result } = mount(g, '0.5m3x10');
    expect(result.current.B).toMatchObject({ text: '0:10 ·3', overtime: true });
  });

  it('byo-yomi 1m 3×10s: main time runs out, a move inside a period keeps it, the last period loses', () => {
    const onFlag = vi.fn();
    const { result, rerender } = mount(opened, '1m3x10', { onFlag });
    advance(59_000);
    expect(result.current.B).toMatchObject({ text: '1.0', low: true, overtime: false, periods: 3 });
    advance(1_000);
    expect(result.current.B).toMatchObject({ text: '0:10 ·3', overtime: true, periods: 3 });
    advance(6_000);
    expect(result.current.B.text).toBe('4.0 ·3');
    // Black moves 6 s into the first period: the period is kept and refills.
    const g1 = zengo.play(opened, 'gg', result.current.elapsed());
    rerender({ game: g1, tc: '1m3x10', opts: { onFlag } });
    expect(result.current.B).toMatchObject({ text: '0:10 ·3', running: false });
    const g2 = zengo.play(g1, 'cg', result.current.elapsed());
    rerender({ game: g2, tc: '1m3x10', opts: { onFlag } });
    advance(12_000);
    expect(result.current.B).toMatchObject({ text: '8.0 ·2', running: true });
    advance(17_900);
    expect(result.current.B.text).toBe('0.1 ·1');
    expect(onFlag).not.toHaveBeenCalled();
    advance(100);
    expect(onFlag).toHaveBeenCalledTimes(1);
    expect(onFlag).toHaveBeenCalledWith('B');
    expect(result.current.B).toMatchObject({ text: '0.0', flagged: true });
    // Undo restores the clock from the log: the side to move is White, Black's periods are back.
    rerender({ game: zengo.undo(g2, 1), tc: '1m3x10', opts: { onFlag } });
    expect(result.current.B).toMatchObject({ text: '0:10 ·3', flagged: false });
  });

  it('pauses byo-yomi periods while the tab is hidden (solo)', () => {
    const { result } = mount(opened, '0m3x10');
    advance(4_000);
    expect(result.current.B.text).toBe('6.0 ·3');
    setVisibility('hidden');
    advance(60_000);
    expect(result.current.B.text).toBe('6.0 ·3');
    setVisibility('visible');
    advance(7_000);
    expect(result.current.B.text).toBe('9.0 ·2');
  });

  it('inside the i18n provider the byo-yomi faces carry their spoken reading', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider language="de">{children}</I18nProvider>;
    const { result } = renderHook(() => useClock(opened, '0m5x30', { now }), { wrapper });
    advance(6_000);
    expect(result.current.B).toMatchObject({ text: '0:24 ·5', label: '24 Sekunden, 5 Perioden' });
    expect(result.current.W.label).toBe('30 Sekunden, 5 Perioden');
    // Without the provider (and for Fischer) there is no label.
    expect(mount(opened, '0m5x30').result.current.B.label).toBeUndefined();
    expect(renderHook(() => useClock(opened, ONE_MIN, { now }), { wrapper }).result.current.B.label).toBeUndefined();
  });

  it('the strip reads the spoken label inside role="timer"', () => {
    function Strip() {
      const c = useClock(opened, '0m5x30', { now });
      return <PlayerStrip color="B" prisoners={0} clock={c.B} active />;
    }
    render(
      <I18nProvider language="en">
        <Strip />
      </I18nProvider>,
    );
    advance(6_000);
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('0:24 ·5');
    expect(timer).toHaveTextContent('24 seconds, 5 periods');
    expect(timer.getAttribute('data-ms')).toBe('24000');
  });

  it('stops during scoring', () => {
    const scoring = playAll([['tt', 1000], ['tt', 1000]], opened);
    expect(scoring.scoring).toBeDefined();
    const { result } = mount(scoring, ONE_MIN);
    expect(result.current.ticking).toBe(false);
    expect(result.current.counting).toBe(false);
    advance(30_000);
    expect(result.current.elapsed()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('room (external turn, DESIGN 9.7)', () => {
    it('uses the controller stamps and gives the opponent 2 s of grace', () => {
      const onFlag = vi.fn();
      const g = playAll([['gg', 59_000], ['cg', 0]], opened); // Black has 1 s left
      const ext = { turnStart: clock, turnUsed: 0 };
      const { result, rerender } = mount(g, ONE_MIN, { external: ext, ownColor: 'W', onFlag });
      advance(1000);
      expect(result.current.B.text).toBe('0.0');
      expect(onFlag).not.toHaveBeenCalled();
      advance(2100);
      expect(onFlag).toHaveBeenCalledWith('B');
      // Paused by a disconnect: the controller clears the stamp.
      onFlag.mockClear();
      rerender({ game: g, tc: ONE_MIN, opts: { external: { turnStart: null, turnUsed: 500 }, ownColor: 'W', onFlag } });
      expect(result.current.ticking).toBe(false);
      expect(result.current.elapsed()).toBe(500);
    });

    it("this device's own flag falls at zero", () => {
      const onFlag = vi.fn();
      const g = playAll([['gg', 59_000], ['cg', 0]], opened);
      mount(g, ONE_MIN, { external: { turnStart: clock, turnUsed: 0 }, ownColor: 'B', onFlag });
      advance(1100);
      expect(onFlag).toHaveBeenCalledWith('B');
    });
  });
});
