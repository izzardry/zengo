import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassUndoToast, ResignUndoToast } from './ResignUndoToast';
import { renderWithI18n } from './testUtils';

describe('ResignUndoToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('names who resigned', () => {
    const { rerender } = renderWithI18n(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('You resigned');
    rerender(<ResignUndoToast open who="B" onUndo={vi.fn()} onExpire={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Black resigned');
  });

  it('Undo takes the resignation back, once', () => {
    const onUndo = vi.fn();
    const onExpire = vi.fn();
    renderWithI18n(<ResignUndoToast open who="you" onUndo={onUndo} onExpire={onExpire} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    act(() => void vi.advanceTimersByTime(6000));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expires after 5 s', () => {
    const onExpire = vi.fn();
    renderWithI18n(<ResignUndoToast open who="W" onUndo={vi.fn()} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(4999));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('× dismisses: the resignation becomes final (Ztyle audit #12)', () => {
    const onExpire = vi.fn();
    const onUndo = vi.fn();
    renderWithI18n(<ResignUndoToast open who="you" onUndo={onUndo} onExpire={onExpire} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => void vi.advanceTimersByTime(6000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('restarts its timer when opened again', () => {
    const onExpire = vi.fn();
    const { rerender } = renderWithI18n(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(3000));
    rerender(<ResignUndoToast open={false} who="you" onUndo={vi.fn()} onExpire={onExpire} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(3000));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('is translated', () => {
    renderWithI18n(<ResignUndoToast open who="you" onUndo={vi.fn()} onExpire={vi.fn()} />, 'es');
    expect(screen.getByRole('status')).toHaveTextContent('Has abandonado');
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeInTheDocument();
  });
});

describe('PassUndoToast (DESIGN 6.2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads `You passed · Undo` and names the color in pass-and-play', () => {
    const { rerender } = renderWithI18n(<PassUndoToast open who="you" onUndo={vi.fn()} />);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('You passed');
    expect(toast).toHaveAttribute('data-toast', 'pass');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    rerender(<PassUndoToast open who="W" onUndo={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('White passed');
  });

  it('Undo takes the pass back; after 5 s it settles without undoing', () => {
    const onUndo = vi.fn();
    const onExpire = vi.fn();
    const { rerender } = renderWithI18n(<PassUndoToast open who="you" onUndo={onUndo} onExpire={onExpire} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    rerender(<PassUndoToast open={false} who="you" onUndo={onUndo} onExpire={onExpire} />);
    rerender(<PassUndoToast open who="you" onUndo={onUndo} onExpire={onExpire} />);
    act(() => void vi.advanceTimersByTime(4999));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('works without onExpire and is translated', () => {
    renderWithI18n(<PassUndoToast open who="B" onUndo={vi.fn()} />, 'de');
    expect(screen.getByRole('status')).toHaveTextContent('Schwarz hat gepasst');
    // × without onExpire just settles: nothing throws, and the timer does nothing afterwards.
    const [, dismiss] = screen.getAllByRole('button');
    fireEvent.click(dismiss);
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
