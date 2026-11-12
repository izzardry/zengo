/**
 * Start-screen values and their cycling rules (DESIGN 4.1, 8.2, 11). Pure, no React.
 *
 * - Opponent stepper: ROOM · TWO PLAYERS · COMPUTER 1 … COMPUTER 12 (ends do not wrap).
 * - Color pill: random → black → white → random; hold: handicap 0, 2 … 9 (2 … 5 on 9×9).
 * - Size pill: 9×9 → 13×13 → 19×19 → 9×9; hold: rules, area or territory (`· JP`).
 * - Clock pill: the presets of the current size (DESIGN 11), then off again.
 * - Start pill label: START / RESUME / REVIEW from the code's saved game.
 */
import type { ColorChoice, Opponent, Rules, SavedGame, Size, TcString, TimeControl } from '@/lib/types';
import { maxHandicap, normalizeHandicap, parseTc } from '@/lib/zigo';

/* ---------------------------------------------------------------------------------------------- */
/* Opponent                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** Lowest and highest computer level (DESIGN 10.2). */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 12;
/** First-run default: COMPUTER 5 MEDIUM (DESIGN 4.1). */
export const DEFAULT_LEVEL = 5;

export const DEFAULT_OPPONENT: Opponent = Object.freeze({ mode: 'computer', level: DEFAULT_LEVEL });

/** Every stepper value in order. */
export const OPPONENTS: readonly Opponent[] = Object.freeze([
  Object.freeze({ mode: 'room' }) as Opponent,
  Object.freeze({ mode: 'local' }) as Opponent,
  ...Array.from({ length: MAX_LEVEL }, (_, i) => Object.freeze({ mode: 'computer', level: i + 1 }) as Opponent),
]);

/** True for a well-formed opponent value (guards what comes out of storage). */
export function isOpponent(v: unknown): v is Opponent {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.mode === 'room' || o.mode === 'local') return true;
  return (
    o.mode === 'computer' &&
    typeof o.level === 'number' &&
    Number.isInteger(o.level) &&
    o.level >= MIN_LEVEL &&
    o.level <= MAX_LEVEL
  );
}

/** Position of `o` in `OPPONENTS` (0 = ROOM). Out-of-range levels are clamped. */
export function opponentIndex(o: Opponent): number {
  if (o.mode === 'room') return 0;
  if (o.mode === 'local') return 1;
  const level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(o.level)));
  return 1 + level;
}

/** The value `delta` steps away from `o`, clamped to the ends (no wrap, Ztyle stepper). */
export function stepOpponent(o: Opponent, delta: number): Opponent {
  const i = Math.min(OPPONENTS.length - 1, Math.max(0, opponentIndex(o) + delta));
  return OPPONENTS[i];
}

export function canStepOpponent(o: Opponent, delta: number): boolean {
  const i = opponentIndex(o) + delta;
  return i >= 0 && i < OPPONENTS.length;
}

export function sameOpponent(a: Opponent, b: Opponent): boolean {
  return opponentIndex(a) === opponentIndex(b);
}

/* ---------------------------------------------------------------------------------------------- */
/* Color and handicap                                                                              */
/* ---------------------------------------------------------------------------------------------- */

/** Cycle order of the color pill: Black moves first in Go, so black comes before white. */
export const COLOR_CHOICES: readonly ColorChoice[] = Object.freeze(['random', 'B', 'W'] as const);
export const DEFAULT_COLOR: ColorChoice = 'random';

export function isColorChoice(v: unknown): v is ColorChoice {
  return v === 'random' || v === 'B' || v === 'W';
}

/** random → black → white → random. */
export function nextColor(c: ColorChoice): ColorChoice {
  const i = COLOR_CHOICES.indexOf(c);
  return COLOR_CHOICES[(i + 1) % COLOR_CHOICES.length];
}

/** The handicap dial's values for a size: 0 (none), then 2 … max (DESIGN 4.1, 8.2). */
export function handicapOptions(size: Size): number[] {
  return [0, ...Array.from({ length: maxHandicap(size) - 1 }, (_, i) => i + 2)];
}

/* ---------------------------------------------------------------------------------------------- */
/* Size and rules                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

export const SIZE_CHOICES: readonly Size[] = Object.freeze([9, 13, 19] as Size[]);
export const DEFAULT_SIZE: Size = 9;

export function isSize(v: unknown): v is Size {
  return v === 9 || v === 13 || v === 19;
}

/** 9×9 → 13×13 → 19×19 → 9×9. */
export function nextSize(s: Size): Size {
  const i = SIZE_CHOICES.indexOf(s);
  return SIZE_CHOICES[(i + 1) % SIZE_CHOICES.length];
}

/** The rules dial's values: area (default) and territory. */
export const RULES_CHOICES: readonly Rules[] = Object.freeze(['area', 'territory'] as Rules[]);
export const DEFAULT_RULES: Rules = 'area';

export function isRules(v: unknown): v is Rules {
  return v === 'area' || v === 'territory';
}

/** `9×9`, or `9×9 · JP` for territory rules (DESIGN 4.1). Not translated. */
export function sizeLabel(size: Size, rules: Rules): string {
  const s = `${size}×${size}`;
  return rules === 'territory' ? `${s} · JP` : s;
}

/** Komi of a rule set without handicap, as shown on the rules dial (`7.5`, `6.5`). */
export function rulesKomi(rules: Rules): string {
  return rules === 'territory' ? '6.5' : '7.5';
}

/* ---------------------------------------------------------------------------------------------- */
/* Clock                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const fischer = (min: number, inc: number): TimeControl =>
  Object.freeze({ kind: 'fischer', baseMs: min * 60_000, incMs: inc * 1000 });
const byoyomi = (min: number, periods: number, sec: number): TimeControl =>
  Object.freeze({ kind: 'byoyomi', baseMs: min * 60_000, periods, periodMs: sec * 1000 });

/** The clock pill's presets per size in cycle order; `null` = off (DESIGN 11). */
export const CLOCK_PRESETS: Readonly<Record<Size, readonly TimeControl[]>> = Object.freeze({
  9: Object.freeze([null, fischer(2, 7), fischer(3, 10), byoyomi(5, 5, 30)]),
  13: Object.freeze([null, fischer(3, 7), fischer(5, 10), byoyomi(10, 5, 30)]),
  19: Object.freeze([null, fischer(5, 7), fischer(10, 10), byoyomi(20, 5, 30), byoyomi(30, 5, 60)]),
});

export function sameClock(a: TimeControl, b: TimeControl): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'fischer') return b.kind === 'fischer' && a.baseMs === b.baseMs && a.incMs === b.incMs;
  return b.kind === 'byoyomi' && a.baseMs === b.baseMs && a.periods === b.periods && a.periodMs === b.periodMs;
}

/** True when `t` is one of the size's cycling presets (false for a custom dial value). */
export function isPresetClock(size: Size, t: TimeControl): boolean {
  return CLOCK_PRESETS[size].some((p) => sameClock(p, t));
}

/** Overtime of a time control in ms, for ordering: the increment, or all periods together. */
function extraMs(t: NonNullable<TimeControl>): number {
  return t.kind === 'fischer' ? t.incMs : t.periods * t.periodMs;
}

/**
 * The next preset of `size` after `t`. A custom value (from the dial, or a preset of another size)
 * moves to the first preset that is longer (by main time, then overtime), or back to off.
 */
export function nextClock(size: Size, t: TimeControl): TimeControl {
  const presets = CLOCK_PRESETS[size];
  const i = presets.findIndex((p) => sameClock(p, t));
  if (i >= 0) return presets[(i + 1) % presets.length];
  if (t === null) return presets[1];
  const later = presets.find(
    (p) => p !== null && (p.baseMs > t.baseMs || (p.baseMs === t.baseMs && extraMs(p) > extraMs(t))),
  );
  return later ?? null;
}

const num = (v: number) => String(Math.round(v * 100) / 100);

/**
 * The pill's text of a time control (DESIGN 11): `2+7`, `5m 5×30s`; null for off (the pill
 * translates "off"). Units are not translated.
 */
export function clockLabel(t: TimeControl): string | null {
  if (!t) return null;
  if (t.kind === 'fischer') return `${num(t.baseMs / 60_000)}+${num(t.incMs / 1000)}`;
  return `${num(t.baseMs / 60_000)}m ${t.periods}×${num(t.periodMs / 1000)}s`;
}

/** The custom dial's Fischer value: `5`, `3` → `5+3`. */
export function fischerTc(minutes: number, incrementSeconds: number): TcString {
  return `${minutes}+${incrementSeconds}`;
}

/** The custom dial's byo-yomi value: `20`, `5`, `30` → `20m5x30`. */
export function byoyomiTc(minutes: number, periods: number, periodSeconds: number): TcString {
  return `${minutes}m${periods}x${periodSeconds}`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Start pill and saved games                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** What the one primary action does (DESIGN 4.1 table). */
export type StartLabel = 'start' | 'resume' | 'review';

/**
 * The local solo game a code refers to, if any: `SavedGame.id === code` and not a room game.
 * Room games are stored as `${code}.${n}` and never match (a room code always starts or joins).
 */
export function findGameForCode(games: readonly SavedGame[], code: string): SavedGame | undefined {
  if (!code) return undefined;
  return games.find((g) => g.id === code && g.mode !== 'room');
}

/**
 * Label of the Start pill. Opponent = Room → START (create or join, DESIGN 9.2); a code with an
 * unfinished local game → RESUME; with a finished one → REVIEW; a new code → START.
 */
export function startLabel(opponent: Opponent, saved: SavedGame | undefined): StartLabel {
  if (opponent.mode === 'room') return 'start';
  if (!saved) return 'start';
  return saved.result ? 'review' : 'resume';
}

/** The opponent a saved game was played against (for the dimmed selectors on RESUME / REVIEW). */
export function opponentOfGame(g: SavedGame): Opponent {
  if (g.mode === 'room') return OPPONENTS[0];
  if (g.mode === 'local') return OPPONENTS[1];
  const level = typeof g.level === 'number' ? g.level : DEFAULT_LEVEL;
  return OPPONENTS[opponentIndex({ mode: 'computer', level })];
}

/** Everything the start screen's selectors show. */
export interface StartSettings {
  readonly opponent: Opponent;
  readonly color: ColorChoice;
  readonly size: Size;
  readonly rules: Rules;
  readonly handicap: number;
  readonly clock: TimeControl;
}

/** The settings of a saved game, shown dimmed while the code refers to it (DESIGN 4.1). */
export function settingsOfGame(g: SavedGame): StartSettings {
  const size: Size = isSize(g.size) ? g.size : DEFAULT_SIZE;
  return {
    opponent: opponentOfGame(g),
    color: isColorChoice(g.color) ? g.color : DEFAULT_COLOR,
    size,
    rules: isRules(g.rules) ? g.rules : DEFAULT_RULES,
    handicap: normalizeHandicap(size, g.handicap),
    clock: parseTc(g.tc),
  };
}
