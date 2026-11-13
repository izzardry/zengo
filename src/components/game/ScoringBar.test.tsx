import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScoringAccept, ScoringBar, type ScoringBarProps } from './ScoringBar';
import { renderWithI18n } from './testUtils';

function props(over: Partial<ScoringBarProps> = {}): ScoringBarProps {
  return { onResume: vi.fn(), onAccept: vi.fn(), ...over };
}

describe('ScoringBar (DESIGN 8.4)', () => {
  it('offers Resume (ghost) and Accept (primary)', () => {
    const p = props();
    renderWithI18n(<ScoringBar {...p} />);
    const bar = screen.getByRole('group', { name: 'Scoring' });
    const resume = within(bar).getByRole('button', { name: 'Resume' });
    const accept = within(bar).getByRole('button', { name: 'Accept' });
    expect(resume).toHaveClass('btn-ghost');
    expect(accept).toHaveClass('btn-primary');
    expect(accept).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(resume);
    fireEvent.click(accept);
    expect(p.onResume).toHaveBeenCalledTimes(1);
    expect(p.onAccept).toHaveBeenCalledTimes(1);
  });

  it('shows an accepted marking as pressed', () => {
    renderWithI18n(<ScoringBar {...props({ accepted: true })} />);
    const accept = screen.getByRole('button', { name: 'Accepted' });
    expect(accept).toHaveAttribute('aria-pressed', 'true');
    expect(accept).toHaveAttribute('data-accepted', 'true');
  });

  it('face to face: each Accept names its side; the far one is compact for the far strip', () => {
    const onFar = vi.fn();
    renderWithI18n(
      <>
        <ScoringBar {...props({ side: 'B' })} />
        <ScoringAccept onAccept={onFar} side="W" accepted variant="compact" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Accept the count for Black' })).toHaveAttribute('data-side', 'B');
    const far = screen.getByRole('button', { name: 'White accepted the count' });
    expect(far.className).toContain('text-xs');
    fireEvent.click(far);
    expect(onFar).toHaveBeenCalledTimes(1);
  });

  it('room: a note slot above the bar, and both buttons can be locked', () => {
    const p = props({ disabled: true, note: 'Scoring continues when your opponent is back' });
    renderWithI18n(<ScoringBar {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent('Scoring continues when your opponent is back');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  it('portrait: from sm up the note sits in the glass pill beside the buttons, not above the bar', () => {
    renderWithI18n(<ScoringBar {...props({ note: 'Waiting for your opponent to accept' })} />);
    const row = screen.getByTestId('scoring-bar').querySelector('[data-part="row"]') as HTMLElement;
    const note = screen.getByRole('status');
    const group = screen.getByRole('group', { name: 'Scoring' });
    // One row holds the note and then the buttons.
    expect(row).toContainElement(note);
    expect(row).toContainElement(group);
    expect(note.nextElementSibling).toBe(group);
    // Phones: the wrapper is transparent to layout (note above, as before); sm up: the glass pill.
    expect(row).toHaveClass('contents', 'sm:flex', 'sm:rounded-full', 'sm:bg-card/80', 'sm:pl-4');
    expect(group).toHaveClass('sm:bg-transparent', 'sm:border-0', 'sm:shadow-none');
    expect(note).toHaveClass('sm:text-left');
  });

  it('landscape: the rail keeps the note outside the card, with no sm row', () => {
    renderWithI18n(<ScoringBar {...props({ landscape: true, note: 'Waiting for your opponent to accept' })} />);
    const row = screen.getByTestId('scoring-bar').querySelector('[data-part="row"]') as HTMLElement;
    expect(row.className).toBe('contents');
    expect(screen.getByRole('group', { name: 'Scoring' }).className).not.toMatch(/sm:/);
  });

  it('Resume alone can be locked', () => {
    renderWithI18n(<ScoringBar {...props({ resumeDisabled: true })} />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  it('sits where the toolbar was: bottom center in portrait, right rail in landscape', () => {
    const { rerender } = renderWithI18n(<ScoringBar {...props()} />);
    expect(screen.getByTestId('scoring-bar').className).toContain('bottom-[max(1rem');
    rerender(<ScoringBar {...props()} landscape />);
    expect(screen.getByTestId('scoring-bar').className).toContain('right-[max(1rem');
  });

  it('hides with the chrome and becomes inert', () => {
    renderWithI18n(<ScoringBar {...props()} visible={false} />);
    const bar = screen.getByTestId('scoring-bar') as HTMLElement & { inert?: boolean };
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar.inert).toBe(true);
    expect(bar.className).toContain('opacity-0');
  });

  it('is translated', () => {
    renderWithI18n(<ScoringBar {...props({ side: 'W' })} />, 'de');
    expect(screen.getByRole('group', { name: 'Zählung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weiterspielen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zählung für Weiß annehmen' })).toBeInTheDocument();
  });
});
