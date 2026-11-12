import { describe, expect, it } from 'vitest';
import {
  KEYS,
  MAX_GAMES,
  PREFIX,
  createGoStore,
  createStore,
  isGoSavedGame,
  memoryStorage,
  readClock,
  readColorChoice,
  readEngineBackend,
  readHandicap,
  readRules,
  readSize,
  store as defaultStore,
  writeClock,
  writeEngineBackend,
  writeHandicap,
  writeRules,
  writeSize,
} from './storage';
import type { Room, SavedGame } from './chessTypes';
import type { SavedGame as GoSavedGame } from './types';

function game(id: string, lastPlayedAt: number, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    id,
    code: id.split('.')[0],
    mode: 'local',
    color: 'w',
    tc: null,
    moves: 'Mc',
    ms: [1000],
    assisted: false,
    createdAt: lastPlayedAt,
    lastPlayedAt,
    ...extra,
  };
}

function room(code: string): Room {
  return { code, key: 'k3y', seat: 0, createdAt: 1, lastSeenAt: 1, score: [0, 0], games: [] };
}

describe('storage', () => {
  it('uses the zigo: prefix and JSON values', () => {
    const mem = memoryStorage();
    const s = createStore(mem);
    s.saveGame(game('K7QW2M', 5));
    s.setPref('helpers', false);
    s.setPref('color', 'random');
    const dump = mem.dump();
    expect(Object.keys(dump).sort()).toEqual([`${PREFIX}color`, `${PREFIX}games`, `${PREFIX}helpers`]);
    expect(dump['zigo:helpers']).toBe('false');
    expect(dump['zigo:color']).toBe('"random"');
    expect(JSON.parse(dump['zigo:games'])[0].id).toBe('K7QW2M');
  });

  it('keeps games newest first, upserts by id, and caps at 100', () => {
    const s = createStore(memoryStorage());
    s.saveGame(game('A', 1));
    s.saveGame(game('B', 3));
    s.saveGame(game('C', 2));
    expect(s.games().map((g) => g.id)).toEqual(['B', 'C', 'A']);
    s.saveGame(game('A', 4, { moves: 'McUk' }));
    expect(s.games().map((g) => g.id)).toEqual(['A', 'B', 'C']);
    expect(s.games()[0].moves).toBe('McUk');
    // Saving without bumping lastPlayedAt (the 15 s rule) does not reorder.
    s.saveGame(game('C', 2, { moves: 'Mc' }));
    expect(s.games().map((g) => g.id)).toEqual(['A', 'B', 'C']);
    for (let i = 0; i < 120; i++) s.saveGame(game(`G${i}`, 100 + i));
    const all = s.games();
    expect(all).toHaveLength(MAX_GAMES);
    expect(all[0].id).toBe('G119');
    expect(all.some((g) => g.id === 'A')).toBe(false);
  });

  it('deletes and restores games for the undo toast', () => {
    const s = createStore(memoryStorage());
    s.saveGame(game('A', 1));
    s.saveGame(game('B', 2));
    const removed = s.deleteGame('A');
    expect(removed?.id).toBe('A');
    expect(s.games().map((g) => g.id)).toEqual(['B']);
    expect(s.deleteGame('nope')).toBeUndefined();
    s.restoreGame(removed!);
    expect(s.games().map((g) => g.id)).toEqual(['B', 'A']);
  });

  it('stores room games by their own id', () => {
    const s = createStore(memoryStorage());
    s.saveGame(game('K7QW2M.1', 1, { mode: 'room', room: { n: 1, epoch: 0 } }));
    s.saveGame(game('K7QW2M.2', 2, { mode: 'room', room: { n: 2, epoch: 1 } }));
    expect(s.games().map((g) => g.id)).toEqual(['K7QW2M.2', 'K7QW2M.1']);
  });

  it('upserts, lists and deletes rooms', () => {
    const s = createStore(memoryStorage());
    s.saveRoom(room('AAAAAA'));
    s.saveRoom(room('BBBBBB'));
    s.saveRoom({ ...room('AAAAAA'), score: [2, 0], games: ['AAAAAA.1'] });
    expect(s.rooms()).toHaveLength(2);
    expect(s.rooms().find((r) => r.code === 'AAAAAA')?.score).toEqual([2, 0]);
    expect(s.deleteRoom('AAAAAA')?.games).toEqual(['AAAAAA.1']);
    expect(s.deleteRoom('AAAAAA')).toBeUndefined();
    expect(s.rooms().map((r) => r.code)).toEqual(['BBBBBB']);
  });

  it('reads preferences with fallbacks', () => {
    const mem = memoryStorage({
      'zigo:lang': 'de',
      'zigo:clock': '"5+0"',
      'zigo:helpers': 'true',
      'zigo:seating': '42',
      'zigo:opponent': '{"mode":"computer","level":7}',
    });
    const s = createStore(mem);
    expect(s.pref('lang', 'en')).toBe('de'); // bare string written by hand or older code
    expect(s.pref('clock', 'off')).toBe('5+0');
    expect(s.pref('helpers', false)).toBe(true);
    expect(s.pref('seating', 'face')).toBe('face'); // wrong type → fallback
    expect(s.pref('opponent', { mode: 'computer', level: 5 })).toEqual({ mode: 'computer', level: 7 });
    expect(s.pref('missing', 3)).toBe(3);
    expect(s.pref<string | null>('lang', null)).toBe(null); // not JSON and fallback not a string
    s.setPref('tutorial-seen', true);
    expect(s.pref('tutorial-seen', false)).toBe(true);
    s.setPref('tutorial-seen', undefined);
    expect(mem.getItem('zigo:tutorial-seen')).toBeNull();
  });

  it('survives corrupt data', () => {
    const s = createStore(
      memoryStorage({
        'zigo:games': '{not json',
        'zigo:rooms': '{"code":"X"}',
      }),
    );
    expect(s.games()).toEqual([]);
    expect(s.rooms()).toEqual([]);
    const mixed = createStore(
      memoryStorage({
        'zigo:games': JSON.stringify([game('OK', 1), { id: 'broken' }, null, 7]),
        'zigo:rooms': JSON.stringify([room('R1'), { code: 'R2' }]),
      }),
    );
    expect(mixed.games().map((g) => g.id)).toEqual(['OK']);
    expect(mixed.rooms().map((r) => r.code)).toEqual(['R1']);
  });

  it('never throws when storage is missing or throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    for (const source of [throwing, null, () => throwing, () => { throw new Error('denied'); }]) {
      const s = createStore(source);
      expect(s.games()).toEqual([]);
      expect(s.rooms()).toEqual([]);
      expect(() => s.saveGame(game('A', 1))).not.toThrow();
      expect(() => s.saveRoom(room('A'))).not.toThrow();
      expect(s.deleteGame('A')).toBeUndefined();
      expect(s.deleteRoom('A')).toBeUndefined();
      expect(() => s.restoreGame(game('A', 1))).not.toThrow();
      expect(s.pref('helpers', true)).toBe(true);
      expect(() => s.setPref('helpers', false)).not.toThrow();
      expect(() => s.setPref('helpers', undefined)).not.toThrow();
    }
  });

  it('the default store works over localStorage', () => {
    // Node 26 defines its own global localStorage getter (undefined without --localstorage-file),
    // which shadows jsdom's in Vitest. Install a memory storage for this test and put the original back.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const mem = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
    try {
      defaultStore.setPref('color', 'b');
      expect(mem.getItem('zigo:color')).toBe('"b"');
      expect(defaultStore.pref('color', 'random')).toBe('b');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('Go store and preferences (DESIGN 12.1, 13.1)', () => {
  function goGame(id: string, lastPlayedAt: number, extra: Partial<GoSavedGame> = {}): GoSavedGame {
    return {
      id,
      code: id.split('.')[0],
      mode: 'local',
      color: 'B',
      size: 9,
      rules: 'area',
      handicap: 0,
      tc: null,
      moves: 'eecc',
      ms: [1000, 900],
      assisted: false,
      createdAt: lastPlayedAt,
      lastPlayedAt,
      ...extra,
    };
  }

  it('lists the new keys', () => {
    expect(KEYS.size).toBe('size');
    expect(KEYS.rules).toBe('rules');
    expect(KEYS.handicap).toBe('handicap');
    expect(KEYS.engineBackend).toBe('engine-backend');
  });

  it('stores Go games with scoring and result, newest first, capped at 100', () => {
    const s = createGoStore(memoryStorage());
    const scoring = { round: 1 as const, rev: 2, dead: ['cc'], accepted: [2, 2] as [number, number] };
    s.saveGame(goGame('A', 1, { scoring, result: { winner: 'B', by: 'score', margin: 9 } }));
    s.saveGame(goGame('B', 2, { size: 19, rules: 'territory', handicap: 4, tc: '20m5x30' }));
    expect(s.games().map((g) => g.id)).toEqual(['B', 'A']);
    expect(s.games()[1].scoring).toEqual(scoring);
    expect(s.games()[0].tc).toBe('20m5x30');
    for (let i = 0; i < 110; i++) s.saveGame(goGame(`G${i}`, 100 + i));
    expect(s.games()).toHaveLength(MAX_GAMES);
    expect(s.deleteGame('G109')?.id).toBe('G109');
  });

  it('drops stored games that are not Go games', () => {
    const mem = memoryStorage({
      'zigo:games': JSON.stringify([goGame('OK', 1), game('CHESS', 2), { ...goGame('BAD', 3), size: 7 }, null]),
    });
    expect(createGoStore(mem).games().map((g) => g.id)).toEqual(['OK']);
    expect(isGoSavedGame(goGame('X', 1))).toBe(true);
    expect(isGoSavedGame({ ...goGame('X', 1), rules: 'chinese' })).toBe(false);
  });

  it('reads and writes size, rules, handicap per size, clock per size and the engine backend', () => {
    const mem = memoryStorage();
    const s = createGoStore(mem);
    expect(readSize(s)).toBe(9);
    expect(readRules(s)).toBe('area');
    expect(readHandicap(s, 13)).toBe(0);
    expect(readClock(s, 19)).toBeNull();
    expect(readClock(s, 19, '5+7')).toBe('5+7');
    expect(readEngineBackend(s)).toBeNull();
    expect(readColorChoice(s)).toBe('random');

    writeSize(s, 19);
    writeRules(s, 'territory');
    writeHandicap(s, 13, 4);
    writeHandicap(s, 9, 7); // clamped to 5
    writeClock(s, 19, '20m 5x30s');
    writeClock(s, 9, null);
    writeEngineBackend(s, 'wasm');
    s.setPref('color', 'W');

    expect(mem.dump()).toMatchObject({
      'zigo:size': '19',
      'zigo:rules': '"territory"',
      'zigo:handicap': '{"9":5,"13":4}',
      'zigo:clock': '{"9":null,"19":"20m5x30"}',
      'zigo:engine-backend': '"wasm"',
    });
    expect(readSize(s)).toBe(19);
    expect(readRules(s)).toBe('territory');
    expect(readHandicap(s, 13)).toBe(4);
    expect(readHandicap(s, 9)).toBe(5);
    expect(readHandicap(s, 19)).toBe(0);
    expect(readClock(s, 19)).toBe('20m5x30');
    expect(readClock(s, 9, '2+7')).toBeNull(); // stored as off
    expect(readClock(s, 13, '3+7')).toBe('3+7'); // never set
    expect(readEngineBackend(s)).toBe('wasm');
    expect(readColorChoice(s)).toBe('W');
    writeEngineBackend(s, null);
    expect(mem.getItem('zigo:engine-backend')).toBeNull();
  });

  it('falls back on corrupt or chess-era preference values', () => {
    const s = createGoStore(
      memoryStorage({
        'zigo:size': '"13"',
        'zigo:rules': '"chinese"',
        'zigo:handicap': '[1,2]',
        'zigo:clock': '"5+0"',
        'zigo:engine-backend': '"cuda"',
        'zigo:color': '"b"',
      }),
    );
    expect(readSize(s)).toBe(13); // a numeric string is accepted
    expect(readRules(s)).toBe('area');
    expect(readHandicap(s, 19)).toBe(0);
    expect(readClock(s, 9, '2+7')).toBe('2+7');
    expect(readEngineBackend(s)).toBeNull();
    expect(readColorChoice(s)).toBe('random');
    const junk = createGoStore(memoryStorage({ 'zigo:clock': '{"9":"fast","13":42}', 'zigo:size': '7' }));
    expect(readClock(junk, 9, null)).toBeNull();
    expect(readClock(junk, 13, '3+7')).toBe('3+7');
    expect(readSize(junk)).toBe(9);
  });
});
