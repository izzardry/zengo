import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  appBaseUrl,
  buildUrl,
  finishedShareUrl,
  formatEnd,
  gameParams,
  parseEnd,
  parseUrl,
  roomShareUrl,
  serializeUrl,
  shareUrl,
  soloShareUrl,
  urlQuery,
  useUrlParams,
  type ShareableGame,
} from './url';
import zigo from './zigo';

const BASE = 'https://izzardry.github.io/zigo/';

describe('parseUrl', () => {
  it('reads every parameter of DESIGN 13.2', () => {
    const p = parseUrl('?s=k7qw2m&d=7&p=1&o=c&w=W&t=5%2B7&n=13&g=t&h=2&m=ddjjtt&r=B%2BR&x=OFFER&y=ANSWER');
    expect(p).toEqual({
      code: 'K7QW2M',
      level: 7,
      playing: true,
      mode: 'computer',
      color: 'W',
      tc: '5+7',
      size: 13,
      rules: 'territory',
      handicap: 2,
      moves: 'ddjjtt',
      result: { winner: 'B', by: 'resign' },
      offer: 'OFFER',
      answer: 'ANSWER',
    });
  });

  it('accepts URLSearchParams and a raw "+" in t', () => {
    expect(parseUrl(new URLSearchParams('o=l')).mode).toBe('local');
    expect(parseUrl('o=r').mode).toBe('room');
    // A literal + in a query decodes to a space; parseTc trims it away only if it is a valid tc.
    expect(parseUrl('t=15%2B10').tc).toBe('15+10');
    // `w` is B or W; a lowercase letter is read too.
    expect(parseUrl('w=b').color).toBe('B');
    expect(parseUrl('w=W').color).toBe('W');
  });

  it('drops invalid values instead of throwing', () => {
    const p = parseUrl('s=!!!&d=13&p=0&o=z&w=x&t=fast&m=%25%25&r=win&n=10');
    expect(p).toEqual({});
    expect(parseUrl('d=0').level).toBeUndefined();
    expect(parseUrl('d=12').level).toBe(12);
    expect(parseUrl('s=abc-def').code).toBe('ABCDEF');
    expect(parseUrl('s=TOOLONGCODE').code).toBe('TOOLONGC');
  });

  it('keeps an empty move list (a game at its start)', () => {
    expect(parseUrl('s=A&p=1&m=').moves).toBe('');
  });
});

describe('serializeUrl', () => {
  it('writes in the fixed order s d p o w t n g h m r x y', () => {
    const q = urlQuery({
      answer: 'Y',
      offer: 'X',
      result: { winner: 'W', by: 'score', margin: 9 },
      moves: 'eecc',
      handicap: 3,
      rules: 'territory',
      size: 13,
      tc: '3+7',
      color: 'W',
      mode: 'computer',
      playing: true,
      level: 5,
      code: 'K7QW2M',
    });
    expect(q).toBe('s=K7QW2M&d=5&p=1&o=c&w=W&t=3%2B7&n=13&g=t&h=3&m=eecc&r=W%2B4.5&x=X&y=Y');
  });

  it('never writes moves or a result for room games', () => {
    const q = serializeUrl({ code: 'K7QW2M', playing: true, mode: 'room', moves: 'eecc', result: { winner: 'B', by: 'resign' } });
    expect(q.has('m')).toBe(false);
    expect(q.has('r')).toBe(false);
  });

  it('round-trips', () => {
    const plies = ['ee', 'cc', 'gg'].map((m) => ({ m, ms: 0 }));
    const p = {
      code: 'ZZ9',
      level: 12,
      playing: true,
      mode: 'computer' as const,
      color: 'W' as const,
      tc: '15+10',
      size: 9 as const,
      moves: zigo.encodeMoves(plies),
      result: { winner: 'W' as const, by: 'time' as const },
    };
    expect(parseUrl(serializeUrl(p))).toEqual(p);
  });

  it('formats and parses results as SGF writes RE', () => {
    expect(formatEnd({ winner: 'B', by: 'score', margin: 9 })).toBe('B+4.5');
    expect(formatEnd({ winner: 'W', by: 'resign' })).toBe('W+R');
    expect(formatEnd({ winner: 'B', by: 'time' })).toBe('B+T');
    expect(parseEnd('B+4.5')).toEqual({ winner: 'B', by: 'score', margin: 9 });
    expect(parseEnd('w+r')).toEqual({ winner: 'W', by: 'resign' });
    expect(parseEnd('B+T')).toEqual({ winner: 'B', by: 'time' });
    // A raw + decoded as a space.
    expect(parseEnd('W 12.5')).toEqual({ winner: 'W', by: 'score', margin: 25 });
    expect(parseEnd('W+0.3')).toBeUndefined();
    expect(parseEnd('1-0.resign')).toBeUndefined();
    expect(parseEnd('B+X')).toBeUndefined();
    expect(parseEnd(null)).toBeUndefined();
    // Through the query string both ways.
    expect(parseUrl(urlQuery({ result: { winner: 'B', by: 'score', margin: 1 } })).result).toEqual({ winner: 'B', by: 'score', margin: 1 });
    expect(parseUrl('r=B+0.5').result).toEqual({ winner: 'B', by: 'score', margin: 1 });
  });
});

describe('share links', () => {
  const solo: ShareableGame = {
    code: 'K7QW2M',
    mode: 'computer',
    level: 5,
    color: 'W',
    tc: '5+7',
    size: 9,
    rules: 'area',
    handicap: 0,
    moves: zigo.encodeMoves([{ m: 'ee', ms: 0 }]),
  };

  it('builds hash URLs on a base', () => {
    expect(buildUrl({ code: 'A' }, BASE)).toBe(`${BASE}#/?s=A`);
    expect(buildUrl({}, BASE)).toBe(`${BASE}#/`);
    expect(appBaseUrl({ origin: 'https://x.y', pathname: '/zigo/' })).toBe('https://x.y/zigo/');
  });

  it('room invites carry the code only', () => {
    expect(roomShareUrl('K7QW2M', BASE)).toBe(`${BASE}#/?s=K7QW2M&o=r`);
    expect(shareUrl({ ...solo, mode: 'room' }, BASE)).toBe(`${BASE}#/?s=K7QW2M&o=r`);
  });

  it('solo games carry the full state', () => {
    const url = soloShareUrl(solo, BASE);
    expect(url).toBe(`${BASE}#/?s=K7QW2M&d=5&p=1&o=c&w=W&t=5%2B7&n=9&m=${solo.moves}`);
    expect(shareUrl(solo, BASE)).toBe(url);
  });

  it('finished games carry their result and so open in review', () => {
    const url = finishedShareUrl({ ...solo, result: { winner: 'W', by: 'resign' } }, BASE);
    expect(parseUrl(url.split('#/?')[1]).result).toEqual({ winner: 'W', by: 'resign' });
  });

  it('pass-and-play links leave out w and d', () => {
    const p = gameParams({ ...solo, mode: 'local', level: 5 });
    expect(p.color).toBeUndefined();
    expect(p.level).toBeUndefined();
  });
});

describe('useUrlParams', () => {
  function setup(initial: string) {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [initial] }, children);
    return renderHook(() => ({ url: useUrlParams(), loc: useLocation(), nav: useNavigationType() }), { wrapper });
  }

  it('writes with replace, keeps x and y, and recognizes its own writes', () => {
    const { result } = setup('/?s=OLD&x=OFFER');
    expect(result.current.url.params.code).toBe('OLD');
    act(() => result.current.url.write({ code: 'NEW', playing: true, mode: 'local', moves: '' }));
    expect(result.current.loc.search).toBe('?s=NEW&p=1&o=l&m=&x=OFFER');
    expect(result.current.url.isOwnWrite(result.current.url.search)).toBe(true);
    expect(result.current.url.isOwnWrite('s=ELSE')).toBe(false);
    // replace: true — no new history entry.
    expect(result.current.nav).toBe('REPLACE');
  });

  it('does not navigate when nothing changes', () => {
    const { result } = setup('/?s=SAME');
    const before = result.current.loc;
    act(() => result.current.url.write({ code: 'SAME' }));
    expect(result.current.loc).toBe(before);
  });
});

describe('Go parameters n, g, h (DESIGN 13.2)', () => {
  it('reads size, rules and handicap', () => {
    expect(parseUrl('n=13&g=t&h=3')).toEqual({ size: 13, rules: 'territory', handicap: 3 });
    expect(parseUrl('n=19&g=a&h=0')).toEqual({ size: 19, rules: 'area', handicap: 0 });
    expect(parseUrl('g=T').rules).toBe('territory');
  });

  it('drops invalid values', () => {
    expect(parseUrl('n=7&g=x&h=1')).toEqual({});
    expect(parseUrl('n=9&h=7')).toEqual({ size: 9 }); // 9×9 allows at most 5
    expect(parseUrl('n=9&h=5').handicap).toBe(5);
    expect(parseUrl('h=9').handicap).toBe(9);
    expect(parseUrl('h=10').handicap).toBeUndefined();
    expect(parseUrl('n=13.0').size).toBeUndefined();
  });

  it('writes them after t, leaving out area and handicap 0', () => {
    expect(urlQuery({ code: 'K7QW2M', tc: '5+7', size: 13, rules: 'territory', handicap: 3, moves: 'ddtt' })).toBe(
      's=K7QW2M&t=5%2B7&n=13&g=t&h=3&m=ddtt',
    );
    expect(urlQuery({ size: 9, rules: 'area', handicap: 0 })).toBe('n=9');
  });

  it('round-trips a Go game with byo-yomi and passes', () => {
    const p = {
      code: 'ZIGO1',
      playing: true,
      mode: 'local' as const,
      tc: '20m5x30',
      size: 19 as const,
      rules: 'territory' as const,
      handicap: 4,
      moves: zigo.encodeMoves(['pd', 'tt', 'dp'].map((m) => ({ m, ms: 0 }))),
    };
    expect(parseUrl(serializeUrl(p))).toEqual(p);
  });

  it('normalizes byo-yomi time controls', () => {
    expect(parseUrl('t=20m%205x30s').tc).toBe('20m5x30');
    expect(parseUrl('t=20m5x0').tc).toBeUndefined();
  });

  it('share links carry the settings; room invites do not', () => {
    const g: ShareableGame = { code: 'K7QW2M', mode: 'local', color: 'B', tc: null, moves: 'eecc', size: 9, rules: 'territory', handicap: 2 };
    expect(soloShareUrl(g, BASE)).toBe(`${BASE}#/?s=K7QW2M&p=1&o=l&n=9&g=t&h=2&m=eecc`);
    expect(shareUrl({ ...g, mode: 'room' }, BASE)).toBe(`${BASE}#/?s=K7QW2M&o=r`);
  });
});
