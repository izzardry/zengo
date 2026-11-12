import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n';
import boardTable from '@/lib/i18n/board';
import { boardFromDiagram, fromGtp, starPoints } from '@/lib/zigo';
import type { Language, Size } from '@/lib/types';
import { BoardThumbnail } from './BoardThumbnail';
import { countCaptures, describeAtari, describeMove, describePoint, type Translate } from './describe';
import { goBoardGameProps } from './gameProps';
import { fromDiagram, play } from '@/lib/zigo';
import {
  BOARD_SIZE_LANDSCAPE,
  BOARD_SIZE_PORTRAIT,
  MARGIN,
  cellToPoint,
  centerPoint,
  columnLabel,
  extent,
  inGhostHitArea,
  pointAt,
  pointCenter,
  pointToCell,
  rowLabel,
  starSet,
  stepPoint,
  viewBox,
} from './geometry';
import { previewSquares, rowCodes, territorySquares } from './marks';
import { StoneGlyph } from './stones';

const tr = (lang: Language): Translate => (key, vars) => translate(lang, key, vars);
const t = tr('en');
const P = (s: string, size: Size = 19) => fromGtp(s, size) as string;

describe('geometry', () => {
  it('spans size + 0.6 pitches with the intersections from 0 to size - 1', () => {
    expect(extent(9)).toBeCloseTo(9.6);
    expect(MARGIN).toBeCloseTo(0.8);
    expect(viewBox(19)).toBe('-0.8 -0.8 19.6 19.6');
  });

  it('round-trips every point through its screen center for every size', () => {
    for (const size of [9, 13, 19] as const) {
      const box = { left: 7, top: 11, width: 30 * extent(size), height: 30 * extent(size) };
      for (let i = 0; i < size * size; i += 7) {
        const p = cellToPoint(i % size, Math.floor(i / size), size)!;
        const c = pointCenter(p, box, size);
        expect(pointAt(c.x, c.y, box, size)).toBe(p);
        // Anywhere inside the point's own cell still hits it.
        expect(pointAt(c.x + 14, c.y - 14, box, size)).toBe(p);
      }
    }
  });

  it('hit-tests strictly in the margin and clamps for drags', () => {
    const box = { left: 0, top: 0, width: 40 * extent(9), height: 40 * extent(9) };
    expect(pointAt(2, 2, box, 9)).toBeNull(); // outer margin
    expect(pointAt(-50, -50, box, 9)).toBeNull();
    expect(pointAt(2, 2, box, 9, true)).toBe('aa');
    expect(pointAt(9999, 9999, box, 9, true)).toBe('ii');
    expect(pointAt(10, 10, null, 9)).toBeNull();
  });

  it('gives the ghost a hit area of its cell plus half a pitch', () => {
    const box = { left: 0, top: 0, width: 40 * extent(13), height: 40 * extent(13) };
    const g = P('G7', 13);
    const c = pointCenter(g, box, 13);
    expect(inGhostHitArea(g, c.x, c.y, box, 13)).toBe(true);
    expect(inGhostHitArea(g, c.x + 39, c.y - 39, box, 13)).toBe(true);
    expect(inGhostHitArea(g, c.x + 41, c.y, box, 13)).toBe(false);
  });

  it('steps with arrow keys, clamped to the board', () => {
    expect(stepPoint('aa', -1, -1, 9)).toBe('aa');
    expect(stepPoint('aa', 1, 0, 9)).toBe('ba');
    expect(stepPoint('ii', 1, 1, 9)).toBe('ii');
    expect(centerPoint(19)).toBe('jj');
    expect(pointToCell('tt', 19)).toBeNull();
  });

  it('labels GTP columns without I and rows from the bottom', () => {
    expect(Array.from({ length: 19 }, (_, i) => columnLabel(i)).join('')).toBe('ABCDEFGHJKLMNOPQRST');
    expect(rowLabel(0, 19)).toBe('19');
    expect(rowLabel(18, 19)).toBe('1');
  });

  it('knows the star points of every size', () => {
    expect(starSet(9).size).toBe(5);
    expect(starSet(13).size).toBe(5);
    expect(starSet(19).size).toBe(9);
    for (const g of ['C3', 'C7', 'G3', 'G7', 'E5']) expect(starSet(9).has(P(g, 9))).toBe(true);
    for (const g of ['D4', 'D10', 'K10', 'Q16']) expect(starSet(19).has(P(g))).toBe(true);
    expect([...starSet(13)].sort()).toEqual([...starPoints(13)].sort());
  });

  it('sizes the board from one variable (DESIGN 5.1)', () => {
    expect(BOARD_SIZE_PORTRAIT).toBe('clamp(280px, min(94vw, 100dvh - 14rem), 768px)');
    expect(BOARD_SIZE_LANDSCAPE).toContain('100dvh');
  });
});

describe('describe', () => {
  it('labels cells as DESIGN 14.1 shows them', () => {
    expect(describePoint(P('D4'), 19, { stone: 1, star: true }, t)).toBe('black stone, D4');
    expect(describePoint(P('D4'), 19, { stone: 0, star: true }, t)).toBe('empty, D4, star point');
    expect(describePoint(P('D4', 9), 9, { stone: 0, ko: true }, t)).toBe('empty, D4, ko');
    expect(describePoint(P('C3'), 19, { stone: 2, lastMove: true, atari: true }, t)).toBe('white stone, C3, last move, atari');
    expect(describePoint(P('C3'), 19, { stone: 2, dead: true, territory: 'B' }, t)).toBe('white stone, C3, dead, Black territory');
    expect(describePoint(P('E5'), 19, { stone: 0, hint: -1 }, t)).toBe('empty, E5, hint');
    expect(describePoint(P('E5'), 19, { stone: 0, hint: 2 }, t)).toBe('empty, E5, hint 2');
  });

  it('describes moves, captures, passes and atari for the live region', () => {
    expect(describeMove('B', P('D4'), 0, 19, t)).toBe('Black: D4');
    expect(describeMove('W', P('Q16'), 2, 19, t)).toBe('White: Q16, captures 2');
    expect(describeMove('W', 'tt', 0, 19, t)).toBe('White passes');
    expect(describeAtari([P('C3'), P('C4')], 19, t)).toBe('Your group at C3 is in atari');
    expect(describeMove('B', P('D4'), 1, 19, tr('de'))).toBe('Schwarz: D4, fängt 1');
    expect(describeMove('W', 'tt', 0, 19, tr('fr'))).toBe('Blanc passe');
    expect(describeAtari([P('C3')], 19, tr('es'))).toBe('Tu grupo en C3 está en atari');
  });

  it('counts captured stones between two boards', () => {
    const before = boardFromDiagram(['.xo', 'xo.', '...']).board;
    const after = boardFromDiagram(['.x.', 'x.x', '...']).board;
    expect(countCaptures(before, after, 'W')).toBe(2);
    expect(countCaptures(before, after, 'B')).toBe(0);
    expect(countCaptures(before, new Uint8Array(4), 'W')).toBe(0);
  });
});

describe('string table', () => {
  it('keeps the Go terms of the glossary (DESIGN 14)', () => {
    for (const lang of ['en', 'de', 'fr', 'es'] as const) {
      expect(boardTable[lang]['board.state.ko'].toLowerCase()).toBe('ko');
      expect(boardTable[lang]['board.state.atari'].toLowerCase()).toBe('atari');
      expect(Object.keys(boardTable[lang]).sort()).toEqual(Object.keys(boardTable.en).sort());
    }
    expect(boardTable.de['board.state.territory.B']).toContain('Gebiet');
    expect(boardTable.fr['board.state.territory.B']).toContain('territoire');
    expect(boardTable.es['board.state.territory.B']).toContain('territorio');
    expect(boardTable.fr['board.label']).not.toMatch(/\bGo\b/); // "go" is lower case in French
  });
});

describe('layers', () => {
  it('encodes rows with dead and faded stones', () => {
    const { board } = boardFromDiagram(['x.o', '.x.', 'o..']);
    expect(rowCodes(board, 3, null, null)).toEqual(['B.W', '.B.', 'W..']);
    expect(rowCodes(board, 3, new Set([0]), new Set([4, 6]))).toEqual(['b.W', '.x.', 'y..']);
  });

  it('draws territory on empty points only and preview squares by strength', () => {
    const g = fromDiagram(['x........', ...Array(8).fill('.........')]);
    const sq = territorySquares({ aa: 'W', ba: 'B', ca: null }, g.board, 9);
    expect(sq).toEqual([{ col: 1, row: 0, owner: 'B', side: 0.3 }]);
    const own = new Float32Array(81);
    own[1] = -1;
    own[2] = 0.05;
    own[3] = 0.5;
    const pv = previewSquares(own, g.board, 9);
    expect(pv.map((s) => [s.col, s.owner, s.side])).toEqual([
      [1, 'W', 0.4],
      [3, 'B', 0.2],
    ]);
  });
});

describe('goBoardGameProps', () => {
  it('derives the position props from a game', () => {
    let g = fromDiagram(['.x.......', 'xo.......', '.x.......', ...Array(6).fill('.........')], 'W');
    g = play(g, 'ca', 0); // white plays next to its stone
    const props = goBoardGameProps(g);
    expect(props.size).toBe(9);
    expect(props.turn).toBe('B');
    expect(props.lastMove).toBe('ca');
    expect(props.board).toBe(g.board);
    expect(props.illegalReason('ba')).toBe('occupied');
    expect(props.illegalReason('ee')).toBeNull();
  });
});

describe('BoardThumbnail', () => {
  it('draws stones and star points, nothing else', () => {
    const { board } = boardFromDiagram(['x........', '.o.......', ...Array(7).fill('.........')]);
    const { container } = render(<BoardThumbnail size={9} board={board} />);
    const svg = container.querySelector('[data-testid="board-thumbnail"]')!;
    expect(svg.getAttribute('data-size')).toBe('9');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('use[data-stone="B"]').length).toBe(1);
    expect(svg.querySelectorAll('use[data-stone="W"]').length).toBe(1);
    expect(svg.querySelectorAll('circle[r]').length).toBeGreaterThanOrEqual(5);
    expect(svg.querySelectorAll('text').length).toBe(0);
    expect(svg.getAttribute('width')).toBe('64');
  });

  it('takes a label, a pixel size and a 19×19 board', () => {
    const board = new Uint8Array(361).fill(1);
    const { getByRole } = render(<BoardThumbnail size={19} board={board} px={48} label="Game K7QW2M" />);
    const img = getByRole('img', { name: 'Game K7QW2M' });
    expect(img.getAttribute('width')).toBe('48');
    expect(img.querySelectorAll('use').length).toBe(361);
  });
});

describe('StoneGlyph', () => {
  it('is decorative without a title and an image with one', () => {
    const { container, getByRole } = render(
      <>
        <StoneGlyph color="B" />
        <StoneGlyph color="W" title="White" className="h-3 w-3" />
      </>,
    );
    const [b, w] = container.querySelectorAll('svg');
    expect(b.getAttribute('aria-hidden')).toBe('true');
    expect(b.getAttribute('data-stone')).toBe('B');
    expect(getByRole('img', { name: 'White' })).toBe(w);
    expect(w.getAttribute('class')).toContain('h-3');
    // Theme-stable inks (Ztyle 03): Black is --ink-dark, White is --ink-light.
    expect((b.querySelector('circle') as SVGElement).style.fill).toContain('--ink-dark');
    expect((w.querySelector('circle') as SVGElement).style.fill).toContain('--ink-light');
  });

  it('gives each glyph its own gradient ids', () => {
    const { container } = render(
      <>
        <StoneGlyph color="B" />
        <StoneGlyph color="B" />
      </>,
    );
    const ids = [...container.querySelectorAll('radialGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
