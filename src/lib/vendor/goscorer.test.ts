/**
 * Smoke test of the vendored goscorer (./goscorer.js): it imports with its types and counts a
 * trivial 5×5 position under both rule sets. The real fixtures live with src/lib/scoring.ts.
 */
import { BLACK, EMPTY, WHITE, finalAreaScore, finalTerritoryScore, territoryScoring, type GoscorerColor } from './goscorer';

/** `x` black, `o` white, `.` empty; rows from the top. */
function board(rows: string[]): GoscorerColor[][] {
  return rows.map((r) => [...r].map((c) => (c === 'x' ? BLACK : c === 'o' ? WHITE : EMPTY)));
}

// Black owns the two left columns (10 points: 5 stones + 5 empty), white the two right ones.
const STONES = board(['.x.o.', '.x.o.', '.x.o.', '.x.o.', '.x.o.']);
const NONE_DEAD = STONES.map((r) => r.map(() => false));

describe('vendored goscorer', () => {
  it('counts area: stones plus surrounded points, komi to white', () => {
    expect(finalAreaScore(STONES, NONE_DEAD, 0.5)).toEqual({ black: 10, white: 10.5 });
  });

  it('counts territory: surrounded points plus captures, komi to white', () => {
    expect(finalTerritoryScore(STONES, NONE_DEAD, 2, 1, 6.5)).toEqual({ black: 7, white: 12.5 });
  });

  it('marks the middle column as dame and the edges as territory', () => {
    const s = territoryScoring(STONES, NONE_DEAD);
    expect(s[2][0].isTerritoryFor).toBe(BLACK);
    expect(s[2][4].isTerritoryFor).toBe(WHITE);
    expect(s[2][2].isTerritoryFor).toBe(EMPTY);
    expect(s[2][2].isDame).toBe(true);
  });

  it('scores a stone marked dead for the opponent', () => {
    const stones = board(['.x.o.', '.x.o.', '.xxo.', '.x.o.', '.x.o.']);
    const dead = stones.map((r, y) => r.map((_, x) => y === 2 && x === 2));
    // The dead black stone is removed; the middle column is still between both walls.
    expect(finalAreaScore(stones, dead, 0)).toEqual({ black: 10, white: 10 });
  });
});
