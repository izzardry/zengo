import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusBar, type StatusBarProps } from './StatusBar';
import { RAIL_TOP, railVars, toolbarLayout } from './toolbarLayout';
import { renderWithI18n } from './testUtils';

function props(over: Partial<StatusBarProps> = {}): StatusBarProps {
  return {
    mode: 'computer',
    onBack: vi.fn(),
    onHelp: vi.fn(),
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    hint: { onHint: vi.fn(), onPeekStart: vi.fn(), onPeekEnd: vi.fn() },
    helpers: true,
    onToggleHelpers: vi.fn(),
    seating: 'face',
    onToggleSeating: vi.fn(),
    onFlip: vi.fn(),
    onPass: vi.fn(),
    onResign: vi.fn(),
    onContinue: vi.fn(),
    onShare: vi.fn(),
    ...over,
  };
}

const slots = () =>
  Array.from(screen.getByRole('toolbar').querySelectorAll('[data-slot]')).map((el) => el.getAttribute('data-slot'));

const down = (el: Element) => fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
const hold = (el: Element, ms: number) => {
  down(el);
  act(() => void vi.advanceTimersByTime(ms));
  fireEvent.pointerUp(el);
  fireEvent.click(el);
};

afterEach(() => vi.useRealTimers());

describe('StatusBar slots per mode (DESIGN 4.2)', () => {
  it('computer: undo redo │ hint helpers │ flag share', () => {
    renderWithI18n(<StatusBar {...props()} />);
    expect(slots()).toEqual(['undo', 'redo', 'hint', 'helpers', 'flag', 'share']);
    expect(screen.getByRole('button', { name: 'Take back your last move' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass (hold to resign)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share game' })).toBeInTheDocument();
  });

  it('two players: adds seating; the flag passes and resigns', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local' })} />);
    expect(slots()).toEqual(['undo', 'redo', 'hint', 'helpers', 'seating', 'flag', 'share']);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass (hold to resign)' })).toBeInTheDocument();
  });

  it('room: takeback request, no redo, no hint, no seating, invite link', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'room' })} />);
    expect(slots()).toEqual(['undo', 'helpers', 'flag', 'share']);
    expect(screen.getByRole('button', { name: 'Ask for a takeback' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass (hold to resign)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share invite link' })).toBeInTheDocument();
  });

  it('room, game over: the flag slot becomes Rematch, which pulses while the request waits', () => {
    const onRematch = vi.fn();
    const { rerender } = renderWithI18n(<StatusBar {...props({ mode: 'room', onRematch })} />);
    expect(slots()).toEqual(['undo', 'helpers', 'rematch', 'share']);
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(onRematch).toHaveBeenCalledTimes(1);
    rerender(<StatusBar {...props({ mode: 'room', onRematch, rematchPending: true })} />);
    const pending = screen.getByRole('button', { name: 'Rematch requested' });
    expect(pending).toHaveAttribute('data-pending', 'true');
    fireEvent.click(pending);
    expect(onRematch).toHaveBeenCalledTimes(2);
  });

  it('room: an outstanding takeback is shown and disables undo', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'room', undoPending: true })} />);
    expect(screen.getByRole('button', { name: 'Takeback requested' })).toBeDisabled();
  });

  it('after the opponent passed, the flag carries a dot and says it ends the game (DESIGN 6.2)', () => {
    const { rerender } = renderWithI18n(<StatusBar {...props({ opponentPassed: true })} />);
    const flag = screen.getByRole('button', { name: 'Pass and end the game (hold to resign)' });
    expect(flag).toHaveAttribute('data-opponent-passed', 'true');
    expect(flag.querySelector('[data-part="dot"]')).not.toBeNull();
    rerender(<StatusBar {...props({ opponentPassed: false })} />);
    const plain = screen.getByRole('button', { name: 'Pass (hold to resign)' });
    expect(plain.querySelector('[data-part="dot"]')).toBeNull();
  });

  it('has no draw offer and no premove slot', () => {
    for (const mode of ['computer', 'local', 'room'] as const) {
      const { unmount } = renderWithI18n(<StatusBar {...props({ mode })} />);
      expect(screen.queryByRole('button', { name: /draw/i })).toBeNull();
      expect(screen.getByRole('toolbar').querySelector('[data-slot="premove"]')).toBeNull();
      unmount();
    }
  });

  it('review: stepping, flip, continue from here, share menu', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'review', onCopySgf: vi.fn() })} />);
    expect(slots()).toEqual(['undo', 'redo', 'helpers', 'flip', 'continue', 'share']);
    expect(screen.getByRole('button', { name: 'Previous move (hold for the start)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next move (hold for the end)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue from here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share link or SGF' })).toBeInTheDocument();
  });

  it('hides optional slots whose callbacks are missing', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local', hint: undefined, onToggleSeating: undefined })} />);
    expect(slots()).toEqual(['undo', 'redo', 'helpers', 'flag', 'share']);
    renderWithI18n(<StatusBar {...props({ mode: 'review', onContinue: undefined, onFlip: undefined })} />);
    expect(screen.getAllByRole('toolbar')[1].querySelectorAll('[data-slot="continue"], [data-slot="flip"]')).toHaveLength(0);
  });

  it('puts dividers between the groups only', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'room' })} />);
    const bar = screen.getByRole('toolbar');
    expect(bar.querySelectorAll('[aria-hidden="true"].bg-border')).toHaveLength(2);
  });
});

describe('StatusBar actions', () => {
  it('undo and redo call through and respect canUndo / canRedo', () => {
    const p = props({ canUndo: false });
    renderWithI18n(<StatusBar {...p} />);
    expect(screen.getByRole('button', { name: 'Take back your last move' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(p.onRedo).toHaveBeenCalledTimes(1);
  });

  it('flag: a tap passes, a 500 ms hold resigns (and passes nothing)', () => {
    vi.useFakeTimers();
    const p = props();
    renderWithI18n(<StatusBar {...p} />);
    const flag = screen.getByRole('button', { name: 'Pass (hold to resign)' });
    down(flag);
    fireEvent.pointerUp(flag);
    fireEvent.click(flag);
    expect(p.onPass).toHaveBeenCalledTimes(1);
    hold(flag, 500);
    expect(p.onResign).toHaveBeenCalledTimes(1);
    expect(p.onPass).toHaveBeenCalledTimes(1);
  });

  it('flag: the keyboard twin of the hold is Shift+Enter (DESIGN 6.3)', () => {
    const p = props({ mode: 'local' });
    renderWithI18n(<StatusBar {...p} />);
    const flag = screen.getByRole('button', { name: 'Pass (hold to resign)' });
    fireEvent.keyDown(flag, { key: 'Enter', shiftKey: true });
    fireEvent.keyUp(flag, { key: 'Enter', shiftKey: true });
    expect(p.onResign).toHaveBeenCalledTimes(1);
    expect(p.onPass).not.toHaveBeenCalled();
  });

  it('room: the flag passes and resigns too (DESIGN 4.2)', () => {
    vi.useFakeTimers();
    const p = props({ mode: 'room' });
    renderWithI18n(<StatusBar {...p} />);
    const flag = screen.getByRole('button', { name: 'Pass (hold to resign)' });
    fireEvent.click(flag);
    expect(p.onPass).toHaveBeenCalledTimes(1);
    hold(flag, 500);
    expect(p.onResign).toHaveBeenCalledTimes(1);
  });

  it('flagDisabled disables the flag', () => {
    renderWithI18n(<StatusBar {...props({ flagDisabled: true })} />);
    expect(screen.getByRole('button', { name: 'Pass (hold to resign)' })).toBeDisabled();
  });

  it('hint: tap hints, a 1 s hold peeks until release', () => {
    vi.useFakeTimers();
    const p = props();
    renderWithI18n(<StatusBar {...p} />);
    const bulb = screen.getByRole('button', { name: 'Hint (hold for territory)' });
    fireEvent.click(bulb);
    expect(p.hint!.onHint).toHaveBeenCalledTimes(1);
    down(bulb);
    act(() => void vi.advanceTimersByTime(999));
    expect(p.hint!.onPeekStart).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(p.hint!.onPeekStart).toHaveBeenCalledTimes(1);
    expect(p.hint!.onPeekEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(bulb);
    fireEvent.click(bulb);
    expect(p.hint!.onPeekEnd).toHaveBeenCalledTimes(1);
    expect(p.hint!.onHint).toHaveBeenCalledTimes(1);
  });

  it('hint: shows a spinner while the engine loads', () => {
    renderWithI18n(<StatusBar {...props({ hint: { onHint: vi.fn(), onPeekStart: vi.fn(), onPeekEnd: vi.fn(), busy: true } })} />);
    const bulb = screen.getByRole('button', { name: 'Loading the computer' });
    expect(bulb).toHaveAttribute('aria-busy', 'true');
    expect(bulb.querySelector('.animate-spin')).not.toBeNull();
  });

  it('helpers: the label says what pressing does', () => {
    const p = props({ helpers: false });
    const { rerender } = renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn helpers on' }));
    expect(p.onToggleHelpers).toHaveBeenCalledTimes(1);
    rerender(<StatusBar {...p} helpers />);
    expect(screen.getByRole('button', { name: 'Turn helpers off' })).toBeInTheDocument();
  });

  it('seating toggle', () => {
    const p = props({ mode: 'local', seating: 'side' });
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seat players face to face' }));
    expect(p.onToggleSeating).toHaveBeenCalledTimes(1);
  });

  it('review: holding undo / redo jumps to start / end; tapping steps', () => {
    vi.useFakeTimers();
    const p = props({ mode: 'review', onUndoHold: vi.fn(), onRedoHold: vi.fn() });
    renderWithI18n(<StatusBar {...p} />);
    const back = screen.getByRole('button', { name: 'Previous move (hold for the start)' });
    const fwd = screen.getByRole('button', { name: 'Next move (hold for the end)' });
    fireEvent.click(back);
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    hold(back, 500);
    expect(p.onUndoHold).toHaveBeenCalledTimes(1);
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    hold(fwd, 500);
    expect(p.onRedoHold).toHaveBeenCalledTimes(1);
    expect(p.onRedo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Flip board' }));
    expect(p.onFlip).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Continue from here' }));
    expect(p.onContinue).toHaveBeenCalledTimes(1);
  });

  it('review share opens a menu with the link and Copy SGF', async () => {
    const p = props({ mode: 'review', onCopySgf: vi.fn() });
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share link or SGF' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy SGF' }));
    expect(p.onCopySgf).toHaveBeenCalledTimes(1);
    expect(p.onShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share link or SGF' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Share link' }));
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it('share in play calls onShare directly', () => {
    const p = props();
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share game' }));
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it('back and help; holding help 3 s is the easter egg', () => {
    vi.useFakeTimers();
    const p = props({ onHelpHold: vi.fn() });
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(p.onBack).toHaveBeenCalledTimes(1);
    // The hold is announced in the aria-label (DESIGN 6.3).
    const help = screen.getByRole('button', { name: 'Show help (hold for a surprise)' });
    fireEvent.click(help);
    expect(p.onHelp).toHaveBeenCalledTimes(1);
    hold(help, 3000);
    expect(p.onHelpHold).toHaveBeenCalledTimes(1);
    expect(p.onHelp).toHaveBeenCalledTimes(1);
  });

  it('scoring: the scoring bar takes the toolbar’s place; Back and Help stay (DESIGN 8.4)', () => {
    renderWithI18n(<StatusBar {...props()} scoringBar={<div data-testid="scoring" />} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.getByTestId('scoring')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show help' })).toBeInTheDocument();
  });

  it('help without a hold action does not announce one', () => {
    renderWithI18n(<StatusBar {...props()} />);
    expect(screen.getByRole('button', { name: 'Show help' })).toBeInTheDocument();
  });

  it('announces the help hold in every language', () => {
    renderWithI18n(<StatusBar {...props({ onHelpHold: vi.fn() })} />, 'de');
    expect(screen.getByRole('button', { name: 'Hilfe anzeigen (halten für eine Überraschung)' })).toBeInTheDocument();
  });
});

/** Evaluates the bar's spacing variables for a viewport width (they are clamp(min, calc(…), max)). */
function px(expr: string, vw: number): number {
  const js = expr
    .replace(/100vw/g, String(vw))
    .replace(/(\d+(?:\.\d+)?)px/g, '$1')
    .replace(/calc\(/g, '(')
    .replace(/clamp\(([^,]+),\s*(.+),\s*([^,()]+)\)$/, 'Math.min(Math.max($1, $2), $3)');
  return Function(`return ${js}`)() as number;
}

function withMatchMedia(matches: (q: string) => boolean, fn: () => void) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({ ...original(query), matches: matches(query) })) as typeof window.matchMedia;
  try {
    fn();
  } finally {
    window.matchMedia = original;
  }
}

describe('StatusBar layout', () => {
  it('portrait is a horizontal bar, landscape a vertical rail (one column where it fits)', () => {
    withMatchMedia(
      (q) => q.startsWith('(min-height'),
      () => {
        const { rerender } = renderWithI18n(<StatusBar {...props()} />);
        expect(screen.getByRole('toolbar')).toHaveAttribute('aria-orientation', 'horizontal');
        expect(screen.getByRole('toolbar').className).toContain('bottom-');
        rerender(<StatusBar {...props()} landscape />);
        expect(screen.getByRole('toolbar')).toHaveAttribute('aria-orientation', 'vertical');
        expect(screen.getByRole('toolbar').className).toContain('flex-col');
        expect(screen.getByRole('toolbar')).toHaveAttribute('data-columns', '1');
      },
    );
  });

  it('a short landscape screen folds the rail into two columns of 44 px buttons', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local' })} landscape />);
    const bar = screen.getByRole('toolbar');
    expect(bar).toHaveAttribute('aria-orientation', 'vertical');
    expect(bar).toHaveAttribute('data-columns', '2');
    expect(bar.className).toContain('grid-cols-2');
    expect(bar.style.getPropertyValue('--tb')).toBe('44px');
    // The seating button, alone on its row in the assist group, spans both columns.
    expect(screen.getByRole('button', { name: /seating|face|side/i }).closest('.col-span-2')).not.toBeNull();
    // Rooms have four buttons: still one column when the screen is tall enough.
    expect(toolbarLayout([1, 1, 2], true).column.height).toBeLessThan(toolbarLayout([2, 3, 2], true).column.height);
  });

  it('the landscape rail is centered, and moves up (no higher than below Help) while toasts show below it', () => {
    // `--rail-top` in px for a screen `h` high, with the toasts' published height (RAIL_TOASTS_VAR).
    const top = (railHeight: number, h: number, toasts?: number) => {
      const js = railVars({ height: railHeight })['--rail-top']
        .replace(RAIL_TOP, '76')
        .replace(/var\(--zigo-rail-toasts, 0px\)/, String(toasts ?? 0))
        .replace(/100%/g, String(h))
        .replace(/50%/g, String(h / 2))
        .replace(/(\d+(?:\.\d+)?)px/g, '$1')
        .replace(/calc\(/g, '(')
        .replace(/max\(/g, 'Math.max(')
        .replace(/min\(/g, 'Math.min(');
      return Function(`return ${js}`)() as number;
    };
    // 844×390, a room's two-column rail (172 px): centered without toasts.
    expect(top(172, 390)).toBe(109);
    // A one-line toast (48 px + 12 px offset + 8 px gap) fits below the centered rail.
    expect(top(172, 390, 68)).toBe(109);
    // A three-line message with its action (102 px): the rail moves up to clear it.
    expect(top(172, 390, 102 + 20)).toBe(390 - 172 - 122);
    expect(390 - 172 - 122).toBeGreaterThanOrEqual(76);
    // 740×360: never above Help.
    expect(top(172, 360, 102 + 20)).toBe(76);
  });

  it('every toolbar button is a 44 px target; only the spacing shrinks (DESIGN 14.1)', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local' })} />);
    const bar = screen.getByRole('toolbar');
    expect(bar.style.getPropertyValue('--tb')).toBe('44px');
    // Seven buttons in three groups fit at 320, 360 and 390 px with at least 4 px beside the bar.
    const { bar: vars } = toolbarLayout([2, 3, 2], false);
    for (const vw of [320, 360, 390, 430]) {
      const pad = px(vars['--tb-pad'], vw);
      const div = px(vars['--tb-div'], vw);
      const gap = px(vars['--tb-gap'], vw);
      expect(pad).toBeGreaterThanOrEqual(0);
      expect(div).toBeGreaterThanOrEqual(0);
      expect(gap).toBeGreaterThanOrEqual(0);
      const width = 7 * 44 + 2 + 2 * 1 + 2 * pad + 4 * div + 8 * gap;
      expect(width).toBeLessThanOrEqual(vw - 8 + 1e-9);
    }
    // Full spacing where there is room.
    expect(px(vars['--tb-pad'], 390)).toBe(8);
    expect(px(vars['--tb-div'], 390)).toBe(4);
    expect(px(vars['--tb-gap'], 390)).toBe(2);
  });

  it('hidden chrome is out of reach: aria-hidden, inert, not focusable', () => {
    const { rerender } = renderWithI18n(<StatusBar {...props()} visible={false} />);
    const bar = screen.getByRole('toolbar', { hidden: true });
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect((bar as HTMLElement & { inert?: boolean }).inert).toBe(true);
    expect(bar.className).toContain('opacity-0');
    expect(screen.getByRole('button', { name: 'Back to start' })).toHaveAttribute('tabindex', '-1');
    rerender(<StatusBar {...props()} visible />);
    expect((screen.getByRole('toolbar') as HTMLElement & { inert?: boolean }).inert).toBe(false);
  });

  it('is translated', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local' })} />, 'de');
    expect(screen.getByRole('button', { name: 'Passen (halten zum Aufgeben)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hilfen ausschalten' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Spielsteuerung' })).toBeInTheDocument();
  });
});
