/**
 * Remembered start-screen choices (DESIGN 4.1, 13.1). Reads are validated and fall back to the
 * first-run defaults.
 *
 * Stored shapes (JSON, through `lib/storage.ts`):
 * - `zigo:opponent` → the `Opponent` object, e.g. `{"mode":"computer","level":5}`
 * - `zigo:color`    → `"random"` / `"B"` / `"W"`
 * - `zigo:size`     → `9` / `13` / `19`
 * - `zigo:rules`    → `"area"` / `"territory"`
 * - `zigo:handicap` → `{"9": 0, "13": 3, "19": 0}`
 * - `zigo:clock`    → `{"9": "2+7", "13": null, "19": "20m5x30"}` (null = off)
 */
import { useCallback, useState } from 'react';
import {
  goStore,
  readClock,
  readColorChoice,
  readHandicap,
  readRules,
  readSize,
  writeClock,
  writeHandicap,
  writeRules,
  writeSize,
  type PrefStore,
} from '@/lib/storage';
import type { ColorChoice, Opponent, Rules, Size, TimeControl } from '@/lib/types';
import { formatTc, normalizeHandicap, parseTc } from '@/lib/zigo';
import { DEFAULT_OPPONENT, OPPONENTS, SIZE_CHOICES, isColorChoice, isOpponent, isRules, isSize, opponentIndex } from './options';

export function readOpponent(s: PrefStore = goStore): Opponent {
  const v = s.pref<unknown>('opponent', null);
  return isOpponent(v) ? OPPONENTS[opponentIndex(v)] : DEFAULT_OPPONENT;
}

export function readColor(s: PrefStore = goStore): ColorChoice {
  return readColorChoice(s);
}

/** The remembered value of every size. */
export type PerSizeValues<T> = Readonly<Record<Size, T>>;

const perSize = <T,>(f: (size: Size) => T): PerSizeValues<T> =>
  ({ 9: f(9), 13: f(13), 19: f(19) }) as PerSizeValues<T>;

/** Remembered clock per size (`zigo:clock`); off where nothing valid is stored. */
export function readClocks(s: PrefStore = goStore): PerSizeValues<TimeControl> {
  return perSize((size) => parseTc(readClock(s, size, null)));
}

/** Remembered handicap per size (`zigo:handicap`); 0 where nothing valid is stored. */
export function readHandicaps(s: PrefStore = goStore): PerSizeValues<number> {
  return perSize((size) => readHandicap(s, size));
}

export interface StartPrefs {
  opponent: Opponent;
  setOpponent: (o: Opponent) => void;
  color: ColorChoice;
  setColor: (c: ColorChoice) => void;
  size: Size;
  setSize: (s: Size) => void;
  rules: Rules;
  setRules: (r: Rules) => void;
  /** Handicap of every size. */
  handicaps: PerSizeValues<number>;
  /** Handicap of the selected size. */
  handicap: number;
  /** Sets the handicap of `size` (default: the selected size). */
  setHandicap: (n: number, size?: Size) => void;
  /** Clock of every size. */
  clocks: PerSizeValues<TimeControl>;
  /** Clock of the selected size. */
  clock: TimeControl;
  /** Sets the clock of `size` (default: the selected size). */
  setClock: (tc: TimeControl, size?: Size) => void;
}

/**
 * The remembered selector values with setters that persist immediately.
 * Pass a store in tests; the app uses the default `zigo:` localStorage store.
 */
export function useStartPrefs(s: PrefStore = goStore): StartPrefs {
  const [opponent, setOpponentState] = useState<Opponent>(() => readOpponent(s));
  const [color, setColorState] = useState<ColorChoice>(() => readColor(s));
  const [size, setSizeState] = useState<Size>(() => readSize(s));
  const [rules, setRulesState] = useState<Rules>(() => readRules(s));
  const [handicaps, setHandicaps] = useState<PerSizeValues<number>>(() => readHandicaps(s));
  const [clocks, setClocks] = useState<PerSizeValues<TimeControl>>(() => readClocks(s));

  const setOpponent = useCallback(
    (o: Opponent) => {
      if (!isOpponent(o)) return;
      const v = OPPONENTS[opponentIndex(o)];
      setOpponentState(v);
      s.setPref('opponent', v);
    },
    [s],
  );

  const setColor = useCallback(
    (c: ColorChoice) => {
      if (!isColorChoice(c)) return;
      setColorState(c);
      s.setPref('color', c);
    },
    [s],
  );

  const setSize = useCallback(
    (v: Size) => {
      if (!isSize(v)) return;
      setSizeState(v);
      writeSize(s, v);
    },
    [s],
  );

  const setRules = useCallback(
    (r: Rules) => {
      if (!isRules(r)) return;
      setRulesState(r);
      writeRules(s, r);
    },
    [s],
  );

  const setHandicap = useCallback(
    (n: number, at?: Size) => {
      const target = at ?? size;
      if (!SIZE_CHOICES.includes(target)) return;
      const v = normalizeHandicap(target, n);
      setHandicaps((prev) => ({ ...prev, [target]: v }));
      writeHandicap(s, target, v);
    },
    [s, size],
  );

  const setClock = useCallback(
    (tc: TimeControl, at?: Size) => {
      const target = at ?? size;
      if (!SIZE_CHOICES.includes(target)) return;
      // Normalized through the text form, as it is stored.
      const v = parseTc(formatTc(tc));
      setClocks((prev) => ({ ...prev, [target]: v }));
      writeClock(s, target, formatTc(v));
    },
    [s, size],
  );

  return {
    opponent,
    setOpponent,
    color,
    setColor,
    size,
    setSize,
    rules,
    setRules,
    handicaps,
    handicap: handicaps[size],
    setHandicap,
    clocks,
    clock: clocks[size],
    setClock,
  };
}
