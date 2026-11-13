import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialOverlay, TUTORIAL_EXIT_MS } from './TutorialOverlay';
import { renderWithI18n } from './test-utils';

vi.mock('@/components/board', () => ({
  StoneGlyph: ({ color }: { color: string }) => <svg data-stone={color} />,
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TutorialOverlay', () => {
  it('covers DESIGN 14.2: place, ghost confirm, scoring, shield, bulb, flag, hide UI', () => {
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch isLandscape={false} />);
    const dialog = screen.getByRole('dialog', { name: 'How to play' });
    expect(dialog).toHaveTextContent('Back to start');
    expect(dialog).toHaveTextContent('Your game is saved');
    expect(dialog).toHaveTextContent('Game code');
    expect(dialog).toHaveTextContent('Tap a point to place a stone.');
    expect(dialog).toHaveTextContent('On 13×13 and 19×19, tap the ghost stone again.');
    expect(dialog).toHaveTextContent('After two passes');
    expect(dialog).toHaveTextContent('Tap dead groups, then Accept');
    expect(dialog).toHaveTextContent('Helpers on or off');
    expect(dialog).toHaveTextContent('Tap: hint · Hold: territory');
    expect(dialog).toHaveTextContent('Tap: pass · Hold: resign');
    expect(dialog).toHaveTextContent('Tap background to hide UI');
    expect(dialog).toHaveTextContent('Tap anywhere to start');
    // Illustrations are drawn from the stone set.
    expect(dialog.querySelectorAll('[data-stone="B"]').length).toBeGreaterThan(0);
    expect(dialog.querySelectorAll('[data-stone="W"]').length).toBeGreaterThan(0);
  });

  it('explains the input of the game size', () => {
    const { unmount } = renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch size={9} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Tap a point to place a stone.');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('ghost');
    unmount();
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch size={19} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Tap a point, then tap the ghost stone again.');
  });

  it('is portaled to the body above everything', () => {
    const { container } = renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByTestId('tutorial-overlay').parentElement).toBe(document.body);
    expect(screen.getByTestId('tutorial-overlay').className).toContain('z-[100]');
  });

  it('teaches clicking and typing points on pointer devices', () => {
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch={false} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Click a point. Or type one:');
    expect(screen.getByText('D4')).toBeInTheDocument();
  });

  it('follows the mode: no bulb in rooms, the flag passes and resigns in every mode', () => {
    const { unmount } = renderWithI18n(<TutorialOverlay onDismiss={() => {}} mode="room" isTouch />);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Tap: hint');
    expect(screen.getByRole('dialog')).toHaveTextContent('Tap: pass · Hold: resign');
    unmount();
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} mode="local" isTouch />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Tap: hint · Hold: territory');
    expect(screen.getByRole('dialog')).toHaveTextContent('Tap: pass · Hold: resign');
  });

  it('says against the computer that levels 10–12 depend on the device (DESIGN 10.2)', () => {
    const { unmount } = renderWithI18n(<TutorialOverlay onDismiss={() => {}} mode="computer" isTouch />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Levels 10–12 play stronger on faster devices');
    unmount();
    const landscape = renderWithI18n(<TutorialOverlay onDismiss={() => {}} isLandscape isTouch />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Levels 10–12 play stronger on faster devices');
    landscape.unmount();
    const de = renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch />, 'de');
    expect(screen.getByRole('dialog')).toHaveTextContent('Level 10–12 spielen auf schnelleren Geräten stärker');
    de.unmount();
    for (const mode of ['local', 'room'] as const) {
      const r = renderWithI18n(<TutorialOverlay onDismiss={() => {}} mode={mode} isTouch />);
      expect(screen.queryByTestId('tutorial-levels')).toBeNull();
      r.unmount();
    }
  });

  it('has a landscape arrangement with the same content', () => {
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isLandscape isTouch />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Helpers on or off');
    expect(screen.getByRole('dialog')).toHaveTextContent('Back to start');
  });

  it('dismisses once on a tap anywhere, after the fade-out', () => {
    const onDismiss = vi.fn();
    renderWithI18n(<TutorialOverlay onDismiss={onDismiss} isTouch />);
    const overlay = screen.getByTestId('tutorial-overlay');
    fireEvent.click(screen.getByText('Helpers on or off'));
    fireEvent.click(overlay);
    expect(overlay.className).toContain('opacity-0');
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TUTORIAL_EXIT_MS));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses with a key and takes focus', () => {
    const onDismiss = vi.fn();
    renderWithI18n(<TutorialOverlay onDismiss={onDismiss} isTouch />);
    expect(screen.getByTestId('tutorial-overlay')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(TUTORIAL_EXIT_MS));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is translated, with the Go glossary', () => {
    const { unmount } = renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch />, 'fr');
    expect(screen.getByRole('dialog', { name: 'Comment jouer' })).toHaveTextContent('Aides activées ou non');
    expect(screen.getByRole('dialog')).toHaveTextContent('Toucher : passer · Maintenir : abandonner');
    unmount();
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch />, 'de');
    expect(screen.getByRole('dialog')).toHaveTextContent('Tippen: Passen · Halten: Aufgeben');
    expect(screen.getByRole('dialog')).toHaveTextContent('Tippen: Tipp · Halten: Gebiet');
  });
});
