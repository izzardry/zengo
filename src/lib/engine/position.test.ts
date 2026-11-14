import { describe, expect, it } from 'vitest';
import { makeSettings, newGame, pass, play, position, replay } from '../zengo';
import { engineKomi, gameFromPosition, handicapOf, isLegalInPosition, playableGame, pointOfIndex } from './position';

describe('engine positions', () => {
  it('adds one point per handicap stone to the komi under area rules only', () => {
    const area = position(newGame(makeSettings(19, 'area', 4)));
    expect(handicapOf(area)).toBe(4);
    expect(engineKomi(area)).toBe(0.5 + 4);
    const territory = position(newGame(makeSettings(19, 'territory', 4)));
    expect(engineKomi(territory)).toBe(0.5);
    const even = position(newGame(makeSettings(9)));
    expect(handicapOf(even)).toBe(0);
    expect(engineKomi(even)).toBe(7.5);
  });

  it('rebuilds the game and lets a third pass or a stone follow two passes', () => {
    let g = replay(makeSettings(9), ['ee', 'cc']);
    g = pass(pass(g, 0), 0);
    expect(g.scoring).toBeTruthy();
    const pos = position(g);
    expect(gameFromPosition(pos).scoring).toBeTruthy();
    expect(playableGame(pos).scoring).toBeFalsy();
    expect(isLegalInPosition(pos, 'gg')).toBe(true);
    expect(isLegalInPosition(pos, 'ee')).toBe(false);
    expect(isLegalInPosition(pos, 'tt')).toBe(true);
  });

  it('maps indices to points, size² to pass', () => {
    expect(pointOfIndex(0, 9)).toBe('aa');
    expect(pointOfIndex(80, 9)).toBe('ii');
    expect(pointOfIndex(81, 9)).toBe('tt');
    expect(play(newGame(makeSettings(9)), pointOfIndex(40, 9), 0).board[40]).toBe(1);
  });
});
