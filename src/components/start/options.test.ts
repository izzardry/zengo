import { describe, expect, it } from 'vitest';
import type { Opponent, SavedGame, Size, TimeControl } from '@/lib/types';
import { formatTc, parseTc } from '@/lib/zigo';
import {
  CLOCK_PRESETS,
  DEFAULT_OPPONENT,
  OPPONENTS,
  byoyomiTc,
  canStepOpponent,
  clockLabel,
  findGameForCode,
  fischerTc,
  handicapOptions,
  isColorChoice,
  isOpponent,
  isPresetClock,
  nextClock,
  nextColor,
  nextSize,
  opponentIndex,
  opponentOfGame,
  rulesKomi,
  sameClock,
  settingsOfGame,
  sizeLabel,
  startLabel,
  stepOpponent,
} from './options';

const saved = (over: Partial<SavedGame> = {}): SavedGame => ({
  id: 'K7QW2M',
  code: 'K7QW2M',
  mode: 'computer',
  level: 7,
  color: 'W',
  size: 9,
  rules: 'area',
  handicap: 0,
  tc: null,
  moves: '',
  ms: [],
  assisted: false,
  createdAt: 1,
  lastPlayedAt: 1,
  ...over,
});

describe('opponent stepper values', () => {
  it('orders ROOM, TWO PLAYERS, COMPUTER 1 … 12', () => {
    expect(OPPONENTS).toHaveLength(14);
    expect(OPPONENTS[0]).toEqual({ mode: 'room' });
    expect(OPPONENTS[1]).toEqual({ mode: 'local' });
    expect(OPPONENTS[2]).toEqual({ mode: 'computer', level: 1 });
    expect(OPPONENTS[13]).toEqual({ mode: 'computer', level: 12 });
  });

  it('defaults to COMPUTER 5', () => {
    expect(DEFAULT_OPPONENT).toEqual({ mode: 'computer', level: 5 });
  });

  it('steps through every value forward and back without wrapping', () => {
    let o: Opponent = OPPONENTS[0];
    const seen = [opponentIndex(o)];
    while (canStepOpponent(o, 1)) {
      o = stepOpponent(o, 1);
      seen.push(opponentIndex(o));
    }
    expect(seen).toEqual(Array.from({ length: 14 }, (_, i) => i));
    expect(stepOpponent(o, 1)).toBe(o);
    expect(canStepOpponent(OPPONENTS[0], -1)).toBe(false);
    expect(stepOpponent(OPPONENTS[0], -1)).toBe(OPPONENTS[0]);
    expect(stepOpponent({ mode: 'computer', level: 1 }, -1)).toEqual({ mode: 'local' });
    expect(stepOpponent({ mode: 'local' }, -1)).toEqual({ mode: 'room' });
  });

  it('validates stored values', () => {
    expect(isOpponent({ mode: 'room' })).toBe(true);
    expect(isOpponent({ mode: 'computer', level: 12 })).toBe(true);
    expect(isOpponent({ mode: 'computer', level: 13 })).toBe(false);
    expect(isOpponent({ mode: 'computer', level: 2.5 })).toBe(false);
    expect(isOpponent({ mode: 'computer' })).toBe(false);
    expect(isOpponent('room')).toBe(false);
    expect(isOpponent(null)).toBe(false);
  });
});

describe('color pill cycle (DESIGN 4.1)', () => {
  it('goes random → black → white → random (Black moves first)', () => {
    expect(nextColor('random')).toBe('B');
    expect(nextColor('B')).toBe('W');
    expect(nextColor('W')).toBe('random');
  });

  it('accepts only the Go color values', () => {
    expect(isColorChoice('B')).toBe(true);
    expect(isColorChoice('W')).toBe(true);
    expect(isColorChoice('random')).toBe(true);
    expect(isColorChoice('w')).toBe(false);
    expect(isColorChoice('b')).toBe(false);
  });
});

describe('handicap dial values (DESIGN 4.1, 8.2)', () => {
  it('offers 0, 2 … 9 on 13×13 and 19×19 and 0, 2 … 5 on 9×9', () => {
    expect(handicapOptions(9)).toEqual([0, 2, 3, 4, 5]);
    expect(handicapOptions(13)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(handicapOptions(19)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('size pill (DESIGN 4.1)', () => {
  it('cycles 9×9 → 13×13 → 19×19 → 9×9', () => {
    const seen: Size[] = [];
    let s: Size = 9;
    for (let i = 0; i < 4; i++) {
      seen.push(s);
      s = nextSize(s);
    }
    expect(seen).toEqual([9, 13, 19, 9]);
  });

  it('labels area as 9×9 and territory as 9×9 · JP', () => {
    expect(sizeLabel(9, 'area')).toBe('9×9');
    expect(sizeLabel(19, 'territory')).toBe('19×19 · JP');
    expect(rulesKomi('area')).toBe('7.5');
    expect(rulesKomi('territory')).toBe('6.5');
  });
});

describe('clock pill presets per size (DESIGN 11)', () => {
  const cycle = (size: Size) => {
    const seen: string[] = [];
    let t: TimeControl = null;
    for (let i = 0; i <= CLOCK_PRESETS[size].length; i++) {
      seen.push(clockLabel(t) ?? 'off');
      t = nextClock(size, t);
    }
    return seen;
  };

  it('9×9: off · 2+7 · 3+10 · 5m 5×30s', () => {
    expect(cycle(9)).toEqual(['off', '2+7', '3+10', '5m 5×30s', 'off']);
  });

  it('13×13: off · 3+7 · 5+10 · 10m 5×30s', () => {
    expect(cycle(13)).toEqual(['off', '3+7', '5+10', '10m 5×30s', 'off']);
  });

  it('19×19: off · 5+7 · 10+10 · 20m 5×30s · 30m 5×60s', () => {
    expect(cycle(19)).toEqual(['off', '5+7', '10+10', '20m 5×30s', '30m 5×60s', 'off']);
  });

  it('presets are real time controls that round-trip through the stored text form', () => {
    expect(CLOCK_PRESETS[9][1]).toEqual({ kind: 'fischer', baseMs: 120_000, incMs: 7000 });
    expect(CLOCK_PRESETS[19][4]).toEqual({ kind: 'byoyomi', baseMs: 1_800_000, periods: 5, periodMs: 60_000 });
    for (const size of [9, 13, 19] as Size[]) {
      for (const p of CLOCK_PRESETS[size]) expect(sameClock(parseTc(formatTc(p)), p)).toBe(true);
    }
  });

  it('moves a custom value (or another size’s preset) to the next longer preset, or off', () => {
    const custom = parseTc('7+5');
    expect(isPresetClock(9, custom)).toBe(false);
    expect(clockLabel(nextClock(9, custom))).toBeNull();
    expect(clockLabel(nextClock(19, custom))).toBe('10+10');
    expect(clockLabel(nextClock(13, parseTc('10+0')))).toBe('10m 5×30s');
    // 3+10 is a 9×9 preset; on 19×19 the next longer one is 5+7.
    expect(clockLabel(nextClock(19, parseTc('3+10')))).toBe('5+7');
    expect(clockLabel(nextClock(19, parseTc('60+0')))).toBeNull();
  });

  it('compares time controls by kind and value', () => {
    expect(sameClock(null, null)).toBe(true);
    expect(sameClock(parseTc('2+7'), parseTc('2+7'))).toBe(true);
    expect(sameClock(parseTc('2+7'), null)).toBe(false);
    expect(sameClock(parseTc('5m5x30'), parseTc('5m 5×30s'))).toBe(true);
    expect(sameClock(parseTc('5m5x30'), parseTc('5m3x30'))).toBe(false);
  });

  it('labels fractional values and builds the dial’s text forms', () => {
    expect(clockLabel(parseTc('0.5+2'))).toBe('0.5+2');
    expect(clockLabel(parseTc('0m3x10'))).toBe('0m 3×10s');
    expect(fischerTc(20, 5)).toBe('20+5');
    expect(byoyomiTc(20, 5, 30)).toBe('20m5x30');
    expect(parseTc(byoyomiTc(20, 5, 30))).toEqual({ kind: 'byoyomi', baseMs: 1_200_000, periods: 5, periodMs: 30_000 });
  });
});

describe('start pill label (DESIGN 4.1)', () => {
  const games = [
    saved({ id: 'NEWONE', code: 'NEWONE' }),
    saved({ id: 'DONE', code: 'DONE', result: { winner: 'B', by: 'score', margin: 9 } }),
    saved({ id: 'ROOMX.1', code: 'ROOMX', mode: 'room' }),
  ];

  it('finds solo games by code, never room games', () => {
    expect(findGameForCode(games, 'NEWONE')?.id).toBe('NEWONE');
    expect(findGameForCode(games, 'ROOMX')).toBeUndefined();
    expect(findGameForCode(games, '')).toBeUndefined();
    expect(findGameForCode(games, 'NOPE')).toBeUndefined();
  });

  it('is START for a new code, RESUME for unfinished, REVIEW for finished', () => {
    const cpu: Opponent = { mode: 'computer', level: 5 };
    expect(startLabel(cpu, undefined)).toBe('start');
    expect(startLabel(cpu, findGameForCode(games, 'NEWONE'))).toBe('resume');
    expect(startLabel(cpu, findGameForCode(games, 'DONE'))).toBe('review');
  });

  it('is always START for a room', () => {
    expect(startLabel({ mode: 'room' }, findGameForCode(games, 'NEWONE'))).toBe('start');
    expect(startLabel({ mode: 'room' }, undefined)).toBe('start');
  });

  it('maps a saved game back to its opponent', () => {
    expect(opponentOfGame(saved({ mode: 'computer', level: 7 }))).toEqual({ mode: 'computer', level: 7 });
    expect(opponentOfGame(saved({ mode: 'local', level: undefined }))).toEqual({ mode: 'local' });
    expect(opponentOfGame(saved({ mode: 'room' }))).toEqual({ mode: 'room' });
    expect(opponentOfGame(saved({ mode: 'computer', level: undefined }))).toEqual({ mode: 'computer', level: 5 });
  });

  it('shows a saved game’s opponent, color, size, rules, handicap and clock', () => {
    expect(
      settingsOfGame(saved({ mode: 'computer', level: 3, color: 'B', size: 13, rules: 'territory', handicap: 3, tc: '10m5x30' })),
    ).toEqual({
      opponent: { mode: 'computer', level: 3 },
      color: 'B',
      size: 13,
      rules: 'territory',
      handicap: 3,
      clock: { kind: 'byoyomi', baseMs: 600_000, periods: 5, periodMs: 30_000 },
    });
    // Out-of-range values are clamped to what the pills can show.
    const odd = settingsOfGame(saved({ size: 9, handicap: 8, tc: 'junk' }));
    expect(odd.handicap).toBe(5);
    expect(odd.clock).toBeNull();
  });
});
