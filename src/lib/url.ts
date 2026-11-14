/**
 * The URL is the save (DESIGN 13.2, Ztyle chapter 11).
 *
 * `HashRouter`, state in the query string, always written with `replace: true`. This module holds
 * the pure codec for the query parameters, the share-link builders, and `useUrlParams`, a thin
 * wrapper over react-router's `useSearchParams` that writes only when something changed and keeps
 * the transient manual-signalling parameters `x` and `y` (owned by the room UI) untouched.
 *
 * | Param | Meaning                                              |
 * |-------|------------------------------------------------------|
 * | `s`   | game code                                            |
 * | `d`   | computer level 1–12                                  |
 * | `p`   | `1` = playing                                        |
 * | `o`   | opponent: `c` computer, `l` local, `r` room          |
 * | `w`   | this side: `B` or `W`                                |
 * | `t`   | time control, e.g. `5+7` or `20m5x30`                |
 * | `n`   | board size: `9`, `13`, `19`                          |
 * | `g`   | rules: `a` area (default, omitted), `t` territory    |
 * | `h`   | handicap stones: 0 or 2–9 (2–5 on 9×9)               |
 * | `m`   | moves (compact encoding, DESIGN 13.2)                |
 * | `r`   | result of a finished game, e.g. `B+4.5`, `W+R` (see below) |
 * | `x`,`y` | manual signalling offer and answer (transient, reserved) |
 *
 * `r` carries the result of a finished game, so a shared finished game opens in review. It is
 * written as SGF writes `RE` (`formatResult` in `lib/zengo.ts`): `B+4.5` (by score, the margin),
 * `W+R` (resignation), `B+T` (time). The `+` is percent-encoded in the query; a raw `+` that
 * arrives decoded as a space is accepted too.
 */
import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isValidCode, normalizeCode } from './codes';
import type { Color, Mode, Result, Rules, Size, TcString } from './types';
import { formatResult, formatTc, MAX_PLIES, maxHandicap, parseTc } from './zengo';

/** Parsed query parameters. Absent or invalid values are `undefined`. */
export interface UrlParams {
  /** `s`: game code, normalized (uppercase `0-9A-Z`, 1–8 characters). */
  code?: string;
  /** `d`: computer level 1–12. */
  level?: number;
  /** `p=1`: a game is open (vs. the start screen). */
  playing?: boolean;
  /** `o`: opponent mode. */
  mode?: Mode;
  /** `w`: this device's side (in game), or the color pill's fixed choice (start screen). `B` or `W`. */
  color?: Color;
  /** `t`: time control in its normalized text form, e.g. `5+7`, `20m5x30`. Absent = clock off. */
  tc?: TcString;
  /** `n`: board size. */
  size?: Size;
  /** `g`: rule set. `area` is the default and is not written. */
  rules?: Rules;
  /** `h`: handicap stones, 0 or 2–9 (at most 5 on 9×9). 0 is not written. */
  handicap?: number;
  /** `m`: compact move list (DESIGN 13.2). Never written for room games. */
  moves?: string;
  /** `r`: the result of a finished game. */
  result?: Result;
  /** `x`: manual signalling offer (transient; owned by the room UI). */
  offer?: string;
  /** `y`: manual signalling answer (transient; owned by the room UI). */
  answer?: string;
}

/** Parameter letters in the order they are written. */
export const PARAM_ORDER = ['s', 'd', 'p', 'o', 'w', 't', 'n', 'g', 'h', 'm', 'r', 'x', 'y'] as const;

const MODE_TO_PARAM: Record<Mode, string> = { computer: 'c', local: 'l', room: 'r' };
const PARAM_TO_MODE: Record<string, Mode> = { c: 'computer', l: 'local', r: 'room' };

/** Characters of the move encoding: SGF letters `a`–`s` and `t` (pass `tt`); decoded leniently. */
const MOVES_RE = /^[a-t]*$/;
/** Longest `m` accepted: two letters per ply, at most `MAX_PLIES` plies. A longer one is dropped. */
export const MAX_MOVES_LENGTH = 2 * MAX_PLIES;

/** `B+4.5` ← `{ winner: 'B', by: 'score', margin: 9 }`; `W+R`, `B+T`. Same as SGF's `RE`. */
export function formatEnd(r: Result): string {
  return formatResult(r);
}

/** Inverse of `formatEnd` (case-insensitive; a space for the `+`); undefined for anything else. */
export function parseEnd(s: string | null | undefined): Result | undefined {
  if (!s) return undefined;
  const m = /^([BW])[+ ](R|T|\d{1,3}(?:\.[05])?)$/i.exec(s.trim());
  if (!m) return undefined;
  const winner = m[1].toUpperCase() as Color;
  const v = m[2].toUpperCase();
  if (v === 'R') return { winner, by: 'resign' };
  if (v === 'T') return { winner, by: 'time' };
  return { winner, by: 'score', margin: Math.round(Number(v) * 2) };
}

/** Normalizes a time-control string (Fischer `5+0`, `15+10`, or byo-yomi `20m5x30`); undefined if it is not one. */
export function normalizeTc(s: string | null | undefined): TcString | undefined {
  const tc = parseTc(s ?? null);
  return tc ? (formatTc(tc) ?? undefined) : undefined;
}

/** Reads the query parameters. Invalid values are dropped, never thrown. */
export function parseUrl(search: URLSearchParams | string): UrlParams {
  const q = typeof search === 'string' ? new URLSearchParams(search.replace(/^\?/, '')) : search;
  const out: UrlParams = {};

  const s = q.get('s');
  if (s !== null) {
    const code = normalizeCode(s);
    if (isValidCode(code)) out.code = code;
  }

  const d = q.get('d');
  if (d !== null && /^\d{1,2}$/.test(d.trim())) {
    const level = Number(d.trim());
    if (level >= 1 && level <= 12) out.level = level;
  }

  if (q.get('p') === '1') out.playing = true;

  const o = q.get('o')?.trim().toLowerCase();
  if (o !== undefined && Object.prototype.hasOwnProperty.call(PARAM_TO_MODE, o)) out.mode = PARAM_TO_MODE[o];

  const w = q.get('w')?.trim().toUpperCase();
  if (w === 'B' || w === 'W') out.color = w;

  const tc = normalizeTc(q.get('t'));
  if (tc) out.tc = tc;

  const n = q.get('n')?.trim();
  if (n === '9' || n === '13' || n === '19') out.size = Number(n) as Size;

  const g = q.get('g')?.trim().toLowerCase();
  if (g === 'a') out.rules = 'area';
  else if (g === 't') out.rules = 'territory';

  const h = q.get('h')?.trim();
  if (h !== undefined && /^\d$/.test(h)) {
    const k = Number(h);
    if (k === 0 || (k >= 2 && k <= maxHandicap(out.size ?? 19))) out.handicap = k;
  }

  const m = q.get('m');
  if (m !== null && m.length <= MAX_MOVES_LENGTH && MOVES_RE.test(m)) out.moves = m;

  const result = parseEnd(q.get('r'));
  if (result) out.result = result;

  const x = q.get('x');
  if (x) out.offer = x;
  const y = q.get('y');
  if (y) out.answer = y;

  return out;
}

/**
 * Writes the query parameters in the fixed order `s d p o w t n g h m r x y`. Undefined values are
 * left out, and so are the defaults `g=a` (area) and `h=0`.
 */
export function serializeUrl(p: UrlParams): URLSearchParams {
  const q = new URLSearchParams();
  if (p.code) q.set('s', p.code);
  if (p.level !== undefined) q.set('d', String(p.level));
  if (p.playing) q.set('p', '1');
  if (p.mode) q.set('o', MODE_TO_PARAM[p.mode]);
  if (p.color) q.set('w', p.color);
  if (p.tc) q.set('t', p.tc);
  if (p.size) q.set('n', String(p.size));
  if (p.rules === 'territory') q.set('g', 't');
  if (p.handicap) q.set('h', String(p.handicap));
  // Room games never carry their moves (DESIGN 13.2).
  if (p.moves !== undefined && p.mode !== 'room') q.set('m', p.moves);
  if (p.result && p.mode !== 'room') q.set('r', formatEnd(p.result));
  if (p.offer) q.set('x', p.offer);
  if (p.answer) q.set('y', p.answer);
  return q;
}

/** `serializeUrl` as a string without the leading `?`. */
export function urlQuery(p: UrlParams): string {
  return serializeUrl(p).toString();
}

/* ---------------------------------------------------------------------------------------------- */
/* Share links                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/**
 * The app's base address without hash or query, e.g. `https://izzardry.github.io/zengo/`.
 * Pass a location for tests; defaults to `window.location`.
 */
export function appBaseUrl(loc?: Pick<Location, 'origin' | 'pathname'>): string {
  const l = loc ?? (typeof window !== 'undefined' ? window.location : undefined);
  if (!l) return '';
  return `${l.origin}${l.pathname}`;
}

/** A full HashRouter link: `<base>#/?<query>`. */
export function buildUrl(p: UrlParams, base: string = appBaseUrl()): string {
  const q = urlQuery(p);
  return q ? `${base}#/?${q}` : `${base}#/`;
}

/** The fields of a game that a share link carries. Matches `SavedGame` (DESIGN 12.1). */
export interface ShareableGame {
  code: string;
  mode: Mode;
  level?: number;
  color: Color;
  tc: TcString | null;
  /** Go settings (DESIGN 12.1); written as `n`, `g`, `h` (area and handicap 0 are left out). */
  size?: Size;
  rules?: Rules;
  handicap?: number;
  /** Compact move list. */
  moves: string;
  result?: Result;
}

/** Room invite: `?s=<CODE>&o=r` and nothing else, never moves or the key (DESIGN 13.2). */
export function roomShareUrl(code: string, base?: string): string {
  return buildUrl({ code, mode: 'room' }, base);
}

/**
 * A solo game, running or finished: the full state (code, level, side, clock, size, rules,
 * handicap, moves, and the result of a finished game) so the receiver gets it as a new game on
 * their device. A finished game opens in review. Clock times and dead-stone marks are not carried
 * (the per-ply ms and the scoring state stay home).
 */
export function soloShareUrl(g: ShareableGame, base?: string): string {
  return buildUrl(gameParams(g), base);
}

/** Alias of `soloShareUrl` for a finished game; it opens in review because it carries `r`. */
export const finishedShareUrl = soloShareUrl;

/** Share link for any stored or running game: room invite for rooms, the full URL otherwise. */
export function shareUrl(g: ShareableGame, base?: string): string {
  return g.mode === 'room' ? roomShareUrl(g.code, base) : soloShareUrl(g, base);
}

/** The address-bar parameters of an open game. Room games get no `m` and no `r`. */
export function gameParams(g: ShareableGame): UrlParams {
  return {
    code: g.code,
    level: g.mode === 'computer' ? g.level : undefined,
    playing: true,
    mode: g.mode,
    color: g.mode === 'local' ? undefined : g.color,
    tc: g.tc ?? undefined,
    size: g.size,
    rules: g.rules,
    handicap: g.handicap,
    moves: g.mode === 'room' ? undefined : g.moves,
    result: g.mode === 'room' ? undefined : g.result,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* React binding                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

/**
 * `useSearchParams` with Zengo's rules: `write(p)` serializes `p`, keeps the current `x` and `y`
 * unless `p` sets them, and navigates with `replace: true` only when the query actually changes.
 * `isOwnWrite(search)` tells a query this hook wrote itself from one that arrived from outside
 * (a pasted link, the back button).
 */
export function useUrlParams(): {
  params: UrlParams;
  search: string;
  write: (p: UrlParams) => void;
  isOwnWrite: (search: string) => boolean;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const searchRef = useRef(search);
  searchRef.current = search;
  /** The most recent queries this hook wrote (several can be in flight before the router re-renders). */
  const written = useRef<string[]>([]);

  const write = useCallback(
    (p: UrlParams) => {
      const current = parseUrl(searchRef.current);
      const next = urlQuery({
        ...p,
        offer: p.offer ?? current.offer,
        answer: p.answer ?? current.answer,
      });
      written.current = [...written.current.filter((w) => w !== next), next].slice(-16);
      if (next === searchRef.current) return;
      searchRef.current = next;
      setSearchParams(new URLSearchParams(next), { replace: true });
    },
    [setSearchParams],
  );

  const isOwnWrite = useCallback((s: string) => written.current.includes(s), []);

  return { params: parseUrl(searchParams), search, write, isOwnWrite };
}
