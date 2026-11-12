import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Score } from '@/lib/types';
import { GameOverOverlay, PageTint, type GameOverOverlayProps } from './GameOverOverlay';
import { renderWithI18n } from './testUtils';

/** B 45 · W 40 + 7.5 → Black wins by 2.5 (margin ×2 = 5). */
const SCORE: Score = {
  rules: 'area',
  B: { territory: 20, stones: 25, prisoners: 0 },
  W: { territory: 15, stones: 25, prisoners: 0 },
  komi2: 15,
  compensation2: 0,
  total2: { B: 90, W: 95 },
  margin2: -5,
};

function props(over: Partial<GameOverOverlayProps> = {}): GameOverOverlayProps {
  return {
    open: true,
    result: { winner: 'B', by: 'score', margin: 9 },
    mode: 'computer',
    myColor: 'B',
    code: 'K7QW2M',
    size: 9,
    level: 5,
    plies: 54,
    durationMs: 728_000,
    onShare: vi.fn(),
    onPrimary: vi.fn(),
    onDismiss: vi.fn(),
    delayMs: 0,
    ...over,
  };
}

describe('GameOverOverlay', () => {
  it('win by score: glyph, title with margin, summary line, Share and New game (DESIGN 8.5)', () => {
    renderWithI18n(<GameOverOverlay {...props()} />);
    const dialog = screen.getByRole('dialog', { name: 'You won by 4.5!' });
    expect(within(dialog).getByText('🎉')).toHaveAttribute('aria-hidden', 'true');
    expect(dialog).toHaveAccessibleDescription('K7QW2M • 9×9 • Level 5 • 54 moves • 12:08');
    // Each part (with the bullet before it) is one unbreakable piece: no dangling bullet, no split `54 moves`.
    const parts = Array.from(document.querySelectorAll('[data-part="summary"]'));
    expect(parts.map((p) => p.textContent)).toEqual(['K7QW2M', '• 9×9', '• Level 5', '• 54 moves', '• 12:08']);
    for (const p of parts) expect(p).toHaveClass('whitespace-nowrap');
    expect(within(dialog).getByRole('button', { name: 'Share' })).toHaveClass('btn-ghost');
    expect(within(dialog).getByRole('button', { name: 'New game' })).toHaveClass('btn-primary');
  });

  it('a scored game shows the count line under the summary', () => {
    const { rerender } = renderWithI18n(
      <GameOverOverlay {...props({ mode: 'local', result: { winner: 'W', by: 'score', margin: 5 }, score: SCORE })} />,
    );
    expect(screen.getByRole('dialog', { name: 'White wins by 2.5!' })).toBeInTheDocument();
    expect(document.querySelector('[data-part="count"]')).toHaveTextContent('B 45 · W 40 + 7.5');
    // A resignation has no count line, even when a score is passed.
    rerender(<GameOverOverlay {...props({ result: { winner: 'B', by: 'resign' }, score: SCORE })} />);
    expect(document.querySelector('[data-part="count"]')).toBeNull();
  });

  it('wins: by resignation, on time, and the computer resigning', () => {
    const { rerender } = renderWithI18n(<GameOverOverlay {...props({ mode: 'room', result: { winner: 'B', by: 'resign' } })} />);
    expect(screen.getByRole('dialog', { name: 'You won by resignation!' })).toBeInTheDocument();
    rerender(<GameOverOverlay {...props({ result: { winner: 'B', by: 'time' } })} />);
    expect(screen.getByRole('dialog', { name: 'You won on time!' })).toBeInTheDocument();
    rerender(<GameOverOverlay {...props({ level: 8, result: { winner: 'B', by: 'resign' } })} />);
    expect(screen.getByRole('dialog', { name: 'Level 8 resigned. You won!' })).toBeInTheDocument();
  });

  it('losses: no glyph; by score, resignation, time', () => {
    const { rerender } = renderWithI18n(<GameOverOverlay {...props({ myColor: 'W' })} />);
    const dialog = screen.getByRole('dialog', { name: 'Lost by 4.5' });
    expect(within(dialog).queryByText('🎉')).toBeNull();
    rerender(<GameOverOverlay {...props({ myColor: 'W', result: { winner: 'B', by: 'resign' } })} />);
    expect(screen.getByRole('dialog', { name: 'Resigned' })).toBeInTheDocument();
    rerender(<GameOverOverlay {...props({ myColor: 'W', result: { winner: 'B', by: 'time' } })} />);
    expect(screen.getByRole('dialog', { name: 'Out of time' })).toBeInTheDocument();
  });

  it('pass-and-play: color wins with glyph, 2 players in the summary', () => {
    const { rerender } = renderWithI18n(
      <GameOverOverlay {...props({ mode: 'local', level: undefined, result: { winner: 'W', by: 'resign' }, plies: 1, size: 19 })} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'White wins by resignation!' });
    expect(within(dialog).getByText('🎉')).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('K7QW2M • 19×19 • 2 players • 1 move • 12:08');
    rerender(<GameOverOverlay {...props({ mode: 'local', result: { winner: 'B', by: 'score', margin: 9 } })} />);
    expect(screen.getByRole('dialog', { name: 'Black wins by 4.5!' })).toBeInTheDocument();
    rerender(<GameOverOverlay {...props({ mode: 'local', result: { winner: 'B', by: 'time' } })} />);
    expect(screen.getByRole('dialog', { name: 'Black wins on time!' })).toBeInTheDocument();
  });

  it('writes the margin with the language’s decimal sign', () => {
    renderWithI18n(<GameOverOverlay {...props()} />, 'de');
    expect(screen.getByRole('dialog', { name: 'Gewonnen mit 4,5 Punkten!' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('K7QW2M • 9×9 • Level 5 • 54 Züge • 12:08');
  });

  it('room: the primary action is Rematch and can wait for the opponent', () => {
    const { rerender } = renderWithI18n(<GameOverOverlay {...props({ mode: 'room' })} />);
    expect(screen.getByRole('button', { name: 'Rematch' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/• Room •/);
    rerender(<GameOverOverlay {...props({ mode: 'room', primaryBusy: true })} />);
    expect(screen.getByRole('button', { name: 'Rematch' })).toBeDisabled();
  });

  it('room: a waiting rematch shows its note under the buttons, only while busy (DESIGN 9.7)', () => {
    const note = 'Waiting for your opponent';
    const { rerender } = renderWithI18n(<GameOverOverlay {...props({ mode: 'room', primaryNote: note })} />);
    expect(screen.queryByText(note)).toBeNull();
    rerender(<GameOverOverlay {...props({ mode: 'room', primaryBusy: true, primaryNote: note })} />);
    expect(screen.getByRole('status')).toHaveTextContent(note);
    expect(screen.getByRole('button', { name: 'Rematch' })).toHaveAttribute('aria-busy', 'true');
  });

  it('room: a rematch that cannot be asked (opponent away) is disabled, with its note', () => {
    const note = 'Waiting for opponent';
    const p = props({ mode: 'room', primaryDisabled: true, primaryNote: note });
    renderWithI18n(<GameOverOverlay {...p} />);
    const button = screen.getByRole('button', { name: 'Rematch' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('status')).toHaveTextContent(note);
    fireEvent.click(button);
    expect(p.onPrimary).not.toHaveBeenCalled();
  });

  it('actions call back; the scrim and Escape dismiss, the content does not', () => {
    const p = props();
    renderWithI18n(<GameOverOverlay {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(p.onShare).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(p.onPrimary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('heading', { name: 'You won by 4.5!' }));
    expect(p.onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'New game' }), { key: 'Escape' });
    expect(p.onDismiss).toHaveBeenCalledTimes(2);
  });

  it('focuses the primary action and traps Tab', () => {
    renderWithI18n(<GameOverOverlay {...props()} />);
    const primary = screen.getByRole('button', { name: 'New game' });
    const share = screen.getByRole('button', { name: 'Share' });
    expect(primary).toHaveFocus();
    fireEvent.keyDown(primary, { key: 'Tab' });
    expect(share).toHaveFocus();
    fireEvent.keyDown(share, { key: 'Tab', shiftKey: true });
    expect(primary).toHaveFocus();
  });

  it('with onCopySgf, Share opens the link / SGF menu', async () => {
    const p = props({ onCopySgf: vi.fn() });
    renderWithI18n(<GameOverOverlay {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Copy SGF' }));
    expect(p.onCopySgf).toHaveBeenCalledTimes(1);
    expect(p.onDismiss).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderWithI18n(<GameOverOverlay {...props({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('timing', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('appears after the 1000 ms page tint by default', () => {
      const { delayMs: _ignored, ...rest } = props();
      renderWithI18n(<GameOverOverlay {...rest} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => void vi.advanceTimersByTime(999));
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closing before the delay cancels it', () => {
      const { delayMs: _ignored, ...rest } = props();
      const { rerender } = renderWithI18n(<GameOverOverlay {...rest} />);
      act(() => void vi.advanceTimersByTime(500));
      rerender(<GameOverOverlay {...rest} open={false} />);
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('PageTint', () => {
  it('tints success, destructive or nothing', () => {
    const { container, rerender } = renderWithI18n(<PageTint tint="success" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('page-tint', 'completion-success', 'pointer-events-none');
    rerender(<PageTint tint="destructive" />);
    expect(container.firstChild).toHaveClass('completion-failure');
    rerender(<PageTint tint={null} />);
    expect(container.firstChild).not.toHaveClass('completion-success');
    expect(container.firstChild).not.toHaveClass('completion-failure');
  });
});
