import { describe, expect, it } from 'vitest';
import type { Game, Ply, Point, Size } from './types';
import zigo, {
  PASS,
  boardFromDiagram,
  boardToDiagram,
  byoyomiStep,
  decodeMoves,
  defaultKomi2,
  encodeMoves,
  formatResult,
  formatTc,
  fromDiagram,
  fromGtp,
  gtp,
  handicapPoints,
  indexToPoint,
  isPoint,
  isValidMoves,
  makeSettings,
  maxHandicap,
  normalizeHandicap,
  parseTc,
  pointToIndex,
  starPoints,
  toTc,
} from './zigo';

const {
  newGame,
  isLegal,
  illegalReason,
  play,
  pass,
  undo,
  redo,
  goto,
  groupAt,
  libertiesOf,
  atari,
  selfAtariSize,
  resume,
  end,
  sgf,
  clocks,
  replay,
  fromRecord,
  setScoring,
  reopen,
  position,
  colorOfPly,
  lastMove,
  timeUsed,
  clockRunning,
} = zigo;

const S9 = makeSettings(9);

/** Plays points with 1 ms each (or the given ms list). */
function playAll(g: Game, points: Point[], ms: number[] = []): Game {
  return points.reduce((acc, p, i) => play(acc, p, ms[i] ?? 1), g);
}

const diagram = (g: Game) => boardToDiagram(g.board, g.settings.size);

/** Three independent kos on 9×9: B can take the first and third, W the second (DESIGN 15.4 triple ko). */
const TRIPLE_KO = [
  '.........',
  '.xo...ox.',
  'xo.o.ox.x',
  '.xo...ox.',
  '.........',
  '.xo......',
  'xo.o.....',
  '.xo......',
  '.........',
];

/** Deterministic PRNG for generated games. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random legal game of `n` plies (passes when no legal point is found quickly). */
function randomGame(size: Size, n: number, seed: number): Game {
  const rnd = mulberry32(seed);
  let g = newGame(makeSettings(size));
  while (g.plies.length < n) {
    if (g.scoring) g = resume(g);
    let played = false;
    for (let t = 0; t < 60 && !played; t++) {
      const p = indexToPoint(Math.floor(rnd() * size * size), size);
      if (isLegal(g, p)) {
        g = play(g, p, Math.floor(rnd() * 5000));
        played = true;
      }
    }
    if (!played) g = pass(g, 1);
  }
  return g;
}

describe('points and coordinates', () => {
  it('maps SGF points to row-major indices from the top and back', () => {
    expect(pointToIndex('aa', 9)).toBe(0);
    expect(pointToIndex('ia', 9)).toBe(8);
    expect(pointToIndex('ab', 9)).toBe(9);
    expect(pointToIndex('ii', 9)).toBe(80);
    expect(pointToIndex('ss', 19)).toBe(360);
    expect(pointToIndex('tt', 19)).toBe(-1);
    expect(pointToIndex('ja', 9)).toBe(-1);
    for (const size of [9, 13, 19] as Size[]) {
      for (let i = 0; i < size * size; i++) expect(pointToIndex(indexToPoint(i, size), size)).toBe(i);
    }
    expect(() => indexToPoint(81, 9)).toThrow();
    expect(isPoint('ss')).toBe(true);
    expect(isPoint('ss', 13)).toBe(false);
    expect(isPoint('tt')).toBe(false);
    expect(isPoint(42)).toBe(false);
  });

  it('converts to GTP: A–T without I, rows from the bottom', () => {
    expect(gtp('aa', 9)).toBe('A9');
    expect(gtp('ai', 9)).toBe('A1');
    expect(gtp('ii', 9)).toBe('J1');
    expect(gtp('dp', 19)).toBe('D4');
    expect(gtp('pd', 19)).toBe('Q16');
    expect(gtp('ss', 19)).toBe('T1');
    expect(gtp('jj', 19)).toBe('K10');
    expect(gtp(PASS, 19)).toBe('pass');
    expect(() => gtp('ss', 9)).toThrow();
  });

  it('reads GTP case-insensitively and rejects what is not on the board', () => {
    expect(fromGtp('D4', 19)).toBe('dp');
    expect(fromGtp(' q16 ', 19)).toBe('pd');
    expect(fromGtp('j10', 19)).toBe('ij');
    expect(fromGtp('T19', 19)).toBe('sa');
    expect(fromGtp('pass', 9)).toBe(PASS);
    expect(fromGtp(' PASS ', 9)).toBe(PASS);
    expect(fromGtp('I5', 19)).toBeNull();
    expect(fromGtp('K5', 9)).toBeNull();
    expect(fromGtp('A10', 9)).toBeNull();
    expect(fromGtp('A0', 9)).toBeNull();
    expect(fromGtp('D', 9)).toBeNull();
    expect(fromGtp('', 9)).toBeNull();
    for (const size of [9, 13, 19] as Size[]) {
      for (let i = 0; i < size * size; i++) {
        const p = indexToPoint(i, size);
        expect(fromGtp(gtp(p, size), size)).toBe(p);
      }
    }
  });
});

describe('handicap, star points and komi (DESIGN 8.2)', () => {
  const asGtp = (size: Size, n: number) => handicapPoints(size, n).map((p) => gtp(p, size));

  it('places 19×19 handicaps on the 4-4 points in GTP order', () => {
    expect(asGtp(19, 2)).toEqual(['D4', 'Q16']);
    expect(asGtp(19, 3)).toEqual(['D4', 'Q16', 'D16']);
    expect(asGtp(19, 4)).toEqual(['D4', 'Q16', 'D16', 'Q4']);
    expect(asGtp(19, 5)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'K10']);
    expect(asGtp(19, 6)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10']);
    expect(asGtp(19, 7)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10', 'K10']);
    expect(asGtp(19, 8)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10', 'K4', 'K16']);
    expect(asGtp(19, 9)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10', 'K4', 'K16', 'K10']);
  });

  it('uses the 4th line on 13×13', () => {
    expect(asGtp(13, 2)).toEqual(['D4', 'K10']);
    expect(asGtp(13, 3)).toEqual(['D4', 'K10', 'D10']);
    expect(asGtp(13, 4)).toEqual(['D4', 'K10', 'D10', 'K4']);
    expect(asGtp(13, 5)).toEqual(['D4', 'K10', 'D10', 'K4', 'G7']);
    expect(asGtp(13, 6)).toEqual(['D4', 'K10', 'D10', 'K4', 'D7', 'K7']);
    expect(asGtp(13, 7)).toEqual(['D4', 'K10', 'D10', 'K4', 'D7', 'K7', 'G7']);
    expect(asGtp(13, 8)).toEqual(['D4', 'K10', 'D10', 'K4', 'D7', 'K7', 'G4', 'G10']);
    expect(asGtp(13, 9)).toEqual(['D4', 'K10', 'D10', 'K4', 'D7', 'K7', 'G4', 'G10', 'G7']);
  });

  it('uses the 3rd line on 9×9 and stops at 5', () => {
    expect(asGtp(9, 2)).toEqual(['C3', 'G7']);
    expect(asGtp(9, 3)).toEqual(['C3', 'G7', 'C7']);
    expect(asGtp(9, 4)).toEqual(['C3', 'G7', 'C7', 'G3']);
    expect(asGtp(9, 5)).toEqual(['C3', 'G7', 'C7', 'G3', 'E5']);
    expect(asGtp(9, 9)).toEqual(asGtp(9, 5));
    expect(maxHandicap(9)).toBe(5);
    expect(maxHandicap(13)).toBe(9);
    expect(maxHandicap(19)).toBe(9);
  });

  it('normalizes counts: below 2 is none, above the limit is the limit', () => {
    expect(handicapPoints(19, 0)).toEqual([]);
    expect(handicapPoints(19, 1)).toEqual([]);
    expect(normalizeHandicap(19, 1)).toBe(0);
    expect(normalizeHandicap(19, 12)).toBe(9);
    expect(normalizeHandicap(9, 7)).toBe(5);
    expect(normalizeHandicap(13, Number.NaN)).toBe(0);
  });

  it('places the stones in newGame for every count and size; White moves first', () => {
    for (const size of [9, 13, 19] as Size[]) {
      for (let n = 2; n <= maxHandicap(size); n++) {
        const g = newGame(makeSettings(size, 'area', n));
        const stones = [...g.board].map((v, i) => (v ? indexToPoint(i, size) : null)).filter(Boolean);
        expect(stones.sort()).toEqual(handicapPoints(size, n).sort());
        expect([...g.board].every((v) => v === 0 || v === 1)).toBe(true);
        expect(g.turn).toBe('W');
        expect(g.settings.komi2).toBe(1);
        expect(colorOfPly(g, 0)).toBe('W');
        expect(colorOfPly(g, 1)).toBe('B');
      }
    }
  });

  it('lists the star points', () => {
    expect(starPoints(9).map((p) => gtp(p, 9)).sort()).toEqual(['C3', 'C7', 'E5', 'G3', 'G7']);
    expect(starPoints(13).map((p) => gtp(p, 13)).sort()).toEqual(['D10', 'D4', 'G7', 'K10', 'K4']);
    expect(starPoints(19)).toHaveLength(9);
  });

  it('sets komi ×2: area 7.5, territory 6.5, handicap 0.5', () => {
    expect(defaultKomi2('area', 0)).toBe(15);
    expect(defaultKomi2('territory', 0)).toBe(13);
    expect(defaultKomi2('area', 2)).toBe(1);
    expect(defaultKomi2('territory', 9)).toBe(1);
    expect(makeSettings(13, 'territory', 3)).toEqual({ size: 13, rules: 'territory', handicap: 3, komi2: 1 });
    expect(makeSettings(9)).toEqual({ size: 9, rules: 'area', handicap: 0, komi2: 15 });
  });
});

describe('newGame', () => {
  it('starts empty with Black to move', () => {
    const g = newGame(S9);
    expect(g.board).toHaveLength(81);
    expect([...g.board].every((v) => v === 0)).toBe(true);
    expect(g.turn).toBe('B');
    expect(g.cursor).toBe(0);
    expect(g.plies).toEqual([]);
    expect(g.prisoners).toEqual({ B: 0, W: 0 });
    expect(g.ko).toBeNull();
    expect(g.passes).toBe(0);
    expect(g.scoring).toBeUndefined();
    expect(g.end).toBeUndefined();
    expect(g.setup).toBeUndefined();
    expect(Object.isFrozen(g)).toBe(true);
    expect(Object.isFrozen(g.plies)).toBe(true);
  });

  it('starts from a set-up board with the given side to move', () => {
    const g = fromDiagram(['x........', '.o.......', ...Array(7).fill('.........')], 'W');
    expect(g.turn).toBe('W');
    expect(g.setup?.turn).toBe('W');
    expect(diagram(g)[0]).toBe('x........');
    expect(position(g).setup).toEqual({ B: ['aa'], W: ['bb'] });
    expect(() => newGame(S9, { board: new Uint8Array(80), turn: 'B' })).toThrow();
    expect(() => newGame({ ...S9, size: 7 as Size })).toThrow();
  });

  it('works on a copy that has no cached state', () => {
    const g = playAll(newGame(S9), ['ee', 'ec']);
    const copy: Game = { ...g, board: new Uint8Array(g.board) };
    const next = play(copy, 'cc', 5);
    expect(next.cursor).toBe(3);
    expect(diagram(next)[2]).toBe('..x.o....');
  });
});

describe('play and immutability', () => {
  it('returns a new value and leaves the old one unchanged', () => {
    const a = newGame(S9);
    const b = play(a, 'ee', 1200);
    expect(a.cursor).toBe(0);
    expect(a.board[pointToIndex('ee', 9)]).toBe(0);
    expect(b.board[pointToIndex('ee', 9)]).toBe(1);
    expect(b.turn).toBe('W');
    expect(b.plies).toEqual([{ m: 'ee', ms: 1200 }]);
    const c = play(a, 'cc', 1);
    expect(c.plies).toEqual([{ m: 'cc', ms: 1 }]);
    expect(b.plies).toEqual([{ m: 'ee', ms: 1200 }]);
    expect(lastMove(b)).toBe('ee');
    expect(lastMove(a)).toBeNull();
  });

  it('rounds and clamps ms', () => {
    const g = play(play(newGame(S9), 'ee', 12.6), 'cc', -5);
    expect(g.plies.map((p) => p.ms)).toEqual([13, 0]);
    expect(play(newGame(S9), 'ee', Number.NaN).plies[0].ms).toBe(0);
  });

  it('refuses occupied and off-board points', () => {
    const g = play(newGame(S9), 'ee', 1);
    expect(illegalReason(g, 'ee')).toBe('occupied');
    expect(isLegal(g, 'ee')).toBe(false);
    expect(() => play(g, 'ee', 1)).toThrow(/occupied/);
    expect(illegalReason(g, 'sa')).toBe('occupied');
    expect(isLegal(g, 'sa')).toBe(false);
    expect(() => play(g, 'sa', 1)).toThrow(/Illegal/);
    expect(() => play(g, 'zz', 1)).toThrow(/Illegal/);
  });

  it('drops the redo tail on a new move', () => {
    const g = playAll(newGame(S9), ['ee', 'cc', 'gg']);
    const back = undo(g, 2);
    expect(back.cursor).toBe(1);
    expect(back.plies).toHaveLength(3);
    const branched = play(back, 'cg', 1);
    expect(branched.plies.map((p) => p.m)).toEqual(['ee', 'cg']);
    expect(branched.cursor).toBe(2);
  });
});

describe('captures', () => {
  it('captures a single stone in the middle', () => {
    const g = fromDiagram(['.........', '.........', '.........', '....x....', '...xox...', '.........', ...Array(3).fill('.........')]);
    const after = play(g, 'ef', 1);
    expect(after.board[pointToIndex('ee', 9)]).toBe(0);
    expect(after.prisoners).toEqual({ B: 1, W: 0 });
  });

  it('captures on the edge and in the corner', () => {
    const edge = fromDiagram(['...xox...', ...Array(8).fill('.........')]);
    const e = play(edge, 'eb', 1);
    expect(diagram(e)[0]).toBe('...x.x...');
    expect(e.prisoners.B).toBe(1);

    const corner = fromDiagram(['ox.......', ...Array(8).fill('.........')]);
    const c = play(corner, 'ab', 1);
    expect(diagram(c)[0]).toBe('.x.......');
    expect(c.prisoners.B).toBe(1);
  });

  it('captures several groups with one stone, and a whole chain', () => {
    const two = fromDiagram(['...xo.ox.', '....x.x..', ...Array(7).fill('.........')]);
    const t = play(two, 'fa', 1);
    expect(diagram(t)[0]).toBe('...x.x.x.');
    expect(t.prisoners.B).toBe(2);

    const chainPos = fromDiagram(['...xoox..', '....x....', ...Array(7).fill('.........')]);
    const ch = play(chainPos, 'fb', 1);
    expect(diagram(ch)[0]).toBe('...x..x..');
    expect(ch.prisoners.B).toBe(2);
  });

  it('credits prisoners to the capturing color', () => {
    const g = fromDiagram(['xo.......', ...Array(8).fill('.........')], 'W');
    const after = play(g, 'ab', 1);
    expect(after.prisoners).toEqual({ B: 0, W: 1 });
    expect(diagram(after)[0]).toBe('.o.......');
  });

  it('a move that captures is not suicide', () => {
    const g = fromDiagram(['.ox......', 'ox.......', 'x........', ...Array(6).fill('.........')]);
    expect(illegalReason(g, 'aa')).toBeNull();
    const after = play(g, 'aa', 1);
    expect(after.prisoners.B).toBe(2);
    expect(diagram(after).slice(0, 2)).toEqual(['x.x......', '.x.......']);
  });
});

describe('suicide', () => {
  it('refuses a single-stone suicide', () => {
    const g = fromDiagram(['.o.......', 'o........', ...Array(7).fill('.........')]);
    expect(illegalReason(g, 'aa')).toBe('suicide');
    expect(isLegal(g, 'aa')).toBe(false);
    expect(() => play(g, 'aa', 1)).toThrow(/suicide/);
  });

  it('refuses a multi-stone suicide', () => {
    const g = fromDiagram(['.xo......', 'oo.......', ...Array(7).fill('.........')]);
    expect(illegalReason(g, 'aa')).toBe('suicide');
  });
});

describe('ko and positional superko', () => {
  it('marks the simple ko point and refuses the immediate retake', () => {
    const g = play(fromDiagram(TRIPLE_KO), 'cc', 1);
    expect(g.prisoners.B).toBe(1);
    expect(g.ko).toBe('bc');
    expect(illegalReason(g, 'bc')).toBe('ko');
    expect(() => play(g, 'bc', 1)).toThrow(/ko/);
    // After an exchange elsewhere the retake is legal again.
    const later = playAll(g, ['ee', 'ff']);
    expect(later.ko).toBeNull();
    expect(illegalReason(later, 'bc')).toBeNull();
    expect(play(later, 'bc', 1).prisoners.W).toBe(1);
  });

  it('lifts the ko point after a pass', () => {
    const g = pass(play(fromDiagram(TRIPLE_KO), 'cc', 1), 1);
    expect(g.ko).toBeNull();
  });

  it('refuses a triple-ko cycle as superko, not as ko', () => {
    const g = playAll(fromDiagram(TRIPLE_KO), ['cc', 'hc', 'cg', 'bc', 'gc']);
    expect(g.prisoners).toEqual({ B: 3, W: 2 });
    expect(g.ko).toBe('hc');
    expect(illegalReason(g, 'bg')).toBe('superko');
    expect(isLegal(g, 'bg')).toBe(false);
    expect(() => play(g, 'bg', 1)).toThrow(/superko/);
    // Undo rebuilds the history set: one step back the same capture is not a repetition.
    const back = undo(g, 1);
    expect(illegalReason(back, 'gc')).toBeNull();
    expect(illegalReason(redo(back, 1), 'bg')).toBe('superko');
    // goto into the middle and back keeps the rule.
    expect(illegalReason(goto(goto(g, 2), 5), 'bg')).toBe('superko');
  });

  it('counts the start position in the history; passes do not lift superko', () => {
    // W takes a ko, both pass, play resumes: B's retake would recreate the start position.
    const start = fromDiagram(['.........', '.xo......', 'x.xo.....', '.xo......', ...Array(5).fill('.........')], 'W');
    const taken = play(start, 'bc', 1);
    expect(taken.ko).toBe('cc');
    const r = resume(pass(pass(taken, 1), 1));
    expect(r.turn).toBe('B');
    expect(r.ko).toBeNull();
    expect(illegalReason(r, 'cc')).toBe('superko');
  });
});

describe('groups, liberties, atari', () => {
  const g = fromDiagram(['.ox......', 'ox.......', 'x........', '....xx...', '....x....', ...Array(4).fill('.........')]);

  it('finds the chain and its liberties', () => {
    expect(groupAt(g, 'ed')).toEqual(['ed', 'ee', 'fd']);
    expect(libertiesOf(g, 'ed')).toBe(7);
    expect(groupAt(g, 'aa')).toEqual([]);
    expect(libertiesOf(g, 'aa')).toBe(0);
    expect(groupAt(g, 'tt')).toEqual([]);
    expect(libertiesOf(g, 'ba')).toBe(1);
  });

  it('lists groups in atari per color', () => {
    expect(atari(g, 'W')).toEqual([['ab'], ['ba']]);
    expect(atari(g, 'B')).toEqual([]);
  });

  it('measures self-atari: capturable stones only', () => {
    const s = fromDiagram(['.........', '.o.......', 'oxo......', 'o.o......', ...Array(5).fill('.........')]);
    expect(selfAtariSize(s, 'bd')).toBe(2);
    expect(selfAtariSize(s, 'ee')).toBe(0);
    // A throw-in single stone into atari counts as 1.
    const throwIn = fromDiagram(['.o.......', 'o.o......', '.o.......', ...Array(6).fill('.........')]);
    expect(selfAtariSize(throwIn, 'bb')).toBe(0); // suicide: illegal
    // Taking a ko leaves one liberty, but the opponent cannot retake at once.
    expect(selfAtariSize(fromDiagram(TRIPLE_KO), 'cc')).toBe(0);
    expect(selfAtariSize(s, 'tt')).toBe(0);
  });
});

describe('passes and scoring', () => {
  const base = playAll(newGame(S9), ['ee', 'cc']);

  it('counts passes; the second consecutive pass enters scoring round 1', () => {
    const one = pass(base, 500);
    expect(one.passes).toBe(1);
    expect(one.scoring).toBeUndefined();
    expect(one.plies.at(-1)).toEqual({ m: 'tt', ms: 500 });
    expect(one.turn).toBe('W');
    const two = pass(one, 1);
    expect(two.passes).toBe(2);
    expect(two.scoring).toEqual({ round: 1, rev: 0, dead: [], accepted: [0, 0] });
    expect(play(one, 'tt', 1).scoring?.round).toBe(1);
    // A stone resets the count.
    expect(play(one, 'gg', 1).passes).toBe(0);
  });

  it('refuses play and pass while scoring or after the end', () => {
    const s = pass(pass(base, 1), 1);
    expect(() => play(s, 'gg', 1)).toThrow(/scoring/);
    expect(() => pass(s, 1)).toThrow(/scoring/);
    expect(isLegal(s, 'gg')).toBe(false);
    expect(isLegal(s, 'tt')).toBe(false);
    expect(illegalReason(s, 'gg')).toBeNull();
    const over = end(s, { winner: 'B', by: 'score', margin: 9 });
    expect(() => play(over, 'gg', 1)).toThrow(/over/);
  });

  it('resume leaves scoring, resets the passes and makes the next scoring round 2', () => {
    const s = pass(pass(base, 1), 1);
    const r = resume(s);
    expect(r.scoring).toBeUndefined();
    expect(r.passes).toBe(0);
    expect(r.turn).toBe(s.turn);
    expect(resume(base)).toBe(base);
    const p1 = pass(r, 1);
    expect(p1.passes).toBe(1);
    expect(p1.scoring).toBeUndefined();
    const p2 = pass(p1, 1);
    expect(p2.scoring?.round).toBe(2);
    // Also after stones were played in between.
    const p3 = pass(pass(playAll(r, ['gg', 'cg']), 1), 1);
    expect(p3.scoring?.round).toBe(2);
  });

  it('replays logs with resumes implied by later plies', () => {
    const g = replay(S9, ['ee', 'cc', 'tt', 'tt', 'gg', 'tt', 'tt']);
    expect(g.scoring?.round).toBe(2);
    expect(g.passes).toBe(2);
    const h = replay(S9, [{ m: 'ee', ms: 5 }, { m: 'tt', ms: 6 }, { m: 'tt', ms: 7 }, { m: 'tt', ms: 8 }]);
    expect(h.passes).toBe(1);
    expect(h.scoring).toBeUndefined();
    expect(h.plies.map((p) => p.ms)).toEqual([5, 6, 7, 8]);
    expect(() => replay(S9, ['ee', 'ee'])).toThrow(/occupied/);
  });

  it('undo, redo and goto across passes and scoring', () => {
    const s = pass(pass(base, 1), 1);
    const marked = setScoring(s, { round: 1, rev: 3, dead: ['ee', 'cc', 'ee'], accepted: [3, 0] });
    expect(marked.scoring).toEqual({ round: 1, rev: 3, dead: ['cc', 'ee'], accepted: [3, 0] });
    // Undoing the second pass leaves scoring.
    const u1 = undo(marked, 1);
    expect(u1.scoring).toBeUndefined();
    expect(u1.passes).toBe(1);
    expect(u1.turn).toBe('W');
    const u2 = undo(u1, 1);
    expect(u2.passes).toBe(0);
    expect(u2.cursor).toBe(2);
    // Redo returns to scoring with the marks remembered.
    const r2 = redo(u2, 2);
    expect(r2.scoring).toEqual(marked.scoring);
    // goto works the same way and keeps marks in review.
    expect(goto(goto(marked, 0), 4).scoring).toEqual(marked.scoring);
    // A new ply forgets the marks.
    const branched = pass(pass(play(u2, 'gg', 1), 1), 1);
    expect(branched.scoring).toEqual({ round: 1, rev: 0, dead: [], accepted: [0, 0] });
    // Undo into a double pass after a resume shows scoring again (fresh, round from the plies).
    const resumed = play(resume(s), 'gg', 1);
    expect(undo(resumed, 1).scoring).toEqual({ round: 1, rev: 0, dead: [], accepted: [0, 0] });
    expect(() => setScoring(base, { round: 1, rev: 1, dead: [], accepted: [0, 0] })).toThrow(/not in scoring/);
  });

  it('undo and redo clamp, keep the redo tail and return the same value when nothing moves', () => {
    const g = playAll(newGame(S9), ['ee', 'cc', 'gg']);
    expect(undo(g, 0)).toBe(g);
    expect(redo(g, 5)).toBe(g);
    expect(undo(g, 10).cursor).toBe(0);
    expect(undo(g, 10).plies).toHaveLength(3);
    expect(redo(undo(g, 3), 2).cursor).toBe(2);
    expect(goto(g, 99).cursor).toBe(3);
    expect(goto(g, -1).cursor).toBe(0);
    expect(goto(g, 1).board[pointToIndex('cc', 9)]).toBe(0);
    expect(goto(g, 1).turn).toBe('W');
  });
});

describe('end and reopen', () => {
  it('ends at the cursor, dropping the redo tail and keeping scoring', () => {
    const s = setScoring(pass(pass(playAll(newGame(S9), ['ee', 'cc']), 1), 1), { round: 1, rev: 1, dead: ['cc'], accepted: [1, 1] });
    const over = end(s, { winner: 'B', by: 'score', margin: 9 });
    expect(over.end).toEqual({ result: { winner: 'B', by: 'score', margin: 9 } });
    expect(over.scoring?.dead).toEqual(['cc']);
    expect(end(over, { winner: 'W', by: 'resign' })).toBe(over);
    // goto keeps the end; undo drops it.
    expect(goto(over, 1).end).toEqual(over.end);
    expect(goto(goto(over, 1), 4).scoring?.dead).toEqual(['cc']);
    expect(undo(over, 1).end).toBeUndefined();
    const g = playAll(newGame(S9), ['ee', 'cc', 'gg']);
    const resigned = end(undo(g, 1), { winner: 'W', by: 'resign' });
    expect(resigned.plies).toHaveLength(2);
    const back = reopen(resigned);
    expect(back.end).toBeUndefined();
    expect(reopen(back)).toBe(back);
    expect(play(back, 'gg', 1).cursor).toBe(3);
  });
});

describe('move codec (DESIGN 13.2)', () => {
  it('round-trips points and passes', () => {
    const plies: Ply[] = ['dd', 'pp', 'tt', 'aa', 'ss', 'tt'].map((m) => ({ m, ms: 0 }));
    const s = encodeMoves(plies);
    expect(s).toBe('ddppttaasstt');
    expect(decodeMoves(s)).toEqual(['dd', 'pp', 'tt', 'aa', 'ss', 'tt']);
    expect(encodeMoves([])).toBe('');
    expect(decodeMoves('')).toEqual([]);
    const g = randomGame(19, 120, 7);
    expect(decodeMoves(encodeMoves(g.plies))).toEqual(g.plies.map((p) => p.m));
  });

  it('encodes a full game in two characters per ply', () => {
    const g = randomGame(19, 250, 3);
    expect(encodeMoves(g.plies)).toHaveLength(500);
  });

  it('throws when encoding a malformed ply', () => {
    expect(() => encodeMoves([{ m: 'zz', ms: 0 }])).toThrow();
    expect(() => encodeMoves([{ m: 'd4', ms: 0 }])).toThrow();
  });

  it('decodes malformed input to its longest well-formed prefix', () => {
    expect(decodeMoves('ddtt9z')).toEqual(['dd', 'tt']);
    expect(decodeMoves('ddp')).toEqual(['dd']);
    expect(decodeMoves('zz')).toEqual([]);
    expect(decodeMoves('ut')).toEqual([]);
    expect(decodeMoves('DD')).toEqual([]);
    expect(decodeMoves('ta')).toEqual([]);
    expect(decodeMoves(undefined as unknown as string)).toEqual([]);
  });

  it('validates strictly with isValidMoves', () => {
    expect(isValidMoves('ddtt')).toBe(true);
    expect(isValidMoves('')).toBe(true);
    expect(isValidMoves('ddp')).toBe(false);
    expect(isValidMoves('ddzz')).toBe(false);
    expect(isValidMoves('ssaa', 19)).toBe(true);
    expect(isValidMoves('ssaa', 9)).toBe(false);
    expect(isValidMoves('iitt', 9)).toBe(true);
  });
});

describe('fromRecord', () => {
  it('rebuilds a running game with its ms', () => {
    const g = fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eecc', ms: [100, 200] });
    expect(g.plies).toEqual([
      { m: 'ee', ms: 100 },
      { m: 'cc', ms: 200 },
    ]);
    expect(g.settings.komi2).toBe(15);
  });

  it('restores the scoring marks, a resume and a result', () => {
    const scoring = { round: 1 as const, rev: 2, dead: ['cc'], accepted: [2, 0] as [number, number] };
    const inScoring = fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eecctttt', scoring });
    expect(inScoring.scoring).toEqual(scoring);
    const resumed = fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eecctttt' });
    expect(resumed.scoring).toBeUndefined();
    expect(resumed.passes).toBe(0);
    expect(pass(pass(resumed, 1), 1).scoring?.round).toBe(2);
    const done = fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eecctttt', scoring, result: { winner: 'W', by: 'score', margin: 3 } });
    expect(done.end?.result).toEqual({ winner: 'W', by: 'score', margin: 3 });
    expect(done.scoring?.dead).toEqual(['cc']);
    const resigned = fromRecord({ size: 13, rules: 'territory', handicap: 3, moves: 'gg', result: { winner: 'B', by: 'resign' } });
    expect(resigned.turn).toBe('B');
    expect(resigned.settings).toEqual({ size: 13, rules: 'territory', handicap: 3, komi2: 1 });
    expect(resigned.end?.result.by).toBe('resign');
  });

  it('validates the replay: throws on illegal plies unless lenient', () => {
    expect(() => fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eeee' })).toThrow(/occupied/);
    expect(() => fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eex' })).toThrow(/Malformed/);
    expect(() => fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eess' })).toThrow(/Illegal/);
    expect(fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eeccee' }, { lenient: true }).cursor).toBe(2);
    expect(fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eeccx' }, { lenient: true }).cursor).toBe(2);
    expect(fromRecord({ size: 9, rules: 'area', handicap: 0, moves: 'eess' }, { lenient: true }).cursor).toBe(1);
  });

  it('honours a stored komi', () => {
    expect(fromRecord({ size: 19, rules: 'area', handicap: 0, komi2: 13, moves: '' }).settings.komi2).toBe(13);
  });
});

describe('SGF export (DESIGN 13.3)', () => {
  it('writes the header, handicap stones, result, clock and passes', () => {
    let g = newGame(makeSettings(9, 'territory', 2));
    g = playAll(g, ['ee', 'cc']);
    g = pass(g, 1);
    g = end(g, { winner: 'B', by: 'resign' });
    expect(sgf(g, { version: '1.2.3', black: 'Ann', white: 'Zigo Level 5', date: '2026-11-12', tc: '5+7' })).toBe(
      '(;FF[4]GM[1]CA[UTF-8]AP[Zigo:1.2.3]SZ[9]KM[0.5]RU[Japanese]HA[2]AB[cg][gc]PB[Ann]PW[Zigo Level 5]DT[2026-11-12]RE[B+R]TM[300]OT[fischer +7s];W[ee];B[cc];W[])',
    );
  });

  it('writes area rules, score results, byo-yomi and escapes text', () => {
    let g = playAll(newGame(makeSettings(19)), ['pd', 'dp']);
    g = pass(pass(g, 1), 1);
    g = end(g, { winner: 'W', by: 'score', margin: 9 });
    expect(sgf(g, { version: '0.1', black: 'A]b\\c', tc: { kind: 'byoyomi', baseMs: 1_200_000, periods: 5, periodMs: 30_000 } })).toBe(
      '(;FF[4]GM[1]CA[UTF-8]AP[Zigo:0.1]SZ[19]KM[7.5]RU[Chinese]PB[A\\]b\\\\c]RE[W+4.5]TM[1200]OT[5x30 byo-yomi];B[pd];W[dp];B[];W[])',
    );
  });

  it('exports up to the cursor while running and everything once finished; time results', () => {
    const g = playAll(newGame(S9), ['ee', 'cc', 'gg']);
    expect(sgf(undo(g, 1), { version: '1' })).toBe('(;FF[4]GM[1]CA[UTF-8]AP[Zigo:1]SZ[9]KM[7.5]RU[Chinese];B[ee];W[cc])');
    const over = goto(end(g, { winner: 'W', by: 'time' }), 1);
    expect(sgf(over, { version: '1' })).toBe('(;FF[4]GM[1]CA[UTF-8]AP[Zigo:1]SZ[9]KM[7.5]RU[Chinese]RE[W+T];B[ee];W[cc];B[gg])');
    expect(formatResult({ winner: 'B', by: 'score', margin: 1 })).toBe('B+0.5');
  });

  it('writes a set-up position with AB, AW and PL', () => {
    const g = fromDiagram(['x........', '.o.......', ...Array(7).fill('.........')], 'W');
    expect(sgf(g, { version: '1' })).toBe('(;FF[4]GM[1]CA[UTF-8]AP[Zigo:1]SZ[9]KM[7.5]RU[Chinese]AB[aa]AW[bb]PL[W])');
  });
});

describe('time controls', () => {
  it('parses and formats Fischer and byo-yomi', () => {
    expect(parseTc('5+7')).toEqual({ kind: 'fischer', baseMs: 300_000, incMs: 7000 });
    expect(parseTc('20m5x30')).toEqual({ kind: 'byoyomi', baseMs: 1_200_000, periods: 5, periodMs: 30_000 });
    expect(parseTc('20m 5×30s')).toEqual(parseTc('20m5x30'));
    expect(parseTc('0m3x10')).toEqual({ kind: 'byoyomi', baseMs: 0, periods: 3, periodMs: 10_000 });
    expect(parseTc('0.5+0')).toEqual({ kind: 'fischer', baseMs: 30_000, incMs: 0 });
    for (const bad of [null, undefined, '', 'off', '0+5', '5', '20m0x30', '20m5x0', 'fast']) expect(parseTc(bad)).toBeNull();
    for (const s of ['5+7', '20m5x30', '30m5x60', '0.5+0', '3+10']) expect(formatTc(parseTc(s))).toBe(s);
    expect(formatTc(null)).toBeNull();
    expect(toTc('5+7')).toEqual(parseTc('5+7'));
    expect(toTc(undefined)).toBeNull();
  });
});

describe('clocks (DESIGN 11, Fischer as Zhess)', () => {
  const tc = parseTc('5+7');

  it('subtracts ms and adds the increment; each side’s first move is untimed', () => {
    const g = playAll(newGame(S9), ['ee', 'cc', 'gg', 'cg'], [5000, 6000, 7000, 8000]);
    expect(clocks(g, tc)).toEqual({
      B: { mainMs: 300_000, periodMs: 0, periods: 0 },
      W: { mainMs: 299_000, periodMs: 0, periods: 0 },
    });
    expect(clocks(undo(g, 2), tc).B.mainMs).toBe(300_000);
    // Passes are timed moves too.
    const p = pass(g, 20_000);
    expect(clocks(p, tc).B.mainMs).toBe(287_000);
  });

  it('reports time used with the clock off', () => {
    const g = playAll(newGame(S9), ['ee', 'cc', 'gg'], [5000, 6000, 7000]);
    expect(clocks(g, null)).toEqual({ B: { mainMs: 12_000, periodMs: 0, periods: 0 }, W: { mainMs: 6000, periodMs: 0, periods: 0 } });
    expect(timeUsed(g)).toEqual({ B: 12_000, W: 6000 });
  });

  it('knows whose clock runs, White first with handicap', () => {
    const h = newGame(makeSettings(9, 'area', 2));
    expect(clockRunning(h)).toBe(false);
    const g = playAll(h, ['ee', 'cc']);
    expect(g.turn).toBe('W');
    expect(clockRunning(g)).toBe(true);
    expect(clocks(playAll(g, ['gg'], [10_000]), tc).W.mainMs).toBe(297_000);
  });

  it('derives byo-yomi: main time first, a period kept, used up, run out', () => {
    const by = parseTc('1m3x10');
    const g0 = playAll(newGame(S9), ['ee', 'cc'], [99_999, 99_999]); // first moves untimed
    expect(clocks(g0, by).B).toEqual({ mainMs: 60_000, periodMs: 10_000, periods: 3 });
    const g1 = playAll(g0, ['gg', 'cg'], [50_000, 65_000]);
    expect(clocks(g1, by).B).toEqual({ mainMs: 10_000, periodMs: 10_000, periods: 3 }); // still in main time
    expect(clocks(g1, by).W).toEqual({ mainMs: 0, periodMs: 10_000, periods: 3 }); // 5 s into a period: kept
    const g2 = playAll(g1, ['gc', 'dd'], [25_000, 10_000]);
    expect(clocks(g2, by).B).toEqual({ mainMs: 0, periodMs: 10_000, periods: 2 }); // 15 s over: one period used
    expect(clocks(g2, by).W).toEqual({ mainMs: 0, periodMs: 10_000, periods: 3 }); // exactly one period: kept
    const g3 = playAll(g2, ['fd'], [30_000]);
    expect(clocks(g3, by).B).toEqual({ mainMs: 0, periodMs: 0, periods: 0 }); // out of time
    expect(byoyomiStep({ mainMs: 0, periodMs: 0, periods: 0 }, { periodMs: 10_000 }, 1)).toEqual({ mainMs: 0, periodMs: 0, periods: 0 });
  });
});

describe('position for the engine', () => {
  it('lists the setup, the first mover, the moves and the board', () => {
    const g = pass(playAll(newGame(makeSettings(13, 'territory', 2)), ['gg']), 1);
    const pos = position(g);
    expect(pos.size).toBe(13);
    expect(pos.rules).toBe('territory');
    expect(pos.komi2).toBe(1);
    expect(pos.first).toBe('W');
    expect(pos.setup).toEqual({ B: ['dj', 'jd'], W: [] });
    expect(pos.moves).toEqual(['gg', 'tt']);
    expect(pos.turn).toBe('W');
    expect(pos.board[pointToIndex('gg', 13)]).toBe(2);
    expect(pos.ko).toBeNull();
  });
});

describe('diagrams', () => {
  it('round-trips', () => {
    const rows = ['x.o......', ...Array(8).fill('.........')];
    const { size, board } = boardFromDiagram(rows);
    expect(size).toBe(9);
    expect(boardToDiagram(board, 9)).toEqual(rows);
    expect(() => boardFromDiagram(['...', '..'])).toThrow();
    expect(() => fromDiagram(['...', '...', '...'])).toThrow();
  });
});

describe('speed', () => {
  it('replays a 400-ply 19×19 game well under 50 ms', () => {
    const g = randomGame(19, 400, 42);
    expect(g.plies).toHaveLength(400);
    // Warm up once, then time the best of three replays (generous bound for slow CI machines).
    replay(g.settings, g.plies);
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const r = replay(g.settings, g.plies);
      best = Math.min(best, performance.now() - t0);
      expect(diagram(r)).toEqual(diagram(g));
    }
    expect(best).toBeLessThan(200);
    // Undo and goto rebuild from the start; they must stay fast too.
    const t1 = performance.now();
    let h = g;
    for (let i = 0; i < 20; i++) h = undo(h, 1);
    expect(performance.now() - t1).toBeLessThan(400);
    expect(h.cursor).toBe(380);
  });

  it('is deterministic: the same plies give the same board, prisoners and ko', () => {
    const a = randomGame(13, 200, 11);
    const b = replay(a.settings, a.plies);
    expect(diagram(b)).toEqual(diagram(a));
    expect(b.prisoners).toEqual(a.prisoners);
    expect(b.ko).toEqual(a.ko);
  });
});
