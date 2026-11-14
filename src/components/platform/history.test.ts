import { describe, expect, it } from 'vitest';
import {
  cardState,
  formatPoints,
  formatRelativeTime,
  formatRoomScore,
  gameOf,
  groupByTime,
  groupOf,
  moveCount,
  plyCount,
  roomOf,
  sideToMove,
  sizeLabel,
  sizeOf,
  sortByRecent,
} from './history';
import { savedGame } from './test-utils';
import type { Room } from '@/lib/types';
import { fromGtp, pointToIndex } from '@/lib/zengo';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A fixed local "now": 2026-11-11 15:00 local time.
const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime();

describe('grouping', () => {
  it('puts times into Today / This week / This month / This year / Older', () => {
    expect(groupOf(NOW, NOW)).toBe('today');
    expect(groupOf(new Date(2026, 10, 11, 0, 0, 1).getTime(), NOW)).toBe('today');
    expect(groupOf(new Date(2026, 10, 10, 23, 59).getTime(), NOW)).toBe('thisWeek');
    expect(groupOf(NOW - 10 * DAY, NOW)).toBe('thisMonth');
    expect(groupOf(NOW - 100 * DAY, NOW)).toBe('thisYear');
    expect(groupOf(NOW - 400 * DAY, NOW)).toBe('older');
  });

  it('returns only non-empty groups, newest first inside each', () => {
    const games = [
      savedGame({ id: 'a', lastPlayedAt: NOW - 400 * DAY }),
      savedGame({ id: 'b', lastPlayedAt: NOW - HOUR }),
      savedGame({ id: 'c', lastPlayedAt: NOW - 2 * HOUR }),
      savedGame({ id: 'd', lastPlayedAt: NOW - 3 * DAY }),
    ];
    const groups = groupByTime(games, NOW);
    expect(groups.map((g) => g.group)).toEqual(['today', 'thisWeek', 'older']);
    expect(groups[0].games.map((g) => g.id)).toEqual(['b', 'c']);
  });

  it('sorts newest first without mutating', () => {
    const games = [savedGame({ id: 'x', lastPlayedAt: 1 }), savedGame({ id: 'y', lastPlayedAt: 2 })];
    expect(sortByRecent(games).map((g) => g.id)).toEqual(['y', 'x']);
    expect(games[0].id).toBe('x');
  });
});

describe('card facts', () => {
  const scoring = { round: 1 as const, rev: 0, dead: [], accepted: [0, 0] as [number, number] };

  it('counts plies, passes included, and a move per ply as Go does', () => {
    const g = savedGame({ gtp: ['D4', 'E5', 'pass'] });
    expect(plyCount(g)).toBe(3);
    expect(moveCount(3)).toBe(3);
    expect(moveCount(0)).toBe(0);
    expect(plyCount(savedGame())).toBe(0);
  });

  it('replays a damaged move string up to the last readable ply', () => {
    expect(plyCount(savedGame({ moves: 'dd!!', ms: [1, 2, 3] }))).toBe(1);
    expect(plyCount(savedGame({ moves: 'dddd', ms: [1, 2] }))).toBe(1); // the second stone is illegal (occupied)
  });

  it('rebuilds the position for the thumbnail', () => {
    const g = gameOf(savedGame({ gtp: ['D4', 'E5'] }));
    expect(g.board).toHaveLength(81);
    expect(g.board[pointToIndex(fromGtp('D4', 9)!, 9)]).toBe(1);
    expect(g.board[pointToIndex(fromGtp('E5', 9)!, 9)]).toBe(2);
    const h = gameOf(savedGame({ size: 13, handicap: 3 }));
    expect(h.board).toHaveLength(169);
    expect([...h.board].filter((v) => v === 1)).toHaveLength(3);
  });

  it('falls back to 19×19 for a record without a valid size', () => {
    expect(sizeOf(savedGame({ size: 7 as unknown as 9 }))).toBe(19);
    expect(gameOf(savedGame({ size: undefined as unknown as 9 })).board).toHaveLength(361);
  });

  it('knows the side to move: Black first, White first with a handicap', () => {
    expect(sideToMove(0)).toBe('B');
    expect(sideToMove(1)).toBe('W');
    expect(sideToMove(0, 2)).toBe('W');
    expect(sideToMove(1, 4)).toBe('B');
  });

  it('says Your move / Their move for computer and room games', () => {
    expect(cardState(savedGame({ color: 'B' }))).toEqual({ kind: 'yourMove' });
    expect(cardState(savedGame({ color: 'W' }))).toEqual({ kind: 'theirMove' });
    expect(cardState(savedGame({ color: 'W', gtp: ['D4'], mode: 'room' }))).toEqual({ kind: 'yourMove' });
    // Handicap: White moves first.
    expect(cardState(savedGame({ color: 'B', size: 13, handicap: 3 }))).toEqual({ kind: 'theirMove' });
  });

  it('says whose turn by color in pass-and-play', () => {
    expect(cardState(savedGame({ mode: 'local', gtp: ['D4'] }))).toEqual({ kind: 'toMove', color: 'W' });
    expect(cardState(savedGame({ mode: 'local', gtp: ['D4', 'pass'] }))).toEqual({ kind: 'toMove', color: 'B' });
  });

  it('says Scoring during the scoring phase', () => {
    expect(cardState(savedGame({ gtp: ['D4', 'pass', 'pass'], scoring }))).toEqual({ kind: 'scoring' });
    expect(cardState(savedGame({ mode: 'local', gtp: ['D4', 'pass', 'pass'], scoring }))).toEqual({ kind: 'scoring' });
  });

  it('says Won (by the margin) / Lost from this device side', () => {
    expect(cardState(savedGame({ color: 'B', result: { winner: 'B', by: 'score', margin: 9 } }))).toEqual({ kind: 'won', margin2: 9 });
    expect(cardState(savedGame({ color: 'W', result: { winner: 'W', by: 'resign' } }))).toEqual({ kind: 'won' });
    expect(cardState(savedGame({ color: 'W', result: { winner: 'B', by: 'time' } }))).toEqual({ kind: 'lost' });
    // A finished scored game is not "Scoring".
    expect(
      cardState(savedGame({ color: 'B', gtp: ['D4', 'pass', 'pass'], scoring, result: { winner: 'B', by: 'score', margin: 1 } })),
    ).toEqual({ kind: 'won', margin2: 1 });
  });

  it('gives the result as B+4.5 / W+R / B+T in pass-and-play', () => {
    expect(cardState(savedGame({ mode: 'local', result: { winner: 'B', by: 'score', margin: 9 } }))).toEqual({ kind: 'result', text: 'B+4.5' });
    expect(cardState(savedGame({ mode: 'local', result: { winner: 'W', by: 'resign' } }))).toEqual({ kind: 'result', text: 'W+R' });
    expect(cardState(savedGame({ mode: 'local', result: { winner: 'B', by: 'time' } }))).toEqual({ kind: 'result', text: 'B+T' });
  });

  it('labels the size as the size pill does', () => {
    expect(sizeLabel(savedGame())).toBe('9×9');
    expect(sizeLabel(savedGame({ size: 19, rules: 'territory' }))).toBe('19×19 · JP');
  });
});

describe('room score', () => {
  it('formats half points', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(1)).toBe('½');
    expect(formatPoints(4)).toBe('2');
    expect(formatPoints(5)).toBe('2½');
  });

  it('puts this device seat first', () => {
    expect(formatRoomScore({ score: [4, 2], seat: 0 })).toBe('2 – 1');
    expect(formatRoomScore({ score: [4, 3], seat: 1 })).toBe('1½ – 2');
  });

  it('finds the room of a room game', () => {
    const room: Room = { code: 'ABC', key: 'k', seat: 0, createdAt: 0, lastSeenAt: 0, score: [0, 0], games: ['ABC.1'] };
    expect(roomOf(savedGame({ id: 'ABC.1', code: 'ABC', mode: 'room' }), [room])).toBe(room);
    expect(roomOf(savedGame({ code: 'ABC', mode: 'local' }), [room])).toBeUndefined();
    expect(roomOf(savedGame({ code: 'XYZ', id: 'XYZ.1', mode: 'room' }), [room])).toBeUndefined();
  });
});

describe('relative time', () => {
  it('uses the UI language', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW, 'en')).toBe('now');
    expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'en')).toMatch(/5 min/);
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW, 'en')).toMatch(/3 hr/);
    expect(formatRelativeTime(NOW - DAY, NOW, 'en')).toBe('yesterday');
    expect(formatRelativeTime(NOW - DAY, NOW, 'de')).toBe('gestern');
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, 'en')).toMatch(/3 days ago/);
  });

  it('shows a date from a week back, with the year when it differs', () => {
    expect(formatRelativeTime(new Date(2026, 10, 1, 12).getTime(), NOW, 'en')).toBe('Nov 1');
    expect(formatRelativeTime(new Date(2025, 0, 2, 12).getTime(), NOW, 'en')).toBe('Jan 2, 2025');
  });

  it('never shows the future', () => {
    expect(formatRelativeTime(NOW + HOUR, NOW, 'en')).toBe('now');
  });
});
