import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ColorChoice, Language, Opponent, Rules, SavedGame, Size, TimeControl } from '@/lib/types';
import { BackToTop } from './BackToTop';
import { BoardPreview } from './BoardPreview';
import { NO_FIT, PREVIEW_GAP, PREVIEW_MIN_SCALE, previewFit } from './previewFit';
import { CLOCK_HOLD_MS, ClockPill } from './ClockPill';
import { SizePill } from './SizePill';
import { CodeSelector } from './CodeSelector';
import { ColorPill } from './ColorPill';
import { OpponentSelector } from './OpponentSelector';
import { ScrollChevron } from './ScrollChevron';
import { StartChrome } from './StartChrome';
import { StartPill } from './StartPill';
import { VersionStamp } from './VersionStamp';
import { StartHeader, StickyHeader } from './Wordmark';
import { useScrolled } from './useScrolled';

const wrap = (ui: ReactElement, language: Language = 'en') => render(<I18nProvider language={language}>{ui}</I18nProvider>);

/** Deterministic rng: always picks the same alphabet index. */
const constRng = (idx: number) => () => idx / 36;

/* ---------------------------------------------------------------------------------------------- */

describe('CodeSelector', () => {
  function Harness({ initial = 'K7QW2M', onChange = vi.fn(), rng = constRng(10) }: { initial?: string; onChange?: ReturnType<typeof vi.fn>; rng?: () => number }) {
    const [code, setCode] = useState(initial);
    return (
      <CodeSelector
        code={code}
        rng={rng}
        onChange={(c, src) => {
          onChange(c, src);
          setCode(c);
        }}
      />
    );
  }

  it('shows the code and the lowercase caption', () => {
    wrap(<Harness />);
    expect(screen.getByTestId('code-roll')).toHaveTextContent('K7QW2M');
    expect(screen.getByText('game code')).toBeInTheDocument();
  });

  it('tapping the code rolls a new random 6-character code', async () => {
    const onChange = vi.fn();
    wrap(<Harness onChange={onChange} rng={constRng(10)} />);
    await userEvent.click(screen.getByTestId('code-roll'));
    expect(onChange).toHaveBeenCalledWith('AAAAAA', 'random');
    expect(screen.getByTestId('code-roll')).toHaveTextContent('AAAAAA');
  });

  it('never rolls the same code it shows', async () => {
    const onChange = vi.fn();
    const seq = [10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11];
    let i = 0;
    wrap(<Harness initial="AAAAAA" onChange={onChange} rng={() => seq[i++ % seq.length] / 36} />);
    await userEvent.click(screen.getByTestId('code-roll'));
    expect(onChange).toHaveBeenCalledWith('BBBBBB', 'random');
  });

  it('edits inline: filters to 0-9A-Z, uppercases, caps at 8, Enter confirms', async () => {
    const onChange = vi.fn();
    wrap(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit game code' }));
    const input = screen.getByTestId('code-input') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.value).toBe('K7QW2M');
    await userEvent.clear(input);
    await userEvent.type(input, 'my-friend_42xyz!');
    expect(input.value).toBe('MYFRIEND');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('MYFRIEND', 'typed');
    expect(screen.queryByTestId('code-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('code-roll')).toHaveTextContent('MYFRIEND');
    // Focus returns to the pencil.
    expect(screen.getByRole('button', { name: 'Edit game code' })).toHaveFocus();
  });

  it('the check button confirms once and does not reopen the editor', async () => {
    const onChange = vi.fn();
    wrap(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit game code' }));
    const input = screen.getByTestId('code-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm game code' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ABC', 'typed');
    expect(screen.queryByTestId('code-input')).not.toBeInTheDocument();
  });

  it('blur confirms', async () => {
    const onChange = vi.fn();
    wrap(
      <>
        <Harness onChange={onChange} />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit game code' }));
    const input = screen.getByTestId('code-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'zz9');
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ZZ9', 'typed');
  });

  it('Escape reverts without a change', async () => {
    const onChange = vi.fn();
    wrap(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit game code' }));
    const input = screen.getByTestId('code-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'NOPE');
    await userEvent.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('code-roll')).toHaveTextContent('K7QW2M');
  });

  it('an empty or unchanged entry reverts silently', async () => {
    const onChange = vi.fn();
    wrap(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit game code' }));
    await userEvent.clear(screen.getByTestId('code-input'));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('code-roll')).toHaveTextContent('K7QW2M');
    await userEvent.click(screen.getByRole('button', { name: 'Edit game code' }));
    await userEvent.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled blocks rolling and editing', async () => {
    const onChange = vi.fn();
    wrap(<CodeSelector code="ABC" onChange={onChange} disabled />);
    await userEvent.click(screen.getByTestId('code-roll'));
    await userEvent.click(screen.getByTestId('code-edit'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('code-input')).not.toBeInTheDocument();
  });

  it('is translated', () => {
    wrap(<CodeSelector code="ABC" onChange={() => {}} />, 'de');
    expect(screen.getByText('Spiel-Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spiel-Code bearbeiten' })).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('OpponentSelector', () => {
  function Harness({ initial, onChange = vi.fn(), disabled }: { initial: Opponent; onChange?: ReturnType<typeof vi.fn>; disabled?: boolean }) {
    const [v, setV] = useState<Opponent>(initial);
    return (
      <OpponentSelector
        value={v}
        disabled={disabled}
        onChange={(o) => {
          onChange(o);
          setV(o);
        }}
      />
    );
  }

  const text = () => `${screen.getByTestId('opponent-kind').textContent} | ${screen.getByTestId('opponent-name').textContent}`;

  it('shows COMPUTER · LEVEL n with the level name', () => {
    wrap(<Harness initial={{ mode: 'computer', level: 5 }} />);
    expect(text()).toBe('Computer · Level 5 | Medium');
  });

  it('steps from ROOM through TWO PLAYERS to COMPUTER 12 INSANE and stops at both ends', async () => {
    wrap(<Harness initial={{ mode: 'room' }} />);
    const prev = screen.getByRole('button', { name: 'Previous opponent' });
    const next = screen.getByRole('button', { name: 'Next opponent' });
    expect(text()).toBe('Two devices | Room');
    expect(prev).toBeDisabled();
    await userEvent.click(next);
    expect(text()).toBe('One device | Two players');
    await userEvent.click(next);
    expect(text()).toBe('Computer · Level 1 | Beginner');
    for (let i = 0; i < 11; i++) await userEvent.click(next);
    expect(text()).toBe('Computer · Level 12 | Insane');
    expect(next).toBeDisabled();
    await userEvent.click(prev);
    expect(text()).toBe('Computer · Level 11 | Master');
  });

  it('arrow keys step while focus is inside', async () => {
    const onChange = vi.fn();
    wrap(<Harness initial={{ mode: 'computer', level: 5 }} onChange={onChange} />);
    screen.getByRole('button', { name: 'Next opponent' }).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'computer', level: 6 });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('disabled shows the value dimmed and does not change', async () => {
    const onChange = vi.fn();
    wrap(<Harness initial={{ mode: 'local' }} onChange={onChange} disabled />);
    expect(screen.getByRole('button', { name: 'Previous opponent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next opponent' })).toBeDisabled();
    expect(screen.getByRole('group')).toHaveAccessibleName('Opponent of this game: One device, Two players');
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a faint rank slot that shows a calibrated rank for computer levels only (DESIGN 4.1)', () => {
    const { rerender } = wrap(<OpponentSelector value={{ mode: 'computer', level: 5 }} onChange={() => {}} />);
    expect(screen.getByTestId('opponent-rank')).toBeEmptyDOMElement();
    const again = (ui: ReactElement) => rerender(<I18nProvider language="en">{ui}</I18nProvider>);
    again(<OpponentSelector value={{ mode: 'computer', level: 5 }} rank="≈12k" onChange={() => {}} />);
    expect(screen.getByTestId('opponent-rank')).toHaveTextContent('≈12k');
    again(<OpponentSelector value={{ mode: 'local' }} rank="≈12k" onChange={() => {}} />);
    expect(screen.getByTestId('opponent-rank')).toBeEmptyDOMElement();
    // Landscape drops the empty slot to save height.
    again(<OpponentSelector value={{ mode: 'computer', level: 5 }} landscape onChange={() => {}} />);
    expect(screen.queryByTestId('opponent-rank')).toBeNull();
  });

  it('is translated', () => {
    wrap(<OpponentSelector value={{ mode: 'computer', level: 12 }} onChange={() => {}} />, 'fr');
    expect(text()).toBe('Ordinateur · Niveau 12 | Dément');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('ColorPill', () => {
  function Harness({ onChange = vi.fn(), onLongPress, handicap = 0 }: { onChange?: ReturnType<typeof vi.fn>; onLongPress?: ReturnType<typeof vi.fn>; handicap?: number }) {
    const [v, setV] = useState<ColorChoice>('random');
    return (
      <ColorPill
        value={v}
        handicap={handicap}
        onLongPress={onLongPress}
        onChange={(c) => {
          onChange(c);
          setV(c);
        }}
      />
    );
  }

  it('cycles random → black → white → random', async () => {
    wrap(<Harness />);
    const pill = screen.getByTestId('color-pill');
    expect(pill).toHaveAccessibleName('Your color: Random, no handicap. Tap to change the color, hold for the handicap');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(`${pill.getAttribute('data-value')}:${pill.textContent}`);
      await userEvent.click(pill);
    }
    expect(seen).toEqual(['random:Random', 'B:Black', 'W:White', 'random:Random']);
  });

  it('reads "black · H3" with a handicap (DESIGN 4.1)', () => {
    wrap(<ColorPill value="B" handicap={3} onChange={() => {}} />);
    const pill = screen.getByTestId('color-pill');
    expect(pill).toHaveTextContent('Black· H3');
    expect(pill.className).toContain('lowercase');
    expect(pill).toHaveAttribute('data-handicap', '3');
    expect(pill).toHaveAccessibleName('Your color: Black, 3 handicap stones. Tap to change the color, hold for the handicap');
  });

  it('a 500 ms hold calls onLongPress and swallows the click', () => {
    vi.useFakeTimers();
    try {
      const onLongPress = vi.fn();
      const onChange = vi.fn();
      wrap(<Harness onLongPress={onLongPress} onChange={onChange} />);
      const pill = screen.getByTestId('color-pill');
      fireEvent.pointerDown(pill, { pointerType: 'touch' });
      act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS));
      expect(onLongPress).toHaveBeenCalledTimes(1);
      expect(onLongPress.mock.calls[0][0]).toEqual(expect.objectContaining({ source: 'pointer' }));
      fireEvent.pointerUp(pill);
      fireEvent.click(pill);
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyDown(pill, { key: 'Enter', shiftKey: true });
      expect(onLongPress).toHaveBeenCalledTimes(2);
      expect(onLongPress.mock.calls[1][0]).toEqual(expect.objectContaining({ source: 'keyboard' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('in pass-and-play the color is dimmed and fixed, but the hold still sets the handicap', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const onLongPress = vi.fn();
      wrap(<ColorPill value="random" handicap={2} colorFixed onChange={onChange} onLongPress={onLongPress} />);
      const pill = screen.getByTestId('color-pill');
      expect(pill).toBeEnabled();
      expect(pill).toHaveAccessibleName('Two players, 2 handicap stones. Hold for the handicap');
      expect(pill.querySelector('[data-part="color"]')!.className).toContain('opacity-50');
      fireEvent.click(pill);
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.pointerDown(pill, { pointerType: 'touch' });
      act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS));
      expect(onLongPress).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is dimmed and inert for a room joiner, and has no hold', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const onLongPress = vi.fn();
      wrap(<ColorPill value="B" onChange={onChange} onLongPress={onLongPress} disabled />);
      const pill = screen.getByTestId('color-pill');
      expect(pill).toBeDisabled();
      expect(pill.className).toContain('opacity-50');
      expect(pill).toHaveAccessibleName('Your color: Black, no handicap. Set by the room or the game');
      fireEvent.click(pill);
      fireEvent.pointerDown(pill, { pointerType: 'touch' });
      act(() => vi.advanceTimersByTime(1000));
      expect(onChange).not.toHaveBeenCalled();
      expect(onLongPress).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is translated, with the glossary word for handicap', () => {
    wrap(<ColorPill value="W" handicap={4} onChange={() => {}} />, 'de');
    const pill = screen.getByTestId('color-pill');
    expect(pill).toHaveTextContent('Weiß· V4');
    expect(pill).toHaveAccessibleName('Deine Farbe: Weiß, 4 Vorgabesteine. Tippen ändert die Farbe, halten für die Vorgabe');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('SizePill', () => {
  function Harness({ onLongPress, rules = 'area' }: { onLongPress?: ReturnType<typeof vi.fn>; rules?: Rules }) {
    const [v, setV] = useState<Size>(9);
    return <SizePill size={v} rules={rules} onChange={setV} onLongPress={onLongPress} />;
  }

  it('cycles 9×9 → 13×13 → 19×19 → 9×9', async () => {
    wrap(<Harness />);
    const pill = screen.getByTestId('size-pill');
    expect(pill).toHaveAccessibleName('Board 9×9, area scoring. Tap to change the size, hold for the rules');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(pill.textContent ?? '');
      await userEvent.click(pill);
    }
    expect(seen).toEqual(['9×9', '13×13', '19×19', '9×9']);
  });

  it('shows · JP for territory rules', () => {
    wrap(<Harness rules="territory" />);
    const pill = screen.getByTestId('size-pill');
    expect(pill).toHaveTextContent('9×9 · JP');
    expect(pill).toHaveAttribute('data-rules', 'territory');
    expect(pill).toHaveAccessibleName('Board 9×9, territory scoring. Tap to change the size, hold for the rules');
  });

  it('a 500 ms hold opens the rules (onLongPress) and swallows the click', () => {
    vi.useFakeTimers();
    try {
      const onLongPress = vi.fn();
      wrap(<Harness onLongPress={onLongPress} />);
      const pill = screen.getByTestId('size-pill');
      fireEvent.pointerDown(pill, { pointerType: 'touch' });
      act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS - 1));
      expect(onLongPress).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onLongPress).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(pill);
      fireEvent.click(pill);
      expect(pill).toHaveTextContent('9×9');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is dimmed when locked and translated', () => {
    wrap(<SizePill size={13} rules="territory" onChange={() => {}} disabled />, 'fr');
    const pill = screen.getByTestId('size-pill');
    expect(pill).toBeDisabled();
    expect(pill).toHaveAccessibleName('Goban de cette partie : 13×13, décompte par territoire');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('ClockPill', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function Harness({ onLongPress, size = 9 }: { onLongPress?: ReturnType<typeof vi.fn>; size?: Size }) {
    const [v, setV] = useState<TimeControl>(null);
    return <ClockPill size={size} value={v} onChange={setV} onLongPress={onLongPress} />;
  }

  it('cycles the 9×9 presets off · 2+7 · 3+10 · 5m 5×30s · off (DESIGN 11)', async () => {
    wrap(<Harness />);
    const pill = screen.getByTestId('clock-pill');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(pill.textContent ?? '');
      await userEvent.click(pill);
    }
    expect(seen).toEqual(['Off', '2+7', '3+10', '5m 5×30s', 'Off']);
  });

  it('cycles the 19×19 presets', async () => {
    wrap(<Harness size={19} />);
    const pill = screen.getByTestId('clock-pill');
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(`${pill.textContent}|${pill.getAttribute('data-value')}`);
      await userEvent.click(pill);
    }
    expect(seen).toEqual(['Off|off', '5+7|5+7', '10+10|10+10', '20m 5×30s|20m5x30', '30m 5×60s|30m5x60', 'Off|off']);
  });

  it('a 500 ms hold calls onLongPress and swallows the click', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    wrap(<Harness onLongPress={onLongPress} />);
    const pill = screen.getByTestId('clock-pill');
    expect(pill).toHaveAccessibleName('Clock: Off. Tap to change (hold for custom time)');

    fireEvent.pointerDown(pill, { pointerType: 'touch', clientX: 40, clientY: 50 });
    act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS - 1));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    // jsdom's pointer events carry no coordinates; the anchor then falls back to the pill's center.
    expect(onLongPress.mock.calls[0][0]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), rect: expect.anything() }));
    fireEvent.pointerUp(pill);
    fireEvent.click(pill);
    expect(pill).toHaveTextContent('Off');

    // A short tap afterwards cycles again.
    fireEvent.pointerDown(pill, { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerUp(pill);
    fireEvent.click(pill);
    expect(pill).toHaveTextContent('2+7');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('leaving the pill cancels the hold', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    wrap(<Harness onLongPress={onLongPress} />);
    const pill = screen.getByTestId('clock-pill');
    fireEvent.pointerDown(pill, { pointerType: 'touch' });
    fireEvent.pointerLeave(pill);
    act(() => vi.advanceTimersByTime(1000));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('Shift+Enter is the keyboard path to the custom dial', () => {
    const onLongPress = vi.fn();
    wrap(<Harness onLongPress={onLongPress} />);
    fireEvent.keyDown(screen.getByTestId('clock-pill'), { key: 'Enter', shiftKey: true });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('without onLongPress a hold is just a tap', () => {
    vi.useFakeTimers();
    wrap(<Harness />);
    const pill = screen.getByTestId('clock-pill');
    expect(pill).toHaveAccessibleName('Clock: Off. Tap to change');
    fireEvent.pointerDown(pill, { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerUp(pill);
    fireEvent.click(pill);
    expect(pill).toHaveTextContent('2+7');
  });

  it('shows a custom value and is dimmed when locked', () => {
    wrap(<ClockPill size={13} value={{ kind: 'byoyomi', baseMs: 7 * 60000, periods: 3, periodMs: 20_000 }} onChange={() => {}} disabled />);
    const pill = screen.getByTestId('clock-pill');
    expect(pill).toHaveTextContent('7m 3×20s');
    expect(pill).toBeDisabled();
    expect(pill).toHaveAccessibleName('Clock of this game: 7m 3×20s');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('StartPill', () => {
  it.each([
    ['start', 'en', 'Start'],
    ['resume', 'en', 'Resume'],
    ['review', 'en', 'Review'],
    ['start', 'fr', 'Jouer'],
    ['resume', 'de', 'Fortsetzen'],
    ['review', 'es', 'Revisar'],
  ] as const)('label %s in %s is %s', (label, lang, text) => {
    wrap(<StartPill label={label} onClick={() => {}} />, lang);
    const pill = screen.getByTestId('start-pill');
    expect(pill).toHaveTextContent(text);
    expect(pill.className).toContain('btn-primary');
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    wrap(<StartPill label="start" onClick={onClick} />);
    await userEvent.click(screen.getByTestId('start-pill'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // Ztyle 09 "Loading & long work": the spinner's tooltip shows the progress, and a click on it
  // cancels and restores the previous state (it used to ignore presses).
  it('shows a spinner, progress and a progress tooltip while loading; a press cancels instead of starting', async () => {
    const onClick = vi.fn();
    const onCancel = vi.fn();
    wrap(<StartPill label="start" onClick={onClick} onCancel={onCancel} loading progress={0.426} />);
    const pill = screen.getByTestId('start-pill');
    expect(pill).toHaveAttribute('aria-busy', 'true');
    expect(pill).toHaveAttribute('title', 'Loading the computer: 43%\nTap to cancel');
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveTextContent('43%');
    expect(bar).toHaveAttribute('aria-valuenow', '43');
    expect(bar).toHaveAccessibleName('Loading the computer, 43%');
    await userEvent.click(pill);
    expect(onClick).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('has no tooltip when idle', () => {
    wrap(<StartPill label="start" onClick={() => {}} />);
    expect(screen.getByTestId('start-pill')).not.toHaveAttribute('title');
  });

  it('loading without progress shows only the spinner', () => {
    wrap(<StartPill label="resume" onClick={() => {}} loading />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByTestId('start-pill')).toHaveTextContent(/^Resume$/);
  });

  it('disabled blocks presses', async () => {
    const onClick = vi.fn();
    wrap(<StartPill label="start" onClick={onClick} disabled />);
    await userEvent.click(screen.getByTestId('start-pill'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('BoardPreview', () => {
  it('blurs the board, hides it from assistive tech and shows the overlay', () => {
    wrap(
      <BoardPreview blurred overlay={<button type="button">go</button>}>
        <div data-testid="board">board</div>
      </BoardPreview>,
    );
    const slot = screen.getByTestId('board').parentElement!;
    expect(slot.className).toContain('board--preview');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(slot).toHaveAttribute('inert');
    expect(slot.className).toContain('!transition-none');
    expect(screen.getByRole('button', { name: 'go' }).parentElement).toHaveAttribute('data-visible', 'true');
  });

  it('is sharp, interactive and animated during a transition', () => {
    wrap(
      <BoardPreview blurred={false} animate overlay={<span>go</span>}>
        <div data-testid="board">board</div>
      </BoardPreview>,
    );
    const slot = screen.getByTestId('board').parentElement!;
    expect(slot.className).not.toContain('board--preview');
    expect(slot.className).toContain('board--transition');
    expect(slot.className).not.toContain('!transition-none');
    expect(slot).not.toHaveAttribute('inert');
    const overlay = screen.getByText('go').parentElement!;
    expect(overlay).toHaveAttribute('data-visible', 'false');
    expect(overlay).toHaveAttribute('inert');
  });

  it('draws the blurred board between the start header and footer (DESIGN 4.1), the pill following it', () => {
    // 1280x800: header ends at 175, footer starts at 600; the board box is 490 px tall at 155.
    const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: height, x: 0, y: top, toJSON() {} }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'board-preview' ? rect(155, 490) : rect(0, 0);
    });
    const metric = (el: HTMLElement, top: number, height: number) => {
      Object.defineProperty(el, 'offsetTop', { configurable: true, value: top });
      Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
    };
    function Chrome() {
      return (
        <>
          <header data-start-edge="top" ref={(el) => el && metric(el, 16, 159)} />
          <div data-start-edge="bottom" ref={(el) => el && metric(el, 600, 160)} />
        </>
      );
    }
    try {
      const { rerender } = wrap(
        <>
          <Chrome />
          <BoardPreview blurred overlay={<span>go</span>}>
            <div data-testid="board">board</div>
          </BoardPreview>
        </>,
      );
      const slot = screen.getByTestId('board').parentElement!;
      const fit = previewFit({ boardTop: 155, boardHeight: 490, top: 175, bottom: 600 });
      expect(fit.scale).toBeLessThan(1);
      expect(slot.style.scale).toBe(String(fit.scale));
      expect(slot.style.translate).toBe(`0 ${fit.dy}px`);
      expect(screen.getByText('go').parentElement!.style.translate).toBe(`0 ${fit.dy}px`);
      // In the game the board is at full size in its place.
      rerender(
        <>
          <Chrome />
          <BoardPreview blurred={false} animate overlay={<span>go</span>}>
            <div data-testid="board">board</div>
          </BoardPreview>
        </>,
      );
      expect(screen.getByTestId('board').parentElement!.style.scale).toBe('');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('previewFit', () => {
  it('scales and centres the board between the chrome with a gap, never below 0.3', () => {
    const fit = previewFit({ boardTop: 155, boardHeight: 490, top: 175, bottom: 600 });
    const h = 490 * fit.scale;
    const centre = 155 + 245 + fit.dy;
    expect(centre - h / 2).toBeCloseTo(175 + PREVIEW_GAP);
    expect(centre + h / 2).toBeCloseTo(600 - PREVIEW_GAP);
    expect(previewFit({ boardTop: 0, boardHeight: 1000, top: 0, bottom: 100 }).scale).toBe(PREVIEW_MIN_SCALE);
  });

  it('leaves a board that fits alone, and only shifts one that fits but overlaps', () => {
    expect(previewFit({ boardTop: 200, boardHeight: 300, top: 100, bottom: 700 })).toBe(NO_FIT);
    expect(previewFit({ boardTop: 100, boardHeight: 300, top: 150, bottom: 700 })).toEqual({ scale: 1, dy: 50 + PREVIEW_GAP });
    expect(previewFit({ boardTop: 0, boardHeight: 0, top: 100, bottom: 700 })).toBe(NO_FIT);
    expect(previewFit({ boardTop: 0, boardHeight: 300, top: 400, bottom: 300 })).toBe(NO_FIT);
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('scroll pieces', () => {
  it('useScrolled flips after 50 px', () => {
    function Probe() {
      return <span data-testid="probe">{String(useScrolled())}</span>;
    }
    wrap(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 51, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('the chevron scrolls one viewport, the FAB back to the top', async () => {
    const scrollTo = vi.fn();
    const orig = window.scrollTo;
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    try {
      wrap(
        <>
          <ScrollChevron />
          <BackToTop visible />
        </>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Show previous games' }));
      expect(scrollTo).toHaveBeenLastCalledWith({ top: window.innerHeight, behavior: 'smooth' });
      await userEvent.click(screen.getByRole('button', { name: 'Back to top' }));
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    } finally {
      window.scrollTo = orig;
    }
  });

  it('the sticky header and FAB hide until scrolled', () => {
    wrap(
      <>
        <StickyHeader visible={false} />
        <BackToTop visible={false} />
      </>,
    );
    expect(screen.getByTestId('sticky-header')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('sticky-header')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('back-to-top')).toHaveAttribute('tabindex', '-1');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('VersionStamp', () => {
  it('copies the version and calls onTap', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onTap = vi.fn();
    wrap(<VersionStamp visible onTap={onTap} version="2026-11-11 10:00:00 (abc1234)" />);
    const stamp = screen.getByTestId('version-stamp');
    expect(stamp).toHaveTextContent('2026-11-11 10:00:00 (abc1234)');
    await user.click(stamp);
    expect(writeText).toHaveBeenCalledWith('2026-11-11 10:00:00 (abc1234)');
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('defaults to the build version', () => {
    wrap(<VersionStamp visible />);
    expect(screen.getByTestId('version-stamp')).toHaveTextContent('2026-01-01 00:00:00 (test)');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('StartHeader', () => {
  it('shows the untranslated wordmark and tagline', () => {
    wrap(<StartHeader visible />, 'de');
    expect(screen.getByRole('heading', { level: 1, name: 'ZIGO' })).toBeInTheDocument();
    expect(screen.getByText('Zero Distractions. Just Go.')).toBeInTheDocument();
  });

  it('is inert while hidden', () => {
    wrap(<StartHeader visible={false} />);
    expect(screen.getByTestId('start-header')).toHaveAttribute('inert');
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe('StartChrome', () => {
  const base = {
    code: 'K7QW2M',
    onCodeChange: () => {},
    opponent: { mode: 'computer', level: 5 } as Opponent,
    onOpponentChange: () => {},
    color: 'random' as ColorChoice,
    onColorChange: () => {},
    size: 9 as Size,
    onSizeChange: () => {},
    rules: 'area' as Rules,
    onRulesChange: () => {},
    handicap: 0,
    onHandicapChange: () => {},
    clock: null as TimeControl,
    onClockChange: () => {},
  };

  const savedGame = (over: Partial<SavedGame> = {}): SavedGame => ({
    id: 'K7QW2M',
    code: 'K7QW2M',
    mode: 'computer',
    level: 9,
    color: 'W',
    size: 19,
    rules: 'territory',
    handicap: 4,
    tc: '20m5x30',
    moves: 'ddpp',
    ms: [1000, 1000],
    assisted: false,
    createdAt: 1,
    lastPlayedAt: 1,
    ...over,
  });

  it('renders header, footer and stamp on the idle start screen', () => {
    wrap(<StartChrome {...base} visible />);
    expect(screen.getByTestId('start-header')).toHaveAttribute('data-visible', 'true');
    expect(screen.getByTestId('start-footer')).toHaveAttribute('data-visible', 'true');
    expect(screen.getByTestId('sticky-header')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('back-to-top')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('code-roll')).toHaveTextContent('K7QW2M');
    expect(screen.getByTestId('opponent-name')).toHaveTextContent('Medium');
    expect(screen.getByTestId('color-pill')).toBeEnabled();
    expect(screen.getByTestId('size-pill')).toHaveTextContent('9×9');
    expect(screen.getByTestId('clock-pill')).toBeEnabled();
    expect(screen.getByTestId('scroll-chevron')).toBeInTheDocument();
    expect(screen.getByTestId('version-stamp')).toBeInTheDocument();
  });

  it('puts color, size and clock in one row that may wrap on a narrow phone (DESIGN 4.1)', () => {
    wrap(<StartChrome {...base} visible />);
    const row = screen.getByTestId('start-pills');
    expect([...row.children].map((c) => c.getAttribute('data-testid'))).toEqual(['color-pill', 'size-pill', 'clock-pill']);
    expect(row.className).toContain('flex-wrap');
    // The footer is fixed: the board's layout box never moves; the preview shrinks instead.
    expect(screen.getByTestId('start-footer').className).toContain('fixed');
    expect(screen.getByTestId('start-footer')).toHaveAttribute('data-start-edge', 'bottom');
  });

  it('shows the faint rank line only when a rank is known, keeping its slot', () => {
    const { rerender } = wrap(<StartChrome {...base} visible />);
    expect(screen.getByTestId('opponent-rank')).toBeEmptyDOMElement();
    rerender(
      <I18nProvider language="en">
        <StartChrome {...base} visible opponentRank="≈12k" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('opponent-rank')).toHaveTextContent('≈12k');
    expect(screen.getByTestId('opponent-rank').className).toContain('text-foreground/40');
  });

  it('swaps to the sticky header and FAB when scrolled', () => {
    wrap(<StartChrome {...base} visible scrolled />);
    expect(screen.getByTestId('start-header')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('start-footer')).toHaveAttribute('data-visible', 'false');
    expect(screen.getByTestId('sticky-header')).toHaveAttribute('data-visible', 'true');
    expect(screen.getByTestId('back-to-top')).toHaveAttribute('data-visible', 'true');
  });

  it('hides everything in game', () => {
    wrap(<StartChrome {...base} visible={false} />);
    expect(screen.getByTestId('start-header')).toHaveAttribute('inert');
    expect(screen.getByTestId('start-footer')).toHaveAttribute('inert');
    expect(screen.getByTestId('code-roll')).toBeDisabled();
  });

  it('locks the selectors for RESUME / REVIEW and the color for a joiner', () => {
    const { unmount } = wrap(<StartChrome {...base} visible settingsLocked />);
    expect(screen.getByRole('button', { name: 'Next opponent' })).toBeDisabled();
    expect(screen.getByTestId('color-pill')).toBeDisabled();
    expect(screen.getByTestId('size-pill')).toBeDisabled();
    expect(screen.getByTestId('clock-pill')).toBeDisabled();
    unmount();
    wrap(<StartChrome {...base} opponent={{ mode: 'room' }} visible colorLocked />);
    expect(screen.getByTestId('color-pill')).toBeDisabled();
    expect(screen.getByTestId('size-pill')).toBeEnabled();
    expect(screen.getByTestId('clock-pill')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next opponent' })).toBeEnabled();
  });

  it('a code with a saved game shows its opponent, color, size, rules, handicap and clock, dimmed (DESIGN 4.1)', () => {
    wrap(<StartChrome {...base} visible saved={savedGame()} />);
    expect(screen.getByTestId('opponent-kind')).toHaveTextContent('Computer · Level 9');
    expect(screen.getByTestId('opponent-name')).toHaveTextContent('Tough');
    expect(screen.getByRole('button', { name: 'Next opponent' })).toBeDisabled();
    const color = screen.getByTestId('color-pill');
    expect(color).toHaveAttribute('data-value', 'W');
    expect(color).toHaveTextContent('White· H4');
    expect(color).toBeDisabled();
    const size = screen.getByTestId('size-pill');
    expect(size).toHaveTextContent('19×19 · JP');
    expect(size).toBeDisabled();
    const clock = screen.getByTestId('clock-pill');
    expect(clock).toHaveTextContent('20m 5×30s');
    expect(clock).toBeDisabled();
    for (const pill of [color, size, clock]) expect(pill.className).toContain('opacity-50');
  });

  it('pass-and-play keeps the handicap hold but fixes the color', () => {
    wrap(<StartChrome {...base} opponent={{ mode: 'local' }} visible />);
    const pill = screen.getByTestId('color-pill');
    expect(pill).toBeEnabled();
    expect(pill).toHaveAccessibleName('Two players, no handicap. Hold for the handicap');
  });

  it('drops the chevron in landscape and when there is no history', () => {
    const { unmount } = wrap(<StartChrome {...base} visible landscape />);
    expect(screen.queryByTestId('scroll-chevron')).not.toBeInTheDocument();
    unmount();
    wrap(<StartChrome {...base} visible showChevron={false} />);
    expect(screen.queryByTestId('scroll-chevron')).not.toBeInTheDocument();
  });

  it('wires every selector to its callback', async () => {
    const onOpponentChange = vi.fn();
    const onColorChange = vi.fn();
    const onSizeChange = vi.fn();
    const onClockChange = vi.fn();
    const onCodeChange = vi.fn();
    wrap(
      <StartChrome
        {...base}
        visible
        rng={constRng(1)}
        onOpponentChange={onOpponentChange}
        onColorChange={onColorChange}
        onSizeChange={onSizeChange}
        onClockChange={onClockChange}
        onCodeChange={onCodeChange}
        footerExtra={<span>install</span>}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Previous opponent' }));
    await userEvent.click(screen.getByTestId('color-pill'));
    await userEvent.click(screen.getByTestId('size-pill'));
    await userEvent.click(screen.getByTestId('clock-pill'));
    await userEvent.click(screen.getByTestId('code-roll'));
    expect(onOpponentChange).toHaveBeenCalledWith({ mode: 'computer', level: 4 });
    expect(onColorChange).toHaveBeenCalledWith('B');
    expect(onSizeChange).toHaveBeenCalledWith(13);
    expect(onClockChange).toHaveBeenCalledWith({ kind: 'fischer', baseMs: 120_000, incMs: 7000 });
    expect(onCodeChange).toHaveBeenCalledWith('111111', 'random');
    expect(screen.getByText('install')).toBeInTheDocument();
  });

  it('the clock pill cycles the presets of the selected size', async () => {
    const onClockChange = vi.fn();
    wrap(<StartChrome {...base} size={19} visible onClockChange={onClockChange} />);
    await userEvent.click(screen.getByTestId('clock-pill'));
    expect(onClockChange).toHaveBeenCalledWith({ kind: 'fischer', baseMs: 300_000, incMs: 7000 });
  });

  describe('dials on the 500 ms holds (DESIGN 6.3)', () => {
    const hold = (el: HTMLElement) => {
      fireEvent.pointerDown(el, { pointerType: 'touch' });
      act(() => vi.advanceTimersByTime(CLOCK_HOLD_MS));
      fireEvent.pointerUp(el);
      fireEvent.click(el);
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('holding the color pill opens the handicap dial of the selected size', () => {
      const onHandicapChange = vi.fn();
      const onColorChange = vi.fn();
      wrap(<StartChrome {...base} size={13} visible onHandicapChange={onHandicapChange} onColorChange={onColorChange} />);
      hold(screen.getByTestId('color-pill'));
      expect(onColorChange).not.toHaveBeenCalled();
      const dial = screen.getByTestId('handicap-dial');
      expect(dial).toHaveAccessibleName('Handicap on 13×13');
      fireEvent.click(dial.querySelector('[data-value="3"]')!, { detail: 0 });
      expect(onHandicapChange).toHaveBeenCalledWith(3);
      expect(screen.queryByTestId('handicap-dial')).toBeNull();
    });

    it('holding the size pill opens the rules dial', () => {
      const onRulesChange = vi.fn();
      const onSizeChange = vi.fn();
      wrap(<StartChrome {...base} visible onRulesChange={onRulesChange} onSizeChange={onSizeChange} />);
      hold(screen.getByTestId('size-pill'));
      expect(onSizeChange).not.toHaveBeenCalled();
      const dial = screen.getByTestId('rules-dial');
      fireEvent.click(dial.querySelector('[data-value="territory"]')!, { detail: 0 });
      expect(onRulesChange).toHaveBeenCalledWith('territory');
      expect(screen.queryByTestId('rules-dial')).toBeNull();
    });

    it('holding the clock pill opens the custom clock and hands back a time control', () => {
      const onClockChange = vi.fn();
      wrap(<StartChrome {...base} visible onClockChange={onClockChange} />);
      hold(screen.getByTestId('clock-pill'));
      const dial = () => screen.getByTestId('clock-dial');
      for (const v of ['byoyomi', '10', '30', '3']) fireEvent.click(dial().querySelector(`[data-value="${v}"]`)!, { detail: 0 });
      expect(onClockChange).toHaveBeenCalledWith({ kind: 'byoyomi', baseMs: 600_000, periods: 3, periodMs: 30_000 });
      expect(screen.queryByTestId('clock-dial')).toBeNull();
    });

    it('Escape closes a dial without a change; leaving the start screen closes it too', () => {
      const onHandicapChange = vi.fn();
      const { rerender } = wrap(<StartChrome {...base} visible onHandicapChange={onHandicapChange} />);
      hold(screen.getByTestId('color-pill'));
      fireEvent.keyDown(screen.getByTestId('handicap-dial'), { key: 'Escape' });
      expect(screen.queryByTestId('handicap-dial')).toBeNull();
      hold(screen.getByTestId('color-pill'));
      expect(screen.getByTestId('handicap-dial')).toBeInTheDocument();
      rerender(
        <I18nProvider language="en">
          <StartChrome {...base} visible={false} onHandicapChange={onHandicapChange} />
        </I18nProvider>,
      );
      expect(screen.queryByTestId('handicap-dial')).toBeNull();
      expect(onHandicapChange).not.toHaveBeenCalled();
    });

    it('a locked screen opens no dial', () => {
      wrap(<StartChrome {...base} visible saved={savedGame()} />);
      hold(screen.getByTestId('color-pill'));
      hold(screen.getByTestId('size-pill'));
      hold(screen.getByTestId('clock-pill'));
      expect(document.querySelector('[data-zigo-dial]')).toBeNull();
    });
  });
});
