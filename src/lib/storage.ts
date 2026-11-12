/**
 * Local persistence (DESIGN 13.1, 12.1, Ztyle chapter 11).
 *
 * Keys are `zigo:<key>`. Values are JSON. Every read and write is wrapped in try/catch: private
 * mode, a full quota or corrupt data never break the app; reads fall back to defaults.
 *
 * `createStore` / `store` hold Go's `SavedGame` (DESIGN 12.1); stored entries of any other shape
 * (for example games written by an older build) are dropped on read. The `read…` / `write…`
 * helpers below cover the preference keys whose values need validation.
 */
import type { ColorChoice, Result, Room, Rules, SavedGame, Scoring, Size, Store, TcString } from './types';
import { formatTc, normalizeHandicap, parseTc } from './zigo';

/** The key prefix of every stored value. */
export const PREFIX = 'zigo:';

/** Most games kept (DESIGN 12.1). */
export const MAX_GAMES = 100;

/** Storage keys of DESIGN 13.1, without prefix. */
export const KEYS = {
  games: 'games',
  rooms: 'rooms',
  opponent: 'opponent',
  color: 'color',
  size: 'size',
  rules: 'rules',
  handicap: 'handicap',
  clock: 'clock',
  helpers: 'helpers',
  seating: 'seating',
  engineBackend: 'engine-backend',
  lang: 'lang',
  tutorialSeen: 'tutorial-seen',
  donationShown: 'donation-shown',
  installDismissed: 'install-dismissed',
} as const;

/** The part of the Web Storage API the store uses. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A storage, or a function that returns one (evaluated on every access, inside try/catch). */
export type StorageSource = StorageLike | null | undefined | (() => StorageLike | null | undefined);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isResult = (v: unknown): v is Result =>
  isObj(v) &&
  (v.winner === 'B' || v.winner === 'W') &&
  (v.by === 'score' || v.by === 'resign' || v.by === 'time') &&
  (v.margin === undefined || typeof v.margin === 'number');

const isScoring = (v: unknown): v is Scoring =>
  isObj(v) &&
  (v.round === 1 || v.round === 2) &&
  typeof v.rev === 'number' &&
  Array.isArray(v.dead) &&
  v.dead.every((p) => typeof p === 'string') &&
  Array.isArray(v.accepted) &&
  v.accepted.length === 2;

/** Shape check for a stored Go game (DESIGN 12.1); drops entries that would crash the UI. */
export function isSavedGame(v: unknown): v is SavedGame {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.code === 'string' &&
    (v.mode === 'computer' || v.mode === 'local' || v.mode === 'room') &&
    (v.color === 'B' || v.color === 'W') &&
    (v.size === 9 || v.size === 13 || v.size === 19) &&
    (v.rules === 'area' || v.rules === 'territory') &&
    typeof v.handicap === 'number' &&
    typeof v.moves === 'string' &&
    Array.isArray(v.ms) &&
    typeof v.createdAt === 'number' &&
    typeof v.lastPlayedAt === 'number' &&
    (v.result === undefined || isResult(v.result)) &&
    (v.scoring === undefined || isScoring(v.scoring))
  );
}

/** Alias of `isSavedGame` (the phase-0 name). */
export const isGoSavedGame = isSavedGame;

/** Shape check for a stored room record. */
export function isRoom(v: unknown): v is Room {
  return (
    isObj(v) &&
    typeof v.code === 'string' &&
    typeof v.key === 'string' &&
    (v.seat === 0 || v.seat === 1) &&
    Array.isArray(v.score) &&
    v.score.length === 2 &&
    Array.isArray(v.games)
  );
}

interface Stamped {
  id: string;
  lastPlayedAt: number;
}

/** Newest `lastPlayedAt` first; stable for equal stamps. */
function sortGames<G extends Stamped>(games: G[]): G[] {
  return games
    .map((g, i) => [g, i] as const)
    .sort((a, b) => b[0].lastPlayedAt - a[0].lastPlayedAt || a[1] - b[1])
    .map(([g]) => g);
}

/** The `Store` (DESIGN 12.1, 13.1) over any Storage-like object (tests pass an in-memory one). */
export function createStore(source: StorageSource): Store {
  return createStoreOf(source, isSavedGame);
}

/** Alias of `createStore` (the phase-0 name). */
export const createGoStore = createStore;

function createStoreOf(source: StorageSource, isGame: (v: unknown) => v is SavedGame): Store {
  const storage = (): StorageLike | null => {
    try {
      const s = typeof source === 'function' ? source() : source;
      return s ?? null;
    } catch {
      return null;
    }
  };

  const readRaw = (key: string): string | null => {
    try {
      return storage()?.getItem(PREFIX + key) ?? null;
    } catch {
      return null;
    }
  };

  const write = (key: string, value: unknown): void => {
    try {
      storage()?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* quota or private mode: keep running without persistence */
    }
  };

  const readList = <T>(key: string, guard: (v: unknown) => v is T): T[] => {
    const raw = readRaw(key);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(guard) : [];
    } catch {
      return [];
    }
  };

  const writeGames = (games: SavedGame[]) => write(KEYS.games, sortGames(games).slice(0, MAX_GAMES));

  return {
    games: () => sortGames(readList(KEYS.games, isGame)),

    saveGame(g) {
      const rest = readList(KEYS.games, isGame).filter((x) => x.id !== g.id);
      writeGames([g, ...rest]);
    },

    deleteGame(id) {
      const all = readList(KEYS.games, isGame);
      const found = all.find((x) => x.id === id);
      if (!found) return undefined;
      writeGames(all.filter((x) => x.id !== id));
      return found;
    },

    restoreGame(g) {
      const rest = readList(KEYS.games, isGame).filter((x) => x.id !== g.id);
      writeGames([g, ...rest]);
    },

    rooms: () => readList(KEYS.rooms, isRoom),

    saveRoom(r) {
      const rest = readList(KEYS.rooms, isRoom).filter((x) => x.code !== r.code);
      write(KEYS.rooms, [r, ...rest]);
    },

    deleteRoom(code) {
      const all = readList(KEYS.rooms, isRoom);
      const found = all.find((x) => x.code === code);
      if (!found) return undefined;
      write(
        KEYS.rooms,
        all.filter((x) => x.code !== code),
      );
      return found;
    },

    pref<T>(key: string, fallback: T): T {
      const raw = readRaw(key);
      if (raw === null) return fallback;
      try {
        const v: unknown = JSON.parse(raw);
        if (v === null || v === undefined) return fallback;
        // A value of another type than the fallback is treated as missing (null fallbacks accept anything).
        if (fallback !== null && fallback !== undefined && typeof v !== typeof fallback) return fallback;
        return v as T;
      } catch {
        // Not JSON: a bare string written by older code or by hand.
        return typeof fallback === 'string' ? (raw as T) : fallback;
      }
    },

    setPref<T>(key: string, value: T): void {
      if (value === undefined) {
        try {
          storage()?.removeItem(PREFIX + key);
        } catch {
          /* ignore */
        }
        return;
      }
      write(key, value);
    },
  };
}

const browserStorage = () => (typeof localStorage === 'undefined' ? null : localStorage);

/** The app's store over `window.localStorage` (looked up lazily; absent storage reads as empty). */
export const store: Store = createStore(browserStorage);

/** Alias of `store` (the phase-0 name). */
export const goStore: Store = store;

/* ---------------------------------------------------------------------------------------------- */
/* Go preferences (DESIGN 13.1)                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/** What the preference helpers need. */
export type PrefStore = Pick<Store, 'pref' | 'setPref'>;

/** Engine backend remembered after the WebGPU probe (`zigo:engine-backend`). */
export type EngineBackend = 'webgpu' | 'wasm';

/** A value per board size, as `zigo:handicap` and `zigo:clock` store it: `{ "9": …, "13": …, "19": … }`. */
export type PerSize<T> = Partial<Record<`${Size}`, T>>;

const isSize = (v: unknown): v is Size => v === 9 || v === 13 || v === 19;

/** `zigo:size`; default 9 (DESIGN 4.1). */
export function readSize(s: PrefStore): Size {
  const v = s.pref<unknown>(KEYS.size, null);
  const n = typeof v === 'string' ? Number(v) : v;
  return isSize(n) ? n : 9;
}

export function writeSize(s: PrefStore, size: Size): void {
  s.setPref(KEYS.size, size);
}

/** `zigo:rules`; default area. */
export function readRules(s: PrefStore): Rules {
  return s.pref<unknown>(KEYS.rules, null) === 'territory' ? 'territory' : 'area';
}

export function writeRules(s: PrefStore, rules: Rules): void {
  s.setPref(KEYS.rules, rules);
}

function readPerSize(s: PrefStore, key: string): PerSize<unknown> {
  const v = s.pref<unknown>(key, null);
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as PerSize<unknown>) : {};
}

/** `zigo:handicap` for one size: 0 or 2..max (normalized); default 0. */
export function readHandicap(s: PrefStore, size: Size): number {
  const v = readPerSize(s, KEYS.handicap)[`${size}`];
  return typeof v === 'number' ? normalizeHandicap(size, v) : 0;
}

/** Writes one size's handicap, keeping the others. */
export function writeHandicap(s: PrefStore, size: Size, n: number): void {
  s.setPref(KEYS.handicap, { ...readPerSize(s, KEYS.handicap), [`${size}`]: normalizeHandicap(size, n) });
}

/**
 * `zigo:clock` for one size: a normalized time control (`5+7`, `20m5x30`), null for off, or
 * `fallback` when nothing valid is stored for that size (e.g. an older single string).
 */
export function readClock(s: PrefStore, size: Size, fallback: TcString | null = null): TcString | null {
  const per = readPerSize(s, KEYS.clock);
  if (!(`${size}` in per)) return fallback;
  const v = per[`${size}`];
  if (v === null || v === 'off') return null;
  return typeof v === 'string' ? (formatTc(parseTc(v)) ?? fallback) : fallback;
}

/** Writes one size's time control (null = off), keeping the others. */
export function writeClock(s: PrefStore, size: Size, tc: TcString | null): void {
  const norm = tc === null ? null : formatTc(parseTc(tc));
  s.setPref(KEYS.clock, { ...readPerSize(s, KEYS.clock), [`${size}`]: norm });
}

/** `zigo:engine-backend`, or null when not probed yet. */
export function readEngineBackend(s: PrefStore): EngineBackend | null {
  const v = s.pref<unknown>(KEYS.engineBackend, null);
  return v === 'webgpu' || v === 'wasm' ? v : null;
}

export function writeEngineBackend(s: PrefStore, b: EngineBackend | null): void {
  s.setPref(KEYS.engineBackend, b ?? undefined);
}

/** `zigo:color` as Go's color pill reads it: `random`, `B` or `W` (default random). */
export function readColorChoice(s: PrefStore): ColorChoice {
  const v = s.pref<unknown>(KEYS.color, null);
  return v === 'B' || v === 'W' ? v : 'random';
}

export function writeColorChoice(s: PrefStore, c: ColorChoice): void {
  s.setPref(KEYS.color, c === 'B' || c === 'W' ? c : 'random');
}

/** An in-memory Storage-like object for tests and for environments without storage. */
export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    dump: () => Object.fromEntries(data),
  };
}

export default store;
