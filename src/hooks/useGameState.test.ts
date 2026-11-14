import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeController, type FakeController } from '@/components/room/testUtils';
import type { RoomControllerOptions } from '@/lib/room';
import { createStore, memoryStorage } from '@/lib/storage';
import type { Game, Point, SavedGame, Store } from '@/lib/types';
import { parseUrl } from '@/lib/url';
import zengo, { makeSettings } from '@/lib/zengo';
import { useGameState, type UseGameStateOptions } from './useGameState';

const BASE = 'https://example.test/zengo/';

/** A short 9×9 opening. */
const OPENING = ['ee', 'cc', 'gg', 'dd', 'ec', 'gc', 'cg'];

/**
 * Black's wall on column e, White's on column f, a black stone at `aa`, a white stone at `bb`
 * inside Black's area (dead when marked). Area with `bb` dead: B+1.5; unmarked: White wins.
 */
const WALLS: string[] = (() => {
  const out: string[] = [];
  for (const r of 'abcdefghi') out.push(`e${r}`, `f${r}`);
  out.push('aa', 'bb');
  return out;
})();

let t = 0;
const now = () => t;
let store: Store;

/** rng cycling through values; 0.1 → code "333333" and color Black. */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

function setup(initial = '/', rng = seq(0.1), extra: UseGameStateOptions = {}, st: Store = store) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [initial] }, children);
  return renderHook(
    () => ({
      gs: useGameState({ store: st, now, rng, baseUrl: BASE, version: 'test', ...extra }),
      loc: useLocation(),
      navigate: useNavigate(),
    }),
    { wrapper },
  );
}

type R = ReturnType<typeof setup>['result'];

function url(result: R) {
  return parseUrl(result.current.loc.search);
}

function play(result: R, moves: string[], step = 1000) {
  for (const m of moves) {
    t += step;
    act(() => {
      expect(m === 'tt' ? result.current.gs.pass() : result.current.gs.play(m)).toBe(true);
    });
  }
}

function stored(id: string): SavedGame | undefined {
  return store.games().find((g) => g.id === id);
}

beforeEach(() => {
  t = 1_000_000;
  store = createStore(memoryStorage());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('start screen', () => {
  it('starts with a generated code, the first-run settings, and writes the URL', () => {
    const { result } = setup('/', seq(0.1));
    const gs = result.current.gs;
    expect(gs.phase).toBe('start');
    expect(gs.code).toBe('333333');
    expect(gs.opponent).toEqual({ mode: 'computer', level: 5 });
    expect(gs.colorChoice).toBe('random');
    expect(gs.size).toBe(9);
    expect(gs.rules).toBe('area');
    expect(gs.handicap).toBe(0);
    expect(gs.tc).toBeNull();
    expect(gs.startPill).toEqual({ label: 'start', saved: null });
    expect(gs.preview.cursor).toBe(0);
    expect(gs.preview.settings.size).toBe(9);
    expect(result.current.loc.search).toBe('?s=333333&d=5&o=c&n=9');
  });

  it('remembers settings in the store and reflects them in the URL', () => {
    const { result } = setup();
    act(() => result.current.gs.setOpponent({ mode: 'computer', level: 9 }));
    act(() => result.current.gs.setColorChoice('W'));
    act(() => result.current.gs.setTc('5+7'));
    expect(store.pref('opponent', null)).toEqual({ mode: 'computer', level: 9 });
    expect(store.pref('color', 'random')).toBe('W');
    expect(store.pref('clock', null)).toEqual({ 9: '5+7' });
    expect(url(result)).toMatchObject({ level: 9, mode: 'computer', color: 'W', tc: '5+7', size: 9 });
    act(() => result.current.gs.setTc(null));
    expect(store.pref('clock', null)).toEqual({ 9: null });
    expect(url(result).tc).toBeUndefined();

    // A second mount reads them back.
    const again = setup();
    expect(again.result.current.gs.opponent).toEqual({ mode: 'computer', level: 9 });
    expect(again.result.current.gs.colorChoice).toBe('W');
  });

  it('size, rules, handicap and clock: remembered, handicap and clock per size (DESIGN 4.1, 13.1)', () => {
    const { result } = setup();
    const gs = () => result.current.gs;
    act(() => gs().setHandicap(4));
    act(() => gs().setTc('2+7'));
    act(() => gs().setSize(19));
    expect(gs().size).toBe(19);
    expect(gs().handicap).toBe(0);
    expect(gs().tc).toBeNull();
    act(() => gs().setHandicap(9));
    act(() => gs().setTc('20m5x30'));
    act(() => gs().setRules('territory'));
    expect(url(result)).toMatchObject({ size: 19, rules: 'territory', handicap: 9, tc: '20m5x30' });
    expect(gs().preview.settings).toEqual({ size: 19, rules: 'territory', handicap: 9, komi2: 1 });
    expect([...gs().preview.board].filter((v) => v === 1)).toHaveLength(9);
    act(() => gs().setSize(9));
    expect(gs().handicap).toBe(4);
    expect(gs().tc).toBe('2+7');
    // 9×9 allows at most 5.
    act(() => gs().setHandicap(8));
    expect(gs().handicap).toBe(5);
    act(() => gs().setHandicap(1));
    expect(gs().handicap).toBe(0);
    expect(store.pref('size', 0)).toBe(9);
    expect(store.pref('rules', '')).toBe('territory');
    expect(store.pref('handicap', null)).toEqual({ 9: 0, 19: 9 });

    const again = setup();
    expect(again.result.current.gs.rules).toBe('territory');
    act(() => again.result.current.gs.setSize(19));
    expect(again.result.current.gs.handicap).toBe(9);
    expect(again.result.current.gs.tc).toBe('20m5x30');
  });

  it('normalizes typed codes and refuses empty ones', () => {
    const { result } = setup();
    act(() => {
      expect(result.current.gs.setCode('k7-qw2m')).toBe(true);
    });
    expect(result.current.gs.code).toBe('K7QW2M');
    act(() => {
      expect(result.current.gs.setCode('---')).toBe(false);
    });
    expect(result.current.gs.code).toBe('K7QW2M');
    let fresh = '';
    act(() => {
      fresh = result.current.gs.regenerateCode();
    });
    expect(result.current.gs.code).toBe(fresh);
  });

  it('start-screen links preselect settings', () => {
    const { result } = setup('/?s=ab12&o=l&w=W&t=3%2B7&n=13&g=t&h=3');
    const gs = result.current.gs;
    expect(gs.code).toBe('AB12');
    expect(gs.opponent).toEqual({ mode: 'local' });
    expect(gs.colorChoice).toBe('W');
    expect(gs.size).toBe(13);
    expect(gs.rules).toBe('territory');
    expect(gs.handicap).toBe(3);
    expect(gs.tc).toBe('3+7');
    expect(gs.phase).toBe('start');
  });
});

describe('pass-and-play', () => {
  it('starts, records ms per ply from now(), autosaves and writes moves to the URL', () => {
    const { result } = setup('/?s=GAME01&o=l');
    act(() => {
      expect(result.current.gs.start()).toBe(true);
    });
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.undoRule).toBe('ply');
    expect(stored('GAME01')).toMatchObject({ mode: 'local', color: 'B', size: 9, rules: 'area', handicap: 0, moves: '', createdAt: t, lastPlayedAt: t });
    expect(url(result)).toMatchObject({ code: 'GAME01', playing: true, mode: 'local', size: 9, moves: '' });

    play(result, ['ee'], 1500);
    play(result, ['cc'], 2500);
    const rec = stored('GAME01')!;
    expect(rec.ms).toEqual([1500, 2500]);
    expect(rec.lastPlayedAt).toBe(t);
    expect(zengo.decodeMoves(rec.moves)).toEqual(['ee', 'cc']);
    expect(url(result).moves).toBe(rec.moves);
    expect(result.current.gs.isPlayerTurn).toBe(true);
    expect(result.current.gs.isComputerTurn).toBe(false);
  });

  it('accepts an explicit ms and refuses illegal moves', () => {
    const { result } = setup('/?s=GAME02&o=l');
    act(() => void result.current.gs.start());
    act(() => {
      expect(result.current.gs.play('ee', 42)).toBe(true);
      expect(result.current.gs.play('ee', 1)).toBe(false);
      expect(result.current.gs.play('kk', 1)).toBe(false);
    });
    expect(stored('GAME02')!.ms).toEqual([42]);
  });

  it('a handicap game places the stones and White moves first', () => {
    const { result } = setup('/?s=HAND01&o=l&n=13&h=3');
    act(() => void result.current.gs.start());
    const g = result.current.gs.view!;
    expect(g.settings).toEqual({ size: 13, rules: 'area', handicap: 3, komi2: 1 });
    expect(g.turn).toBe('W');
    for (const p of ['D4', 'K10', 'D10']) expect(g.board[idx(p, 13)]).toBe(1);
    expect(stored('HAND01')).toMatchObject({ size: 13, handicap: 3 });
    expect(url(result)).toMatchObject({ size: 13, handicap: 3 });
  });

  it('undo steps one ply, marks assisted, saves; redo replays', () => {
    const { result } = setup('/?s=GAME03&o=l');
    act(() => void result.current.gs.start());
    play(result, ['ee', 'cc', 'gg']);
    expect(result.current.gs.canUndo).toBe(true);
    expect(result.current.gs.canRedo).toBe(false);
    act(() => void result.current.gs.undo());
    act(() => void result.current.gs.undo());
    expect(result.current.gs.view!.cursor).toBe(1);
    expect(result.current.gs.canRedo).toBe(true);
    expect(stored('GAME03')).toMatchObject({ assisted: true });
    expect(zengo.decodeMoves(stored('GAME03')!.moves)).toEqual(['ee']);
    act(() => void result.current.gs.redo());
    expect(result.current.gs.view!.cursor).toBe(2);
    expect(zengo.decodeMoves(url(result).moves!)).toEqual(['ee', 'cc']);
  });

  it('undo twice and redo once across a pass: the position and the passed state match', () => {
    const { result } = setup('/?s=GAME07&o=l');
    act(() => void result.current.gs.start());
    play(result, ['ee', 'tt', 'cc']);
    act(() => void result.current.gs.undo());
    act(() => void result.current.gs.undo());
    expect(result.current.gs.view!.cursor).toBe(1);
    expect(result.current.gs.view!.passes).toBe(0);
    act(() => void result.current.gs.redo());
    expect(result.current.gs.view!.cursor).toBe(2);
    expect(result.current.gs.view!.passes).toBe(1);
    expect(zengo.lastMove(result.current.gs.view!)).toBe('tt');
    expect(result.current.gs.view!.turn).toBe('B');
    expect(stored('GAME07')!.moves).toBe('eett');
  });

  it('pass: the 5-second toast takes it back without a redo tail', () => {
    const { result } = setup('/?s=PASS01&o=l');
    act(() => void result.current.gs.start());
    play(result, ['ee']);
    expect(result.current.gs.canUndoPass).toBe(false);
    play(result, ['tt']);
    expect(result.current.gs.canUndoPass).toBe(true);
    expect(stored('PASS01')!.moves).toBe('eett');
    act(() => {
      expect(result.current.gs.undoPass()).toBe(true);
    });
    expect(result.current.gs.view!.cursor).toBe(1);
    expect(result.current.gs.canRedo).toBe(false);
    expect(stored('PASS01')).toMatchObject({ moves: 'ee', assisted: false });
  });

  it('resign ends for the side to move; reopen takes it back', () => {
    const { result } = setup('/?s=GAME04&o=l');
    act(() => void result.current.gs.start());
    play(result, ['ee']);
    act(() => void result.current.gs.resign());
    expect(result.current.gs.isOver).toBe(true);
    expect(stored('GAME04')).toMatchObject({ result: { winner: 'B', by: 'resign' } });
    expect(url(result).result).toEqual({ winner: 'B', by: 'resign' });
    act(() => void result.current.gs.reopen());
    expect(result.current.gs.isOver).toBe(false);
    expect(stored('GAME04')!.result).toBeUndefined();
    expect(url(result).result).toBeUndefined();
  });

  it('timeout and finish end the game', () => {
    const { result } = setup('/?s=GAME05&o=l&t=1%2B0');
    act(() => void result.current.gs.start());
    play(result, ['ee']);
    act(() => void result.current.gs.timeout('W'));
    expect(stored('GAME05')).toMatchObject({ result: { winner: 'B', by: 'time' }, tc: '1+0' });
    act(() => void result.current.gs.reopen());
    act(() => void result.current.gs.finish({ winner: 'W', by: 'resign' }));
    expect(stored('GAME05')).toMatchObject({ result: { winner: 'W', by: 'resign' } });
  });

  it('the turn timer pauses while the tab is hidden', () => {
    const { result } = setup('/?s=GAME06&o=l');
    act(() => void result.current.gs.start());
    t += 1000;
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    t += 60_000;
    vis.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    t += 500;
    expect(result.current.gs.turnElapsed()).toBe(1500);
    act(() => void result.current.gs.play('ee'));
    expect(stored('GAME06')!.ms).toEqual([1500]);
    vis.mockRestore();
  });
});

function idx(gtp: string, size: 9 | 13 | 19): number {
  const p = zengo.fromGtp(gtp, size)!;
  return (p.charCodeAt(1) - 97) * size + (p.charCodeAt(0) - 97);
}

describe('scoring (DESIGN 8.4)', () => {
  function toScoring(initial = '/?s=SCO001&o=l', extra: UseGameStateOptions = {}) {
    const r = setup(initial, seq(0.1), extra);
    act(() => void r.result.current.gs.start());
    play(r.result, [...WALLS, 'tt', 'tt']);
    return r;
  }

  it('two passes enter scoring: the clock stops; a tap toggles a group; the score line follows', () => {
    const { result } = toScoring();
    const gs = () => result.current.gs;
    expect(gs().phase).toBe('scoring');
    expect(gs().isScoring).toBe(true);
    expect(gs().isPlayerTurn).toBe(false);
    expect(gs().canUndoPass).toBe(true);
    const used = gs().turnElapsed();
    t += 5000;
    expect(gs().turnElapsed()).toBe(used);
    expect(gs().scoring).toMatchObject({ active: true, editable: true, round: 1, rev: 0, dead: [] });
    expect(gs().scoring.result!.winner).toBe('W');
    expect(gs().play('cc')).toBe(false);
    act(() => {
      expect(gs().scoring.toggle('bb')).toBe(true);
    });
    expect(gs().scoring.dead).toEqual(['bb']);
    expect(gs().scoring.deadSet.has('bb')).toBe(true);
    expect(gs().scoring.territory!.bb).toBe('B');
    expect(gs().scoring.line).toBe('B 45 · W 36 + 7.5');
    expect(gs().scoring.result).toEqual({ winner: 'B', by: 'score', margin: 3 });
    expect(stored('SCO001')!.scoring).toMatchObject({ round: 1, rev: 1, dead: ['bb'] });
    act(() => {
      expect(gs().scoring.toggle('cc')).toBe(false);
    });
  });

  it('Accept ends the game; the stored game keeps the marks and the result', () => {
    const { result } = toScoring();
    act(() => void result.current.gs.scoring.toggle('bb'));
    act(() => {
      expect(result.current.gs.scoring.accept()).toBe(true);
    });
    expect(result.current.gs.isOver).toBe(true);
    // As a resignation: the board stays as it was, the overlay follows.
    expect(result.current.gs.phase).toBe('playing');
    expect(stored('SCO001')).toMatchObject({ result: { winner: 'B', by: 'score', margin: 3 }, scoring: { dead: ['bb'] } });
    expect(url(result).result).toEqual({ winner: 'B', by: 'score', margin: 3 });
    // Review at the end shows the agreed marking (DESIGN 12.3).
    expect(result.current.gs.scoring).toMatchObject({ active: true, editable: false, dead: ['bb'] });
    expect(result.current.gs.reopen()).toBe(false);
  });

  it('the same position under territory rules gives the territory margin', () => {
    const { result } = toScoring('/?s=SCO002&o=l&g=t');
    act(() => void result.current.gs.scoring.toggle('bb'));
    expect(result.current.gs.scoring.line).toBe('B 35 + 1 · W 27 + 0 + 6.5');
    act(() => void result.current.gs.scoring.accept());
    expect(stored('SCO002')!.result).toEqual({ winner: 'B', by: 'score', margin: 5 });
  });

  it('face to face: each side accepts; the game ends when both have', () => {
    const { result } = toScoring();
    act(() => void result.current.gs.scoring.accept('B'));
    expect(result.current.gs.isOver).toBe(false);
    expect(result.current.gs.scoring.acceptedBy).toEqual({ B: true, W: false });
    act(() => void result.current.gs.scoring.accept('W'));
    expect(result.current.gs.isOver).toBe(true);
  });

  it('reload during scoring returns to the same marks; Back keeps the game in history', () => {
    const first = toScoring();
    act(() => void first.result.current.gs.scoring.toggle('bb'));
    const address = `/${first.result.current.loc.search}`;
    first.unmount();
    const second = setup(address);
    expect(second.result.current.gs.phase).toBe('scoring');
    expect(second.result.current.gs.scoring.dead).toEqual(['bb']);
    act(() => second.result.current.gs.exit());
    expect(second.result.current.gs.startPill.label).toBe('resume');
    act(() => {
      expect(second.result.current.gs.open(stored('SCO001')!)).toBe(true);
    });
    expect(second.result.current.gs.phase).toBe('scoring');
    expect(second.result.current.gs.scoring.dead).toEqual(['bb']);
  });

  it('Resume plays on; the next double pass is scored at once with every stone alive (no engine)', () => {
    const { result } = toScoring();
    act(() => void result.current.gs.scoring.toggle('bb'));
    act(() => {
      expect(result.current.gs.scoring.resume()).toBe(true);
    });
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.isPlayerTurn).toBe(true);
    play(result, ['tt', 'tt']);
    expect(result.current.gs.isOver).toBe(true);
    expect(stored('SCO001')).toMatchObject({ scoring: { round: 2, dead: [] }, result: { winner: 'W', by: 'score' } });
    // The pass toast lifts that ending.
    expect(result.current.gs.canUndoPass).toBe(true);
    act(() => void result.current.gs.undoPass());
    expect(result.current.gs.isOver).toBe(false);
    expect(result.current.gs.view!.passes).toBe(1);
  });

  it('undo leaves scoring; redo returns to it with the marks', () => {
    const { result } = toScoring();
    act(() => void result.current.gs.scoring.toggle('bb'));
    act(() => void result.current.gs.undo());
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.scoring.active).toBe(false);
    act(() => void result.current.gs.redo());
    expect(result.current.gs.phase).toBe('scoring');
    expect(result.current.gs.scoring.dead).toEqual(['bb']);
  });

  it('a proposer gives the initial marks (round 1) and the final count (round 2)', () => {
    const calls: Game[] = [];
    const proposeDead = (g: Game): Point[] => {
      calls.push(g);
      return ['bb'];
    };
    const { result } = toScoring('/?s=SCO003&o=l', { proposeDead });
    expect(calls).toHaveLength(1);
    expect(result.current.gs.scoring).toMatchObject({ round: 1, rev: 1, dead: ['bb'] });
    act(() => void result.current.gs.scoring.resume());
    play(result, ['tt', 'tt']);
    expect(calls).toHaveLength(2);
    expect(result.current.gs.isOver).toBe(true);
    expect(stored('SCO003')!.result).toEqual({ winner: 'B', by: 'score', margin: 3 });
  });

  it('an async proposer: pending meanwhile; a toggle before it resolves wins', async () => {
    let resolve: (p: Point[]) => void = () => {};
    const proposeDead = () => new Promise<Point[]>((r) => (resolve = r));
    const { result } = toScoring('/?s=SCO004&o=l', { proposeDead });
    expect(result.current.gs.scoring.pending).toBe(true);
    await act(async () => {
      resolve(['bb']);
      await Promise.resolve();
    });
    expect(result.current.gs.scoring.pending).toBe(false);
    expect(result.current.gs.scoring.dead).toEqual(['bb']);

    // Next scoring phase: the player toggles first; the late proposal is dropped.
    act(() => void result.current.gs.undo());
    act(() => void result.current.gs.undo());
    play(result, ['tt', 'tt']);
    expect(result.current.gs.scoring.pending).toBe(true);
    act(() => void result.current.gs.scoring.toggle('fa'));
    await act(async () => {
      resolve(['bb']);
      await Promise.resolve();
    });
    expect(result.current.gs.scoring.dead).toHaveLength(9);
    expect(result.current.gs.scoring.dead).not.toContain('bb');
  });
});

describe('against the computer (extension points for milestone 2)', () => {
  it('undo takes back a full turn and exposes whose turn it is', () => {
    const { result } = setup('/?s=COMP01&o=c&d=3&w=B');
    act(() => void result.current.gs.start());
    expect(result.current.gs.session).toMatchObject({ mode: 'computer', level: 3, color: 'B' });
    expect(result.current.gs.undoRule).toBe('turn');
    expect(result.current.gs.isPlayerTurn).toBe(true);
    play(result, ['ee']);
    expect(result.current.gs.isComputerTurn).toBe(true);
    expect(result.current.gs.isPlayerTurn).toBe(false);
    play(result, ['cc', 'gg', 'dd']);
    act(() => void result.current.gs.undo());
    expect(result.current.gs.view!.cursor).toBe(2);
    act(() => void result.current.gs.redo());
    expect(result.current.gs.view!.cursor).toBe(4);
  });

  it('a White player sees the computer to move first; undoing the first turn returns to the start', () => {
    const { result } = setup('/?s=COMP02&o=c&w=W');
    act(() => void result.current.gs.start());
    expect(result.current.gs.session!.color).toBe('W');
    expect(result.current.gs.isComputerTurn).toBe(true);
    expect(result.current.gs.canUndo).toBe(false);
    play(result, ['ee']);
    expect(result.current.gs.isPlayerTurn).toBe(true);
    act(() => void result.current.gs.undo());
    expect(result.current.gs.view!.cursor).toBe(0);
    expect(result.current.gs.isComputerTurn).toBe(true);
  });

  it('the computer moves on while the player reviews', () => {
    const { result } = setup('/?s=COMP06&o=c&w=B');
    act(() => void result.current.gs.start());
    play(result, ['ee']);
    act(() => result.current.gs.goto(0));
    expect(result.current.gs.phase).toBe('review');
    act(() => {
      expect(result.current.gs.play('cc', 300)).toBe(true);
    });
    expect(result.current.gs.session!.game.cursor).toBe(2);
    expect(result.current.gs.reviewCursor).toBe(0);
    expect(result.current.gs.play('gg')).toBe(false);
  });

  it('resign: the player loses; the computer resigning is a finish', () => {
    const { result } = setup('/?s=COMP03&o=c&w=W');
    act(() => void result.current.gs.start());
    act(() => void result.current.gs.resign());
    expect(stored('COMP03')).toMatchObject({ result: { winner: 'B', by: 'resign' } });
    act(() => void result.current.gs.newGame());
    act(() => void result.current.gs.finish({ winner: result.current.gs.session!.color, by: 'resign' }));
    expect(result.current.gs.isOver).toBe(true);
  });

  it('markAssisted is saved', () => {
    const { result } = setup('/?s=COMP04&o=c&w=B');
    act(() => void result.current.gs.start());
    act(() => result.current.gs.markAssisted());
    expect(stored('COMP04')!.assisted).toBe(true);
  });

  it('a random color uses the rng', () => {
    const { result } = setup('/?s=COMP05&o=c', seq(0.9));
    act(() => void result.current.gs.start());
    expect(result.current.gs.session!.color).toBe('W');
  });
});

describe('resume, reload and the 15-second rule', () => {
  it('Back keeps the code; the Start pill says resume with the stored settings; redo is empty after resume', () => {
    const { result } = setup('/?s=RES001&o=l&n=13');
    act(() => void result.current.gs.start());
    play(result, ['ee', 'cc']);
    act(() => void result.current.gs.undo());
    expect(result.current.gs.canRedo).toBe(true);
    act(() => result.current.gs.exit());
    expect(result.current.gs.phase).toBe('start');
    expect(result.current.gs.code).toBe('RES001');
    expect(url(result).playing).toBeUndefined();
    expect(url(result).moves).toBeUndefined();
    expect(result.current.gs.startPill.label).toBe('resume');
    expect(result.current.gs.startPill.saved).toMatchObject({ mode: 'local', size: 13 });
    expect(result.current.gs.preview.cursor).toBe(1);
    expect(result.current.gs.preview.settings.size).toBe(13);

    // Changing the opponent does not hide the stored game; ROOM always says start.
    act(() => result.current.gs.setOpponent({ mode: 'computer', level: 2 }));
    expect(result.current.gs.startPill.label).toBe('resume');
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    expect(result.current.gs.startPill.label).toBe('start');
    // ROOM's Start: nothing to open in milestone 1 without `onRoom`.
    act(() => {
      expect(result.current.gs.start()).toBe(false);
    });
    expect(result.current.gs.phase).toBe('start');
    act(() => result.current.gs.setOpponent({ mode: 'local' }));

    act(() => void result.current.gs.start());
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.view!.cursor).toBe(1);
    expect(result.current.gs.view!.settings.size).toBe(13);
    expect(result.current.gs.canRedo).toBe(false);
  });

  it('a resumed game keeps its lastPlayedAt until a change or 15 seconds', () => {
    vi.useFakeTimers();
    const { result } = setup('/?s=RES002&o=l');
    act(() => void result.current.gs.start());
    play(result, ['ee']);
    const playedAt = t;
    act(() => result.current.gs.exit());

    t += 3_600_000;
    act(() => void result.current.gs.start());
    expect(stored('RES002')!.lastPlayedAt).toBe(playedAt);
    t += 10_000;
    act(() => void vi.advanceTimersByTime(10_000));
    expect(stored('RES002')!.lastPlayedAt).toBe(playedAt);
    t += 5_000;
    act(() => void vi.advanceTimersByTime(5_000));
    expect(stored('RES002')!.lastPlayedAt).toBe(t);

    // A quick peek that ends before 15 s leaves it alone.
    act(() => result.current.gs.exit());
    const before = t;
    t += 3_600_000;
    act(() => void result.current.gs.start());
    t += 3_000;
    act(() => void vi.advanceTimersByTime(3_000));
    act(() => result.current.gs.exit());
    act(() => void vi.advanceTimersByTime(30_000));
    expect(stored('RES002')!.lastPlayedAt).toBe(before);

    // A move counts at once.
    act(() => void result.current.gs.start());
    play(result, ['cc']);
    expect(stored('RES002')!.lastPlayedAt).toBe(t);
  });

  it('a reload with the game URL resumes the stored game instead of making a new one', () => {
    const first = setup('/?s=REL001&o=l');
    act(() => void first.result.current.gs.start());
    play(first.result, ['ee', 'cc', 'gg']);
    const address = `/${first.result.current.loc.search}`;
    first.unmount();

    const second = setup(address);
    expect(second.result.current.gs.phase).toBe('playing');
    expect(second.result.current.gs.code).toBe('REL001');
    expect(second.result.current.gs.view!.cursor).toBe(3);
    expect(store.games()).toHaveLength(1);
    expect(stored('REL001')!.ms).toEqual([1000, 1000, 1000]);
  });

  it('open() resumes unfinished and reviews finished games from history', () => {
    const { result } = setup('/?s=HIS001&o=l');
    act(() => void result.current.gs.start());
    play(result, OPENING);
    act(() => void result.current.gs.resign());
    expect(result.current.gs.isOver).toBe(true);
    act(() => result.current.gs.exit());
    expect(result.current.gs.startPill.label).toBe('review');

    const rec = stored('HIS001')!;
    act(() => {
      expect(result.current.gs.open(rec)).toBe(true);
    });
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.reviewCursor).toBe(7);
  });
});

describe('review and continue from here', () => {
  function finishedGame(initial = '/?s=REV001&o=l') {
    const r = setup(initial);
    act(() => void r.result.current.gs.start());
    play(r.result, OPENING);
    act(() => void r.result.current.gs.resign());
    act(() => r.result.current.gs.exit());
    act(() => void r.result.current.gs.start());
    return r;
  }

  it('steps, jumps and stays read-only', () => {
    const { result } = finishedGame();
    const gs = () => result.current.gs;
    expect(gs().phase).toBe('review');
    expect(gs().canStepForward).toBe(false);
    act(() => gs().step(-1));
    expect(gs().view!.cursor).toBe(6);
    act(() => gs().toStart());
    expect(gs().view!.cursor).toBe(0);
    expect(gs().canStepBack).toBe(false);
    act(() => gs().goto(4));
    expect(gs().view!.cursor).toBe(4);
    act(() => gs().toEnd());
    expect(gs().view!.cursor).toBe(7);
    expect(gs().phase).toBe('review');
    act(() => {
      expect(gs().play('aa')).toBe(false);
      expect(gs().pass()).toBe(false);
      expect(gs().undo()).toBe(false);
    });
    expect(gs().canUndo).toBe(false);
    // Stepping does not save or touch the URL's moves.
    expect(url(result).moves).toBe(stored('REV001')!.moves);
    expect(url(result).result).toEqual({ winner: 'B', by: 'resign' });
  });

  it('continue from here starts a new game with a new code from the shown position, same settings', () => {
    const { result } = finishedGame('/?s=REV001&o=l&n=13&g=t&h=2');
    act(() => result.current.gs.goto(4));
    act(() => {
      expect(result.current.gs.continueFromHere()).toBe(true);
    });
    const gs = result.current.gs;
    expect(gs.phase).toBe('playing');
    expect(gs.code).not.toBe('REV001');
    // The opponent selector was set to pass-and-play by the link (?o=l): that is the last solo setting.
    expect(gs.session).toMatchObject({ mode: 'local', color: 'B' });
    expect(gs.view!.cursor).toBe(4);
    expect(gs.view!.settings).toEqual({ size: 13, rules: 'territory', handicap: 2, komi2: 1 });
    const rec = stored(gs.code)!;
    expect(rec.ms).toEqual([0, 0, 0, 0]);
    expect(rec).toMatchObject({ size: 13, rules: 'territory', handicap: 2 });
    expect(stored('REV001')!.result).toEqual({ winner: 'W', by: 'resign' });
    expect(url(result).code).toBe(gs.code);
  });

  it('continue from here against the computer when that was the last solo setting', () => {
    const { result } = finishedGame();
    act(() => result.current.gs.setOpponent({ mode: 'computer', level: 8 }));
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    act(() => result.current.gs.goto(3));
    act(() => void result.current.gs.continueFromHere());
    expect(result.current.gs.session).toMatchObject({ mode: 'computer', level: 8, color: 'W' });
  });

  it('the end position of a finished game can be continued (Go has no automatic ending)', () => {
    const { result } = finishedGame();
    act(() => {
      expect(result.current.gs.continueFromHere()).toBe(true);
    });
    expect(result.current.gs.view!.cursor).toBe(7);
    expect(result.current.gs.isOver).toBe(false);
  });

  it('a move-list jump in a live game enters review; reaching the live position leaves it', () => {
    const { result } = setup('/?s=LIVE01&o=l');
    act(() => void result.current.gs.start());
    play(result, ['ee', 'cc', 'gg']);
    act(() => result.current.gs.goto(1));
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.session!.game.cursor).toBe(3);
    expect(result.current.gs.isPlayerTurn).toBe(false);
    act(() => result.current.gs.step(1));
    expect(result.current.gs.reviewCursor).toBe(2);
    act(() => result.current.gs.step(1));
    expect(result.current.gs.phase).toBe('playing');
    act(() => result.current.gs.enterReview());
    expect(result.current.gs.reviewCursor).toBe(3);
    act(() => result.current.gs.exitReview());
    expect(result.current.gs.phase).toBe('playing');
  });

  it('newGame starts a fresh code with the same mode and settings', () => {
    const { result } = finishedGame('/?s=REV001&o=l&n=13&h=2');
    act(() => {
      expect(result.current.gs.newGame()).toBe(true);
    });
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.code).not.toBe('REV001');
    expect(result.current.gs.session!.mode).toBe('local');
    expect(result.current.gs.view!.cursor).toBe(0);
    expect(result.current.gs.view!.settings).toMatchObject({ size: 13, handicap: 2 });
  });
});

describe('shared links', () => {
  const moves = zengo.encodeMoves(['ee', 'cc', 'gg'].map((m) => ({ m, ms: 0 })));

  it('open as a new game on this device with the link settings, times not carried', () => {
    const { result } = setup(`/?s=SHR001&d=4&p=1&o=c&w=W&t=5%2B7&n=13&g=t&h=2&m=${moves}`);
    const gs = result.current.gs;
    expect(gs.phase).toBe('playing');
    expect(gs.session).toMatchObject({ code: 'SHR001', mode: 'computer', level: 4, color: 'W', tc: '5+7' });
    expect(gs.view!.cursor).toBe(3);
    expect(gs.view!.settings).toEqual({ size: 13, rules: 'territory', handicap: 2, komi2: 1 });
    expect(stored('SHR001')).toMatchObject({ moves, ms: [0, 0, 0], size: 13, rules: 'territory', handicap: 2 });
  });

  it('a link with moves and n=13 shows the position in a fresh context; Copy SGF has the size and result', () => {
    const { result } = setup(`/?s=SHR008&p=1&o=l&n=13&m=${moves}&r=W%2BR`);
    const gs = result.current.gs;
    expect(gs.phase).toBe('review');
    expect(gs.view!.board[2 * 13 + 2]).toBe(2);
    expect(gs.view!.board[4 * 13 + 4]).toBe(1);
    const sgf = gs.sgf()!;
    expect(sgf).toContain('SZ[13]');
    expect(sgf).toContain('RE[W+R]');
    expect(sgf).toContain('AP[Zengo:test]');
    expect(sgf).toContain(';B[ee];W[cc];B[gg]');
  });

  it('a link without n gets the smallest board its moves fit on', () => {
    const { result } = setup('/?s=SHR009&p=1&o=l&m=ddpp');
    expect(result.current.gs.view!.settings.size).toBe(19);
    expect(result.current.gs.view!.cursor).toBe(2);
  });

  it('a link that ends in two passes opens in scoring', () => {
    const { result } = setup(`/?s=SHR010&p=1&o=l&n=9&m=${moves}tttt`);
    expect(result.current.gs.phase).toBe('scoring');
    expect(result.current.gs.scoring.round).toBe(1);
  });

  it('never overwrite a different stored game with the same code', () => {
    const mine = setup('/?s=SHR002&o=l');
    act(() => void mine.result.current.gs.start());
    play(mine.result, ['dd']);
    mine.unmount();
    const myMoves = stored('SHR002')!.moves;

    const { result } = setup(`/?s=SHR002&p=1&o=l&n=9&m=${moves}`, seq(0.5));
    const gs = result.current.gs;
    expect(gs.phase).toBe('playing');
    expect(gs.code).not.toBe('SHR002');
    expect(gs.view!.cursor).toBe(3);
    expect(stored('SHR002')!.moves).toBe(myMoves);
    expect(stored(gs.code)!.moves).toBe(moves);
    expect(url(result).code).toBe(gs.code);
  });

  it('finished links open in review', () => {
    const { result } = setup(`/?s=SHR003&p=1&o=l&n=9&m=${moves}&r=W%2BR`);
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.session!.game.end).toEqual({ result: { winner: 'W', by: 'resign' } });
    expect(stored('SHR003')).toMatchObject({ result: { winner: 'W', by: 'resign' } });
  });

  it('a link pasted into a running tab is applied', () => {
    const { result } = setup('/?s=SHR004&o=l');
    act(() => void result.current.gs.start());
    play(result, ['ee']);
    act(() => result.current.navigate(`/?s=SHR005&p=1&o=l&n=9&m=${moves}`, { replace: true }));
    expect(result.current.gs.code).toBe('SHR005');
    expect(result.current.gs.view!.cursor).toBe(3);
    expect(stored('SHR004')).toBeDefined();
  });

  it('shareUrl gives the full URL in a game and the settings on the start screen', () => {
    const { result } = setup('/?s=SHR006&o=l');
    expect(result.current.gs.shareUrl()).toBe(`${BASE}#/?s=SHR006&o=l&n=9`);
    act(() => void result.current.gs.start());
    play(result, ['ee']);
    const link = result.current.gs.shareUrl();
    expect(link).toBe(`${BASE}#/?s=SHR006&p=1&o=l&n=9&m=ee`);
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    act(() => result.current.gs.exit());
    expect(result.current.gs.shareUrl()).toBe(`${BASE}#/?s=SHR006&o=r`);
    expect(result.current.gs.sgf()).toBeNull();
  });

  it('keeps transient x/y parameters written by others', () => {
    const { result } = setup('/?s=SHR007&o=l');
    act(() => result.current.navigate('/?s=SHR007&o=l&n=9&x=OFFER', { replace: true }));
    expect(result.current.gs.phase).toBe('start');
    act(() => void result.current.gs.start());
    expect(url(result).offer).toBe('OFFER');
    expect(url(result).playing).toBe(true);
  });
});

describe('rooms (extension points for milestone 3)', () => {
  it('a room invite preselects ROOM and the code and goes to onRoom; without it the invite waits', () => {
    const plain = setup('/?s=room42&o=r');
    expect(plain.result.current.gs.phase).toBe('start');
    expect(plain.result.current.gs.opponent).toEqual({ mode: 'room' });
    expect(plain.result.current.gs.code).toBe('ROOM42');
    expect(plain.result.current.gs.roomInvite).toBe('ROOM42');
    // The start screen with ROOM selected is not an invite link: `o` stays out.
    expect(url(plain.result)).toEqual({ code: 'ROOM42', size: 9 });
    expect(plain.result.current.gs.shareUrl()).toBe(`${BASE}#/?s=ROOM42&o=r`);
    plain.unmount();

    const onRoom = vi.fn(() => true);
    const r = setup('/?s=room43&o=r', seq(0.1), { onRoom });
    expect(onRoom).toHaveBeenCalledWith('ROOM43', null);
    expect(r.result.current.gs.roomInvite).toBeNull();
  });

  it('Start with ROOM hands the code and the start-screen settings to onRoom', () => {
    const onRoom = vi.fn(() => true);
    const { result } = setup('/?s=RMA001&n=13&h=2&w=W&t=3%2B7', seq(0.1), { onRoom });
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    act(() => {
      expect(result.current.gs.start()).toBe(true);
    });
    expect(onRoom).toHaveBeenCalledWith('RMA001', { tc: '3+7', color: 'W', size: 13, rules: 'area', handicap: 2 });
  });

  it('an unfinished room game goes to onRoom; a finished one opens in review', () => {
    const game = zengo.play(zengo.newGame(makeSettings(9)), 'ee', 0);
    const rec = (n: number, finished: boolean): SavedGame => ({
      id: `RMD001.${n}`,
      code: 'RMD001',
      mode: 'room',
      color: 'W',
      size: 9,
      rules: 'area',
      handicap: 0,
      tc: null,
      moves: zengo.encodeMoves(game.plies),
      ms: [0],
      ...(finished ? { result: { winner: 'B' as const, by: 'resign' as const } } : {}),
      assisted: false,
      room: { n, epoch: 0 },
      createdAt: t,
      lastPlayedAt: t + n,
    });
    const plain = setup('/');
    act(() => {
      expect(plain.result.current.gs.open(rec(2, false))).toBe(false);
    });
    act(() => {
      expect(plain.result.current.gs.open(rec(1, true))).toBe(true);
    });
    expect(plain.result.current.gs.phase).toBe('review');
    expect(plain.result.current.gs.canUndo).toBe(false);
    expect(plain.result.current.gs.shareUrl()).toBe(`${BASE}#/?s=RMD001&o=r`);
    plain.unmount();

    const onRoom = vi.fn(() => true);
    const r = setup('/', seq(0.1), { onRoom });
    act(() => {
      expect(r.result.current.gs.open(rec(2, false))).toBe(true);
    });
    expect(onRoom).toHaveBeenCalledWith('RMD001', null);
    expect(r.result.current.gs.code).toBe('RMD001');
  });
});

describe('rooms (milestone 3: the `rooms` option)', () => {
  /** No transport at all: the room opens, loads its record and waits; nothing reaches a network. */
  const offline = { rooms: true, room: { broker: null, manualEnabled: false, locks: null } } as const;

  it('Start with ROOM opens the room with the start-screen settings; the address carries the code only', async () => {
    const { result } = setup('/?s=RMH001&n=13&g=t&w=W&t=3%2B7', seq(0.1), offline);
    act(() => result.current.gs.setOpponent({ mode: 'room' }));
    act(() => {
      expect(result.current.gs.start()).toBe(true);
    });
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.session?.mode).toBe('room');
    expect(result.current.gs.room).not.toBeNull();
    // The controller creates the room at once with the creator's settings (DESIGN 9.1).
    await waitFor(() => expect(result.current.gs.room?.state?.seat).toBe(0));
    await waitFor(() => expect(result.current.gs.session?.game.settings.size).toBe(13));
    expect(result.current.gs.session?.game.settings.rules).toBe('territory');
    expect(result.current.gs.session?.color).toBe('W');
    expect(result.current.gs.session?.tc).toBe('3+7');
    expect(result.current.gs.session?.id).toBe('RMH001.1');
    expect(store.rooms().map((r) => r.code)).toEqual(['RMH001']);
    // Room addresses carry the code only, never moves (DESIGN 13.2); Share is the invite.
    expect(url(result)).toEqual({ code: 'RMH001', playing: true, mode: 'room' });
    expect(result.current.gs.shareUrl()).toBe(`${BASE}#/?s=RMH001&o=r`);
    // No solo undo, redo or pass toast in a room; Undo is a takeback request (nobody to ask yet).
    expect(result.current.gs.undoRule).toBe('request');
    expect(result.current.gs.canRedo).toBe(false);
    expect(result.current.gs.canUndoPass).toBe(false);
    expect(result.current.gs.newGame()).toBe(false);

    // Back leaves the room; ROOM stays selected and the room's game shows dimmed on the start screen.
    act(() => result.current.gs.exit());
    expect(result.current.gs.phase).toBe('start');
    expect(result.current.gs.room).toBeNull();
    await waitFor(() => expect(result.current.gs.roomSaved?.id).toBe('RMH001.1'));
    expect(result.current.gs.preview.settings.size).toBe(13);
    // Another code shows the start screen's own settings again.
    act(() => void result.current.gs.setCode('RMH999'));
    expect(result.current.gs.roomSaved).toBeNull();
  });

  it('an invite link opens the room at once; a stored room game reopens it; reviewing it never leaves the room', async () => {
    const { result } = setup('/?s=rmh002&o=r', seq(0.1), offline);
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.room?.code).toBe('RMH002');
    expect(result.current.gs.roomInvite).toBeNull();
    act(() => result.current.gs.exit());
    expect(result.current.gs.phase).toBe('start');

    // A stored unfinished room game reconnects to its room (DESIGN 12.2).
    const game = zengo.play(zengo.newGame(makeSettings(9)), 'ee', 0);
    const rec: SavedGame = {
      id: 'RMH003.1',
      code: 'RMH003',
      mode: 'room',
      color: 'B',
      size: 9,
      rules: 'area',
      handicap: 0,
      tc: null,
      moves: zengo.encodeMoves(game.plies),
      ms: [0],
      assisted: false,
      room: { n: 1, epoch: 0 },
      createdAt: t,
      lastPlayedAt: t,
    };
    store.saveRoom({ code: 'RMH003', key: 'AAAAAAAAAAAAAAAAAAAAAA', seat: 0, createdAt: t, lastSeenAt: 0, score: [0, 0], games: ['RMH003.1'] });
    store.saveGame(rec);
    act(() => {
      expect(result.current.gs.open(rec)).toBe(true);
    });
    expect(result.current.gs.room?.code).toBe('RMH003');
    await waitFor(() => expect(result.current.gs.session?.game.cursor).toBe(1));
    // Stepping back through the moves is a local review; the live position ends it.
    act(() => result.current.gs.step(-1));
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.view?.cursor).toBe(0);
    expect(result.current.gs.play('cc')).toBe(false);
    act(() => result.current.gs.step(1));
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.room).not.toBeNull();
    // Continue from here starts a solo game against the last solo opponent (the first-run default,
    // the computer); the room itself is untouched (DESIGN 12.3).
    act(() => {
      expect(result.current.gs.continueFromHere()).toBe(true);
    });
    expect(result.current.gs.room).toBeNull();
    expect(result.current.gs.session?.mode).toBe('computer');
    expect(result.current.gs.session?.game.cursor).toBe(1);
    expect(store.rooms().map((r) => r.code)).toEqual(['RMH003']);
  });
});

describe('room review against the room game moving on', () => {
  /** An invite link opens room RMR001 on a fake controller; `c()` is the controller now in use. */
  function roomSetup() {
    const made: FakeController[] = [];
    const r = setup('/?s=RMR001&o=r', seq(0.1), {
      rooms: true,
      room: {
        broker: null,
        manualEnabled: false,
        locks: null,
        turnStorage: null,
        window: null,
        document: null,
        createController: (o: RoomControllerOptions) => {
          const fake = createFakeController(o);
          made.push(fake);
          return fake;
        },
      },
    });
    expect(r.result.current.gs.room).not.toBeNull();
    return { ...r, c: () => made[made.length - 1] };
  }

  function gameOf(moves: string[]) {
    let g = zengo.newGame(makeSettings(9));
    for (const m of moves) g = zengo.play(g, m, 0);
    return g;
  }

  const live = { seat: 0, color: 'B', live: true, phase: 'live', presence: 'connected' } as const;

  it('a rematch ends the review of the finished game: the new game is live and playable', () => {
    const { result, c } = roomSetup();
    const over = zengo.end(gameOf(['cc', 'gg', 'cg']), { winner: 'B', by: 'resign' });
    act(() => c().set({ ...live, game: over, n: 1, canMove: false, myTurn: false }));
    expect(result.current.gs.isOver).toBe(true);
    act(() => result.current.gs.goto(1));
    expect(result.current.gs.phase).toBe('review');
    // Game 2 starts with this device to move.
    act(() => c().set({ game: zengo.newGame(makeSettings(9)), n: 2, canMove: true, myTurn: true }));
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.reviewCursor).toBeNull();
    expect(result.current.gs.isPlayerTurn).toBe(true);
    act(() => {
      expect(result.current.gs.play('dd')).toBe(true);
    });
    expect(c().move).toHaveBeenCalledWith('dd', undefined);
    // Game 2 reaching the old review's cursor does not bring that review back.
    act(() => c().set({ game: gameOf(['dd', 'ff']), canMove: true, myTurn: true }));
    expect(result.current.gs.phase).toBe('playing');
  });

  it('a takeback to the reviewed position ends the review; one that stops short keeps it', () => {
    const { result, c } = roomSetup();
    act(() => c().set({ ...live, game: gameOf(['cc', 'gg', 'cg', 'gc']), n: 1, epoch: 0, canMove: true, myTurn: true }));
    act(() => result.current.gs.goto(1));
    expect(result.current.gs.reviewCursor).toBe(1);
    // A takeback of one ply leaves the review where it was.
    act(() => c().set({ game: gameOf(['cc', 'gg', 'cg']), epoch: 1, canMove: false, myTurn: false }));
    expect(result.current.gs.phase).toBe('review');
    expect(result.current.gs.reviewCursor).toBe(1);
    expect(result.current.gs.canStepForward).toBe(true);
    // A takeback down to the reviewed position: live again, this device to move.
    act(() => c().set({ game: gameOf(['cc']), epoch: 2, canMove: true, myTurn: true }));
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.reviewCursor).toBeNull();
    expect(result.current.gs.isPlayerTurn).toBe(true);
    act(() => {
      expect(result.current.gs.pass()).toBe(true);
    });
    // Play going on past the old cursor stays live.
    act(() => c().set({ game: gameOf(['cc', 'gg', 'cg']), canMove: true, myTurn: true }));
    expect(result.current.gs.phase).toBe('playing');
    expect(result.current.gs.reviewCursor).toBeNull();
  });

  it('entering review at the live position of a room stays live; an earlier cursor reviews', () => {
    const { result, c } = roomSetup();
    act(() => c().set({ ...live, game: gameOf(['cc', 'gg']), n: 1, canMove: true, myTurn: true }));
    act(() => result.current.gs.enterReview());
    expect(result.current.gs.phase).toBe('playing');
    act(() => result.current.gs.enterReview(1));
    expect(result.current.gs.reviewCursor).toBe(1);
    act(() => {
      expect(result.current.gs.undo()).toBe(false);
    });
    act(() => result.current.gs.exitReview());
    expect(result.current.gs.phase).toBe('playing');
  });
});
