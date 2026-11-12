import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import scoringApi from '@/lib/scoring';
import type { Game } from '@/lib/types';
import zigo, { makeSettings } from '@/lib/zigo';
import { scoreLine, scoreTerms, useScoring } from './useScoring';

/** Black's wall on e, White's on f, a black stone at aa, a white stone at bb inside Black's area. */
const WALLS: string[] = (() => {
  const out: string[] = [];
  for (const r of 'abcdefghi') out.push(`e${r}`, `f${r}`);
  out.push('aa', 'bb');
  return out;
})();

function scored(rules: 'area' | 'territory' = 'area', handicap = 0, extra: string[] = []): Game {
  let g = zigo.newGame(makeSettings(9, rules, handicap));
  for (const m of [...extra, ...WALLS]) g = zigo.play(g, m, 0);
  return zigo.pass(zigo.pass(g, 0), 0);
}

describe('score line (DESIGN 8.4 step 3)', () => {
  it('area: stones + territory, White adds komi', () => {
    const g = scored();
    const s = scoringApi.score(g, ['bb']);
    expect(scoreLine(s)).toBe('B 45 · W 36 + 7.5');
    const t = scoreTerms(s);
    expect(t.B).toEqual({ points: 45, total2: 90, text: '45' });
    expect(t.W).toMatchObject({ points: 36, komi2: 15, total2: 87, text: '36 + 7.5' });
    expect(t.B.prisoners).toBeUndefined();
  });

  it('territory: territory + prisoners, White adds komi', () => {
    const g = scored('territory');
    const s = scoringApi.score(g, ['bb']);
    expect(scoreLine(s)).toBe('B 35 + 1 · W 27 + 0 + 6.5');
    expect(scoreTerms(s).B).toMatchObject({ points: 35, prisoners: 1, total2: 72 });
  });

  it('area with a handicap: the compensation is a term of its own before komi', () => {
    // Handicap 2 on 9×9: stones at G3 and C7 (gg, cc), White moves first.
    const g = scored('area', 2, ['ad']);
    const s = scoringApi.score(g, []);
    const w = scoreTerms(s).W;
    expect(w.compensation2).toBe(4);
    expect(w.komi2).toBe(5);
    expect(w.text).toMatch(/ \+ 2 \+ 0\.5$/);
  });
});

describe('useScoring', () => {
  it('is inactive outside scoring and refuses every action', () => {
    const toggle = vi.fn(() => true);
    const g = zigo.newGame(makeSettings(9));
    const { result } = renderHook(() => useScoring(g, { toggle }));
    expect(result.current).toMatchObject({ active: false, editable: false, round: null, rev: 0, dead: [], score: null, territory: null, line: '' });
    expect(result.current.toggle('ee')).toBe(false);
    expect(result.current.accept()).toBe(false);
    expect(result.current.resume()).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
    expect(renderHook(() => useScoring(null)).result.current.active).toBe(false);
  });

  it('derives the count, the territory and the result of the marking; passes actions through', () => {
    const base = scored();
    const g = zigo.setScoring(base, { round: 1, rev: 1, dead: ['bb'], accepted: [1, 0] });
    const toggle = vi.fn(() => true);
    const accept = vi.fn(() => true);
    const resume = vi.fn(() => true);
    const { result } = renderHook(() => useScoring(g, { toggle, accept, resume }, { pending: true }));
    const sc = result.current;
    expect(sc).toMatchObject({ active: true, editable: true, round: 1, rev: 1, dead: ['bb'], pending: true });
    expect(sc.deadSet.has('bb')).toBe(true);
    expect(sc.acceptedBy).toEqual({ B: true, W: false });
    expect(sc.territory!.bb).toBe('B');
    expect(sc.territory!.ia).toBe('W');
    expect(sc.territory!.ea).toBeUndefined();
    expect(sc.result).toEqual({ winner: 'B', by: 'score', margin: 3 });
    expect(sc.toggle('bb')).toBe(true);
    expect(toggle).toHaveBeenCalledWith('bb');
    expect(sc.accept('W')).toBe(true);
    expect(accept).toHaveBeenCalledWith('W');
    expect(sc.resume()).toBe(true);
  });

  it('is read-only in review, in round 2 and after the end', () => {
    const toggle = vi.fn(() => true);
    const g = scored();
    expect(renderHook(() => useScoring(g, { toggle }, { live: false })).result.current.editable).toBe(false);
    const ended = zigo.end(zigo.setScoring(g, { round: 1, rev: 1, dead: ['bb'], accepted: [0, 0] }), { winner: 'B', by: 'score', margin: 3 });
    const done = renderHook(() => useScoring(ended, { toggle })).result.current;
    expect(done).toMatchObject({ active: true, editable: false, dead: ['bb'], result: { winner: 'B', by: 'score', margin: 3 } });
    expect(done.toggle('bb')).toBe(false);
    const round2 = zigo.pass(zigo.pass(zigo.resume(g), 0), 0);
    const r2 = renderHook(() => useScoring(round2, { toggle })).result.current;
    expect(r2.round).toBe(2);
    expect(r2.editable).toBe(false);
    expect(r2.toggle('bb')).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });
});
