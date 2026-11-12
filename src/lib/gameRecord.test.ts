import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPPONENT,
  applyAccept,
  applyEnd,
  applyGoto,
  applyMarks,
  applyMove,
  applyPass,
  applyRedo,
  applyReopen,
  applyResign,
  applyResume,
  applyScoreEnd,
  applyTimeout,
  applyToggle,
  applyTouch,
  applyUndo,
  applyUndoPass,
  computerToMove,
  continueSpec,
  createSession,
  findSolo,
  freshCode,
  gameFromSaved,
  groupByTime,
  isRunning,
  isScoring,
  parseClockPref,
  parseColorChoice,
  parseOpponent,
  redoTarget,
  resolveColor,
  sessionFromSaved,
  sgfOf,
  sizeForMoves,
  startPillFor,
  toSavedGame,
  undoRuleFor,
  undoTarget,
  viewOf,
  type GameSession,
} from './gameRecord';
import type { Game, SavedGame } from './types';
import zigo, { makeSettings } from './zigo';

const S9 = makeSettings(9);

function playAll(g: Game, points: string[]): Game {
  return points.reduce((acc, m) => zigo.play(acc, m, 100), g);
}

function session(over: Partial<Parameters<typeof createSession>[0]> = {}, at = 1000): GameSession {
  return createSession({ code: 'ABC123', mode: 'local', color: 'B', tc: null, ...over }, at);
}

function playS(s: GameSession, points: string[], ms = 10, at = 1): GameSession {
  return points.reduce((acc, m) => {
    const next = applyMove(acc, m, ms, at);
    if (!next) throw new Error(`refused ${m}`);
    return next;
  }, s);
}

function saved(id: string, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    id,
    code: id.split('.')[0],
    mode: 'local',
    color: 'B',
    size: 9,
    rules: 'area',
    handicap: 0,
    tc: null,
    moves: '',
    ms: [],
    assisted: false,
    createdAt: 1,
    lastPlayedAt: 1,
    ...extra,
  };
}

/** Sequence rng for deterministic codes. */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

/**
 * A finished-looking 9×9: Black's wall on column e, White's on column f, a black stone at `aa` and
 * a dead white stone at `bb` inside Black's area. Area count with `bb` dead: B 10 + 35 = 45,
 * W 9 + 27 + 7.5 = 43.5 → B+1.5.
 */
const WALLS: string[] = (() => {
  const rows = 'abcdefghi';
  const out: string[] = [];
  for (const r of rows) out.push(`e${r}`, `f${r}`);
  out.push('aa', 'bb');
  return out;
})();

/** A pass-and-play session at the walls position after two passes (scoring round 1). */
function scoringSession(over: Partial<Parameters<typeof createSession>[0]> = {}): GameSession {
  let s = playS(session(over), WALLS);
  s = applyPass(s, 5, 2)!;
  s = applyPass(s, 5, 3)!;
  return s;
}

describe('settings parsing', () => {
  it('reads opponents defensively', () => {
    expect(parseOpponent(null)).toEqual(DEFAULT_OPPONENT);
    expect(parseOpponent('nonsense')).toEqual(DEFAULT_OPPONENT);
    expect(parseOpponent({ mode: 'room' })).toEqual({ mode: 'room' });
    expect(parseOpponent({ mode: 'local' })).toEqual({ mode: 'local' });
    expect(parseOpponent({ mode: 'computer', level: 9 })).toEqual({ mode: 'computer', level: 9 });
    expect(parseOpponent({ mode: 'computer', level: 40 })).toEqual({ mode: 'computer', level: 5 });
  });

  it('reads color and clock prefs', () => {
    expect(parseColorChoice('B')).toBe('B');
    expect(parseColorChoice('W')).toBe('W');
    expect(parseColorChoice('w')).toBe('random');
    expect(parseColorChoice('x')).toBe('random');
    expect(parseClockPref('off')).toBeNull();
    expect(parseClockPref(null)).toBeNull();
    expect(parseClockPref('5+7')).toBe('5+7');
    expect(parseClockPref('20m 5x30s')).toBe('20m5x30');
    expect(parseClockPref(5)).toBeNull();
  });

  it('resolves colors: pass-and-play is Black, random flips a coin', () => {
    expect(resolveColor('W', 'local', () => 0.9)).toBe('B');
    expect(resolveColor('W', 'computer', () => 0.1)).toBe('W');
    expect(resolveColor('random', 'computer', () => 0.1)).toBe('B');
    expect(resolveColor('random', 'computer', () => 0.9)).toBe('W');
  });

  it('generates codes no stored game uses', () => {
    // rng 0 → "000000", then 0.5 → "IIIIII"
    const games = [saved('000000')];
    const rng = seq(0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
    expect(freshCode(games, rng)).toBe('IIIIII');
  });

  it('infers the size of a link without n from its moves', () => {
    expect(sizeForMoves('', 13)).toBe(13);
    expect(sizeForMoves('eeiitt', 19)).toBe(9);
    expect(sizeForMoves('eejj', 9)).toBe(13);
    expect(sizeForMoves('ddpp', 9)).toBe(19);
  });
});

describe('undo and redo rules', () => {
  it('maps modes to rules', () => {
    expect(undoRuleFor('local')).toBe('ply');
    expect(undoRuleFor('computer')).toBe('turn');
    expect(undoRuleFor('room')).toBe('request');
  });

  it('pass-and-play steps one ply', () => {
    const g = playAll(zigo.newGame(S9), ['ee', 'cc', 'gg']);
    expect(undoTarget(g, 'ply', 'B')).toBe(2);
    const back = zigo.undo(g, 1);
    expect(redoTarget(back, 'ply', 'B')).toBe(3);
    expect(undoTarget(zigo.newGame(S9), 'ply', 'B')).toBe(0);
  });

  it('computer: one full turn back when the player is to move', () => {
    const g = playAll(zigo.newGame(S9), ['ee', 'cc', 'gg', 'dd']);
    expect(undoTarget(g, 'turn', 'B')).toBe(2);
    const back = zigo.undo(g, 2);
    // Redo replays both plies.
    expect(redoTarget(back, 'turn', 'B')).toBe(4);
  });

  it('computer: only the player move while the computer is thinking', () => {
    const g = playAll(zigo.newGame(S9), ['ee', 'cc', 'gg']);
    expect(undoTarget(g, 'turn', 'B')).toBe(2);
  });

  it('computer: White undoing the first turn goes to the start (the computer moves again)', () => {
    const g1 = playAll(zigo.newGame(S9), ['ee']);
    expect(undoTarget(g1, 'turn', 'W')).toBe(0);
    const g3 = playAll(zigo.newGame(S9), ['ee', 'cc', 'gg']);
    expect(undoTarget(g3, 'turn', 'W')).toBe(1);
  });

  it('computer: in a handicap game White moves first, so Black undoing the first turn goes to the start', () => {
    const g = playAll(zigo.newGame(makeSettings(9, 'area', 2)), ['ee']);
    expect(g.turn).toBe('B');
    expect(undoTarget(g, 'turn', 'B')).toBe(0);
  });

  it('redo to the end of a tail that stops on the computer turn', () => {
    const g = zigo.undo(playAll(zigo.newGame(S9), ['ee', 'cc', 'gg']), 3);
    expect(redoTarget(g, 'turn', 'B')).toBe(2);
    expect(redoTarget(zigo.redo(g, 2), 'turn', 'B')).toBe(3);
  });

  it('passes are plies like stones', () => {
    const g = playAll(zigo.newGame(S9), ['ee', 'tt', 'gg']);
    expect(undoTarget(g, 'ply', 'B')).toBe(2);
    expect(undoTarget(g, 'turn', 'B')).toBe(2);
    expect(undoTarget(zigo.undo(g, 1), 'turn', 'B')).toBe(0);
  });

  it('rooms have no local undo', () => {
    const g = playAll(zigo.newGame(S9), ['ee']);
    expect(undoTarget(g, 'request', 'B')).toBe(1);
    expect(redoTarget(zigo.undo(g, 1), 'request', 'B')).toBe(0);
  });
});

describe('session transitions', () => {
  it('a new session counts as played, has no review, and carries the settings', () => {
    const s = session({}, 5000);
    expect(s.touched).toBe(true);
    expect(s.createdAt).toBe(5000);
    expect(s.lastPlayedAt).toBe(5000);
    expect(s.review).toBeNull();
    expect(s.level).toBeUndefined();
    expect(s.game.settings).toEqual({ size: 9, rules: 'area', handicap: 0, komi2: 15 });
    expect(session({ mode: 'computer' }).level).toBe(5);
    expect(session({ mode: 'local', color: 'W' }).color).toBe('B');
    const h = session({ settings: { size: 13, rules: 'territory', handicap: 3 } });
    expect(h.game.settings).toEqual({ size: 13, rules: 'territory', handicap: 3, komi2: 1 });
    expect(h.game.turn).toBe('W');
    expect([...h.game.board].filter((v) => v === 1)).toHaveLength(3);
  });

  it('moves record ms and bump lastPlayedAt; illegal moves are refused', () => {
    const s = session({}, 1000);
    const a = applyMove(s, 'ee', 1234, 2000)!;
    expect(a.game.plies).toEqual([{ m: 'ee', ms: 1234 }]);
    expect(a.lastPlayedAt).toBe(2000);
    expect(applyMove(a, 'ee', 0, 3000)).toBeNull();
    expect(applyMove(a, 'zz', 0, 3000)).toBeNull();
    // Off the 9×9 board.
    expect(applyMove(a, 'kk', 0, 3000)).toBeNull();
  });

  it('a pass is a move; the second consecutive pass enters scoring and stops the clock', () => {
    let s = playS(session(), ['ee']);
    s = applyPass(s, 700, 2)!;
    expect(s.game.plies[1]).toEqual({ m: 'tt', ms: 700 });
    expect(s.game.passes).toBe(1);
    expect(isRunning(s)).toBe(true);
    s = applyPass(s, 300, 3)!;
    expect(isScoring(s)).toBe(true);
    expect(s.game.scoring).toMatchObject({ round: 1, rev: 0, dead: [] });
    expect(isRunning(s)).toBe(false);
    expect(applyMove(s, 'cc', 1, 4)).toBeNull();
    expect(applyPass(s, 1, 4)).toBeNull();
    expect(applyResign(s, 4)).toBeNull();
    expect(applyTimeout(s, 'B', 4)).toBeNull();
  });

  it('undo marks assisted and keeps a session-only redo tail', () => {
    const s = playS(session(), ['ee', 'cc', 'gg']);
    const u = applyUndo(s, 50)!;
    expect(u.assisted).toBe(true);
    expect(u.game.cursor).toBe(2);
    expect(u.lastPlayedAt).toBe(50);
    const rec = toSavedGame(u);
    expect(zigo.decodeMoves(rec.moves)).toEqual(['ee', 'cc']);
    expect(rec.ms).toEqual([10, 10]);
    const r = applyRedo(u, 60)!;
    expect(r.game.cursor).toBe(3);
    expect(applyRedo(r, 70)).toBeNull();
    expect(applyUndo(session(), 1)).toBeNull();
  });

  it('undo and redo cross passes and leave and re-enter scoring', () => {
    let s = playS(session(), ['ee']);
    s = applyPass(applyPass(s, 1, 2)!, 1, 3)!;
    s = applyToggle(s, 'ee', 4)!;
    expect(s.game.scoring!.dead).toEqual(['ee']);
    let u = applyUndo(s, 5)!;
    expect(u.game.scoring).toBeUndefined();
    expect(u.game.passes).toBe(1);
    u = applyUndo(u, 6)!;
    expect(u.game.passes).toBe(0);
    expect(u.game.cursor).toBe(1);
    const r = applyRedo(applyRedo(u, 7)!, 8)!;
    expect(isScoring(r)).toBe(true);
    // The marks come back with redo.
    expect(r.game.scoring!.dead).toEqual(['ee']);
  });

  it('computer undo takes back a full turn', () => {
    const s = playS(session({ mode: 'computer', color: 'B', level: 3 }), ['ee', 'cc', 'gg', 'dd']);
    const u = applyUndo(s, 2)!;
    expect(u.game.cursor).toBe(2);
    expect(applyRedo(u, 3)!.game.cursor).toBe(4);
  });

  it('a move after undo drops the redo tail', () => {
    let s = playS(session(), ['ee', 'cc']);
    s = applyMove(applyUndo(s, 2)!, 'gc', 5, 3)!;
    expect(s.game.plies.map((p) => p.m)).toEqual(['ee', 'gc']);
    expect(applyRedo(s, 4)).toBeNull();
  });

  it('resign: the side to move in pass-and-play, the player against the computer; reopen takes it back', () => {
    let local = playS(session(), ['ee']);
    local = applyResign(local, 2)!;
    expect(local.game.end).toEqual({ result: { winner: 'B', by: 'resign' } });
    expect(applyMove(local, 'cc', 1, 3)).toBeNull();
    expect(applyResign(local, 3)).toBeNull();
    const back = applyReopen(local, 4)!;
    expect(back.game.end).toBeUndefined();
    expect(applyReopen(back, 5)).toBeNull();

    const comp = applyResign(session({ mode: 'computer', color: 'W' }), 2)!;
    expect(comp.game.end).toEqual({ result: { winner: 'B', by: 'resign' } });
  });

  it('a scored ending cannot be reopened', () => {
    const s = applyAccept(scoringSession(), null, 9)!;
    expect(s.game.end?.result.by).toBe('score');
    expect(applyReopen(s, 10)).toBeNull();
  });

  it('finish and timeout end the game', () => {
    const resigned = applyEnd(session({ mode: 'computer', color: 'B' }), { winner: 'B', by: 'resign' }, 2)!;
    expect(resigned.game.end).toEqual({ result: { winner: 'B', by: 'resign' } });
    expect(applyEnd(resigned, { winner: 'W', by: 'resign' }, 3)).toBeNull();
    const flagged = applyTimeout(playS(session(), ['ee']), 'W', 3)!;
    expect(flagged.game.end).toEqual({ result: { winner: 'B', by: 'time' } });
    // A time-out can be taken back like a resignation.
    expect(applyReopen(flagged, 4)!.game.end).toBeUndefined();
  });

  it('the 15-second touch moves lastPlayedAt once', () => {
    const s = sessionFromSaved(saved('K7QW2M', { lastPlayedAt: 10 }), 100);
    expect(s.touched).toBe(false);
    expect(s.lastPlayedAt).toBe(10);
    const t = applyTouch(s, 15100);
    expect(t.touched).toBe(true);
    expect(t.lastPlayedAt).toBe(15100);
    expect(applyTouch(t, 99999)).toBe(t);
  });
});

describe('the pass undo toast (DESIGN 6.2)', () => {
  it('pass-and-play: takes back the last pass without a redo tail and without assistance', () => {
    let s = playS(session(), ['ee']);
    s = applyPass(s, 1, 2)!;
    const u = applyUndoPass(s, 3)!;
    expect(u.game.plies.map((p) => p.m)).toEqual(['ee']);
    expect(u.game.cursor).toBe(1);
    expect(u.assisted).toBe(false);
    expect(applyRedo(u, 4)).toBeNull();
    // Only when the last ply is a pass.
    expect(applyUndoPass(playS(session(), ['ee']), 3)).toBeNull();
  });

  it('the second pass: back out of scoring', () => {
    const s = scoringSession();
    const u = applyUndoPass(s, 9)!;
    expect(u.game.scoring).toBeUndefined();
    expect(u.game.passes).toBe(1);
  });

  it('against the computer: the player pass even after the computer answered', () => {
    let s = playS(session({ mode: 'computer', color: 'B' }), ['ee', 'cc']);
    s = applyPass(s, 1, 2)!;
    // The computer answers while the toast is up.
    s = applyMove(s, 'gg', 1, 3)!;
    const u = applyUndoPass(s, 4)!;
    expect(u.game.plies.map((p) => p.m)).toEqual(['ee', 'cc']);
    expect(u.game.turn).toBe('B');
    // The player's latest move is a stone: nothing to take back.
    expect(applyUndoPass(playS(session({ mode: 'computer', color: 'B' }), ['ee', 'tt', 'cc']), 4)).toBeNull();
  });

  it('lifts a round-2 ending the pass caused, but never an Accept', () => {
    let s = applyResume(scoringSession(), 5)!;
    s = applyPass(s, 1, 6)!;
    s = applyPass(s, 1, 7)!;
    expect(s.game.scoring!.round).toBe(2);
    s = applyScoreEnd(s, [], 8)!;
    expect(s.game.end).toBeDefined();
    const u = applyUndoPass(s, 9)!;
    expect(u.game.end).toBeUndefined();
    expect(u.game.scoring).toBeUndefined();
    expect(u.game.passes).toBe(1);
    expect(applyUndoPass(applyAccept(scoringSession(), null, 9)!, 10)).toBeNull();
  });
});

describe('scoring (DESIGN 8.4)', () => {
  it('toggles whole groups, bumps rev and clears acceptances', () => {
    const s = scoringSession();
    const t = applyToggle(s, 'bb', 10)!;
    expect(t.game.scoring).toMatchObject({ round: 1, rev: 1, dead: ['bb'], accepted: [0, 0] });
    expect(t.lastPlayedAt).toBe(10);
    // A whole wall at once.
    const wall = applyToggle(t, 'fa', 11)!;
    expect(wall.game.scoring!.dead).toHaveLength(10);
    expect(applyToggle(wall, 'fa', 12)!.game.scoring!.dead).toEqual(['bb']);
    // An empty point does nothing.
    expect(applyToggle(t, 'cc', 12)).toBeNull();
    // Not outside scoring.
    expect(applyToggle(session(), 'ee', 12)).toBeNull();
  });

  it('Accept without a side ends the game with the marking as shown', () => {
    const s = applyToggle(scoringSession(), 'bb', 10)!;
    const done = applyAccept(s, null, 11)!;
    expect(done.game.end).toEqual({ result: { winner: 'B', by: 'score', margin: 3 } });
    expect(done.game.scoring!.dead).toEqual(['bb']);
    expect(toSavedGame(done)).toMatchObject({ result: { winner: 'B', by: 'score', margin: 3 }, scoring: { dead: ['bb'] } });
    // Unmarked, the white stone lives and White wins.
    expect(applyAccept(scoringSession(), null, 11)!.game.end!.result.winner).toBe('W');
  });

  it('territory rules give the territory margin for the same position', () => {
    let s = playS(session({ settings: { size: 9, rules: 'territory', handicap: 0 } }), WALLS);
    s = applyPass(applyPass(s, 1, 2)!, 1, 3)!;
    s = applyToggle(s, 'bb', 4)!;
    // B 35 territory (bb included) + 1 prisoner = 36, W 27 + 6.5 = 33.5 → B+2.5.
    expect(applyAccept(s, null, 5)!.game.end!.result).toEqual({ winner: 'B', by: 'score', margin: 5 });
  });

  it('face to face: both Accepts of the same marking end the game; a toggle clears them', () => {
    const s = scoringSession();
    const b = applyAccept(s, 'B', 10)!;
    expect(b.game.end).toBeUndefined();
    expect(b.game.scoring).toMatchObject({ rev: 1, accepted: [1, 0] });
    const toggled = applyToggle(b, 'bb', 11)!;
    expect(toggled.game.scoring).toMatchObject({ rev: 2, accepted: [0, 0] });
    const w = applyAccept(toggled, 'W', 12)!;
    expect(w.game.end).toBeUndefined();
    const both = applyAccept(w, 'B', 13)!;
    expect(both.game.end!.result).toEqual({ winner: 'B', by: 'score', margin: 3 });
  });

  it('Resume plays on; the next double pass is round 2', () => {
    const r = applyResume(applyToggle(scoringSession(), 'bb', 10)!, 11)!;
    expect(isScoring(r)).toBe(false);
    expect(r.game.scoring).toBeUndefined();
    expect(isRunning(r)).toBe(true);
    let s = applyPass(r, 1, 12)!;
    s = applyPass(s, 1, 13)!;
    expect(s.game.scoring).toMatchObject({ round: 2, rev: 0, dead: [] });
    // Round 2 is scored at once: with every stone alive when there is no engine.
    const done = applyScoreEnd(s, [], 14)!;
    expect(done.game.end!.result.winner).toBe('W');
    expect(applyResume(done, 15)).toBeNull();
  });

  it('a proposal replaces the marks; scoring ends with a proposal too', () => {
    const s = scoringSession();
    const m = applyMarks(s, ['bb', 'cc'], 10)!;
    // Only stones are kept.
    expect(m.game.scoring).toMatchObject({ rev: 1, dead: ['bb'] });
    expect(applyMarks(session(), ['bb'], 10)).toBeNull();
    const end = applyScoreEnd(s, ['bb'], 11)!;
    expect(end.game.end!.result).toEqual({ winner: 'B', by: 'score', margin: 3 });
    expect(end.game.scoring!.dead).toEqual(['bb']);
  });

  it('reload during scoring keeps the marks', () => {
    const s = applyToggle(scoringSession(), 'bb', 10)!;
    const back = sessionFromSaved(toSavedGame(s), 20);
    expect(isScoring(back)).toBe(true);
    expect(back.game.scoring).toMatchObject({ round: 1, rev: 1, dead: ['bb'] });
    expect(back.review).toBeNull();
  });
});

describe('stored games', () => {
  it('round-trips a session through SavedGame', () => {
    let s = session(
      { code: 'K7QW2M', mode: 'computer', level: 7, color: 'W', tc: '5+7', settings: { size: 13, rules: 'territory', handicap: 2 } },
      100,
    );
    s = playS(s, ['dd', 'jj'], 700, 200);
    const rec = toSavedGame(s);
    expect(rec).toMatchObject({
      id: 'K7QW2M',
      code: 'K7QW2M',
      mode: 'computer',
      level: 7,
      color: 'W',
      size: 13,
      rules: 'territory',
      handicap: 2,
      tc: '5+7',
      moves: 'ddjj',
      ms: [700, 700],
      assisted: false,
      createdAt: 100,
      lastPlayedAt: 200,
    });
    expect(rec.result).toBeUndefined();
    expect(rec.scoring).toBeUndefined();
    const back = sessionFromSaved(rec, 300);
    expect([...back.game.board]).toEqual([...s.game.board]);
    expect(back.game.settings).toEqual(s.game.settings);
    expect(back.game.cursor).toBe(2);
    expect(back.review).toBeNull();
    expect(back.openedAt).toBe(300);
  });

  it('finished games carry their result and open in review at the end', () => {
    let s = playS(session(), ['ee', 'cc']);
    s = applyResign(s, 2)!;
    const rec = toSavedGame(s);
    expect(rec.result).toEqual({ winner: 'W', by: 'resign' });
    const back = sessionFromSaved(rec, 3);
    expect(back.game.end).toEqual({ result: { winner: 'W', by: 'resign' } });
    expect(back.review).toBe(2);
  });

  it('survives a corrupt move string', () => {
    const g = gameFromSaved(saved('X', { moves: '!!!!' }));
    expect(g.cursor).toBe(0);
    // An illegal tail is cut.
    expect(gameFromSaved(saved('Y', { moves: 'eeee' })).cursor).toBe(1);
  });
});

describe('review', () => {
  function finished(): GameSession {
    const s = applyResign(playS(session(), ['ee', 'cc', 'gg', 'dd', 'ec', 'tt', 'gc']), 2)!;
    return sessionFromSaved(toSavedGame(s), 2);
  }

  it('steps through a finished game and stays in review at the end', () => {
    const s = finished();
    expect(s.review).toBe(7);
    const a = applyGoto(s, 3);
    expect(a.review).toBe(3);
    expect(viewOf(a).cursor).toBe(3);
    expect(viewOf(a).end).toEqual({ result: { winner: 'B', by: 'resign' } });
    expect(applyGoto(a, -5).review).toBe(0);
    expect(applyGoto(a, 99).review).toBe(7);
    expect(applyMove(a, 'aa', 1, 1)).toBeNull();
    expect(applyUndo(a, 1)).toBeNull();
  });

  it('a live game runs on in review: the computer still moves and a flag still falls (DESIGN 11)', () => {
    const s = playS(session({ mode: 'computer', color: 'B', tc: '1+0' }), ['ee', 'cc', 'gg']);
    const r = applyGoto(s, 1);
    expect(r.review).toBe(1);
    expect(isRunning(r)).toBe(true);
    expect(computerToMove(r)).toBe(true);
    // The computer (White) answers; the player stays at the reviewed move.
    const after = applyMove(r, 'dd', 500, 2)!;
    expect(after.game.cursor).toBe(4);
    expect(after.review).toBe(1);
    // The player's own moves still need the live board.
    expect(applyMove(after, 'cg', 1, 3)).toBeNull();
    const flagged = applyTimeout(after, 'B', 4)!;
    expect(flagged.game.end).toMatchObject({ result: { by: 'time' } });
    expect(isRunning(flagged)).toBe(false);
  });

  it('reaching the live position of an unfinished game leaves review', () => {
    const s = playS(session(), ['ee', 'cc', 'gg']);
    const r = applyGoto(s, 1);
    expect(r.review).toBe(1);
    expect(applyGoto(r, 3).review).toBeNull();
    expect(applyGoto(s, 3)).toBe(s);
  });

  it('continue from here: a new game with the shown plies, ms zeroed, side to move for the player', () => {
    const s = applyGoto(finished(), 3);
    const spec = continueSpec(viewOf(s), { mode: 'computer', level: 8 }, 'NEW123', null)!;
    expect(spec.mode).toBe('computer');
    expect(spec.level).toBe(8);
    expect(spec.color).toBe('W');
    expect(spec.game!.cursor).toBe(3);
    expect(spec.game!.end).toBeUndefined();
    expect(spec.game!.plies.every((p) => p.ms === 0)).toBe(true);
    const local = continueSpec(viewOf(s), { mode: 'local' }, 'NEW123', '5+7')!;
    expect(local.mode).toBe('local');
    expect(local.color).toBe('B');
    expect(local.tc).toBe('5+7');
    // The end position of a resigned game continues too (Go has no automatic ending on the board).
    expect(continueSpec(viewOf(finished()), { mode: 'local' }, 'X', null)!.game!.cursor).toBe(7);
    const fresh = createSession(spec, 9);
    expect(fresh.review).toBeNull();
    expect(fresh.touched).toBe(true);
  });

  it('continue from here keeps size, rules and handicap; after two passes it continues in scoring', () => {
    let s = session({ settings: { size: 13, rules: 'territory', handicap: 3 } });
    s = playS(s, ['jj', 'cc']);
    s = applyPass(applyPass(s, 1, 2)!, 1, 3)!;
    s = applyAccept(applyToggle(s, 'cc', 4)!, null, 5)!;
    const spec = continueSpec(viewOf(s), { mode: 'local' }, 'CONT01', null)!;
    expect(spec.game!.settings).toEqual({ size: 13, rules: 'territory', handicap: 3, komi2: 1 });
    expect(spec.game!.scoring).toMatchObject({ round: 1, rev: 0, dead: [] });
    expect(spec.game!.end).toBeUndefined();
    const mid = continueSpec(zigo.goto(s.game, 1), { mode: 'local' }, 'CONT02', null)!;
    expect([...mid.game!.board].filter((v) => v === 1)).toHaveLength(3);
    expect(mid.game!.turn).toBe('B');
  });
});

describe('SGF export (DESIGN 13.3)', () => {
  it('names the computer, the date and the clock', () => {
    const at = new Date(2026, 10, 12, 9, 0, 0).getTime();
    let s = createSession({ code: 'SGF001', mode: 'computer', level: 5, color: 'B', tc: '5+7', settings: { size: 13, rules: 'area', handicap: 0 } }, at);
    s = playS(s, ['dd', 'jj']);
    s = applyResign(s, at)!;
    const text = sgfOf(s, 'abc123');
    expect(text).toContain('AP[Zigo:abc123]');
    expect(text).toContain('SZ[13]');
    expect(text).toContain('PW[Zigo Level 5]');
    expect(text).not.toContain('PB[');
    expect(text).toContain('DT[2026-11-12]');
    expect(text).toContain('RE[W+R]');
    expect(text).toContain('TM[300]');
    expect(text).toContain(';B[dd];W[jj]');
  });
});

describe('start pill', () => {
  const games = [
    saved('AAAAAA'),
    saved('BBBBBB', { result: { winner: 'B', by: 'score', margin: 9 } }),
    saved('CCCCCC.1', { mode: 'room' }),
  ];

  it('labels per DESIGN 4.1', () => {
    expect(startPillFor('ZZZZZZ', { mode: 'local' }, games).label).toBe('start');
    expect(startPillFor('AAAAAA', { mode: 'computer', level: 3 }, games)).toEqual({ label: 'resume', saved: games[0] });
    expect(startPillFor('BBBBBB', { mode: 'local' }, games).label).toBe('review');
    expect(startPillFor('AAAAAA', { mode: 'room' }, games)).toEqual({ label: 'start', saved: null });
    // Room games do not make a solo code "known".
    expect(startPillFor('CCCCCC', { mode: 'local' }, games).label).toBe('start');
    expect(findSolo(games, 'CCCCCC.1')).toBeNull();
  });
});

describe('time groups', () => {
  it('groups like Zudoku and drops empty groups', () => {
    const now = new Date(2026, 10, 11, 15, 0, 0).getTime();
    const day = 86_400_000;
    const g = (id: string, at: number) => saved(id, { lastPlayedAt: at });
    const list = [
      g('OLD', now - 400 * day),
      g('TODAY', now - 60_000),
      g('WEEK', now - 3 * day),
      g('MONTH', now - 20 * day),
      g('YEAR', now - 100 * day),
    ];
    const groups = groupByTime(list, now);
    expect(groups.map((x) => x.key)).toEqual(['today', 'week', 'month', 'year', 'older']);
    expect(groups.map((x) => x.games[0].id)).toEqual(['TODAY', 'WEEK', 'MONTH', 'YEAR', 'OLD']);
    expect(groupByTime([g('A', now - 2 * day)], now).map((x) => x.key)).toEqual(['week']);
    expect(groupByTime([], now)).toEqual([]);
  });
});
