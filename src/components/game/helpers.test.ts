import { describe, expect, it, vi } from 'vitest';
import type { Result, Score } from '@/lib/types';
import { formatKomi, formatPoints, localHalf, moveLabel, other, plyInfo, scoreLine, scoreTotals } from './format';
import { endTexts, outcomeFor, tintClass, tintFor, winner } from './outcome';
import { copyText, shareOrCopy } from './share';

function score(over: Partial<Score>): Score {
  return {
    rules: 'area',
    B: { territory: 20, stones: 25, prisoners: 0 },
    W: { territory: 15, stones: 25, prisoners: 0 },
    komi2: 15,
    compensation2: 0,
    total2: { B: 90, W: 95 },
    margin2: -5,
    ...over,
  };
}

describe('format', () => {
  it('numbers every ply and alternates colors from the first mover', () => {
    expect(plyInfo(0)).toEqual({ number: 1, color: 'B' });
    expect(plyInfo(1)).toEqual({ number: 2, color: 'W' });
    expect(plyInfo(33)).toEqual({ number: 34, color: 'W' });
    // handicap: White moves first
    expect(plyInfo(0, 1, 'W')).toEqual({ number: 1, color: 'W' });
    expect(plyInfo(1, 1, 'W')).toEqual({ number: 2, color: 'B' });
    expect(plyInfo(0, 30, 'B')).toEqual({ number: 30, color: 'B' });
    expect(other('B')).toBe('W');
    expect(other('W')).toBe('B');
  });

  it('labels moves in GTP; a pass by its word', () => {
    expect(moveLabel('dp', 19, 'Pass')).toBe('D4');
    expect(moveLabel('pd', 19, 'Pass')).toBe('Q16');
    expect(moveLabel('ee', 9, 'Pass')).toBe('E5');
    expect(moveLabel('tt', 13, 'Passen')).toBe('Passen');
    // off the board: the raw point rather than a crash
    expect(moveLabel('ss', 9, 'Pass')).toBe('ss');
  });

  it('formats komi, room points and margins', () => {
    expect(formatKomi(15)).toBe('+7.5');
    expect(formatKomi(13)).toBe('+6.5');
    expect(formatKomi(1)).toBe('+0.5');
    expect(formatPoints(2)).toBe('2');
    expect(formatPoints(1.5)).toBe('1½');
    expect(formatPoints(0.5)).toBe('½');
    expect(localHalf(9, 'en')).toBe('4.5');
    expect(localHalf(9, 'de')).toBe('4,5');
    expect(localHalf(9, 'fr')).toBe('4,5');
    expect(localHalf(8, 'es')).toBe('4');
  });

  it('writes the running score line of DESIGN 8.4', () => {
    expect(scoreLine(score({}))).toBe('B 45 · W 40 + 7.5');
    expect(
      scoreLine(
        score({
          rules: 'territory',
          B: { territory: 12, stones: 30, prisoners: 3 },
          W: { territory: 10, stones: 28, prisoners: 1 },
          komi2: 13,
        }),
      ),
    ).toBe('B 12 + 3 · W 10 + 1 + 6.5');
    // area with handicap: White's term is komi plus the compensation (0.5 + 3)
    expect(scoreLine(score({ komi2: 1, compensation2: 6 }))).toBe('B 45 · W 40 + 3.5');
    expect(scoreTotals(score({}))).toEqual({ B: '45', W: '47.5' });
  });
});

describe('outcome', () => {
  const r = (w: Result['winner'], by: Result['by'], margin?: number): Result => ({ winner: w, by, margin });

  it('finds the winner and the outcome per mode (no draws in Go)', () => {
    expect(winner(r('W', 'score', 5))).toBe('W');
    expect(winner(r('B', 'resign'))).toBe('B');
    expect(outcomeFor(r('W', 'score', 5), 'computer', 'W')).toBe('win');
    expect(outcomeFor(r('W', 'time'), 'room', 'B')).toBe('loss');
    expect(outcomeFor(r('W', 'resign'), 'local', 'W')).toBe('local');
  });

  it('tints green for a win, red for a loss, nothing in pass-and-play (DESIGN 8.5)', () => {
    expect(tintFor(r('B', 'score', 9), 'computer', 'B')).toBe('success');
    expect(tintFor(r('B', 'time'), 'computer', 'W')).toBe('destructive');
    expect(tintFor(r('B', 'resign'), 'local', 'W')).toBeNull();
    expect(tintClass('success')).toBe('page-tint completion-success');
    expect(tintClass('destructive')).toBe('page-tint completion-failure');
    expect(tintClass(null)).toBe('page-tint');
  });

  it('picks glyph and title per the table of DESIGN 8.5', () => {
    expect(endTexts(r('B', 'score', 9), 'computer', 'B')).toEqual({ glyph: true, title: 'game.title.wonBy', margin: true });
    expect(endTexts(r('B', 'resign'), 'room', 'B')).toEqual({ glyph: true, title: 'game.title.wonResign', margin: false });
    expect(endTexts(r('B', 'resign'), 'computer', 'B').title).toBe('game.title.levelResigned');
    expect(endTexts(r('W', 'time'), 'room', 'W').title).toBe('game.title.wonTime');
    expect(endTexts(r('B', 'score', 9), 'computer', 'W')).toEqual({ glyph: false, title: 'game.title.lostBy', margin: true });
    expect(endTexts(r('B', 'resign'), 'computer', 'W').title).toBe('game.title.resigned');
    expect(endTexts(r('B', 'time'), 'room', 'W').title).toBe('game.title.outOfTime');
    expect(endTexts(r('B', 'score', 9), 'local', 'W')).toEqual({ glyph: true, title: 'game.title.blackWinsBy', margin: true });
    expect(endTexts(r('W', 'score', 1), 'local', 'B').title).toBe('game.title.whiteWinsBy');
    expect(endTexts(r('W', 'resign'), 'local', 'B').title).toBe('game.title.whiteWinsResign');
    expect(endTexts(r('B', 'resign'), 'local', 'B').title).toBe('game.title.blackWinsResign');
    expect(endTexts(r('B', 'time'), 'local', 'B').title).toBe('game.title.blackWinsTime');
    expect(endTexts(r('W', 'time'), 'local', 'B').title).toBe('game.title.whiteWinsTime');
  });
});

describe('share', () => {
  const data = { title: 'Zengo', text: 'Look', url: 'https://x/#/?s=ABC' };

  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share, clipboard: { writeText } })).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies nothing when the user closes the sheet', async () => {
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to copying the URL when sharing fails or is missing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy(data, { share: vi.fn().mockRejectedValue(new Error('nope')), clipboard: { writeText } })).toBe('copied');
    expect(await shareOrCopy(data, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('falls back to execCommand when the clipboard API fails, and reports failure', async () => {
    const exec = vi.fn().mockReturnValue(true);
    const original = document.execCommand;
    document.execCommand = exec;
    try {
      expect(await copyText('sgf', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })).toBe(true);
      expect(exec).toHaveBeenCalledWith('copy');
      exec.mockReturnValue(false);
      expect(await shareOrCopy(data, {})).toBe('failed');
    } finally {
      document.execCommand = original;
    }
    expect(document.querySelector('textarea')).toBeNull();
  });
});
