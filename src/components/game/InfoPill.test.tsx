import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InfoPill, type InfoPillProps } from './InfoPill';
import { MoveList } from './MoveList';
import { renderWithI18n } from './testUtils';

vi.mock('@/components/board', () => import('./stoneStub'));

/** 9×9: E5, C7, G3, pass. */
const MOVES = ['ee', 'cc', 'gg', 'tt'];

function props(over: Partial<InfoPillProps> = {}): InfoPillProps {
  return { code: 'K7QW2M', opponent: { kind: 'computer', level: 5 }, moves: MOVES, size: 9, cursor: 3, ...over };
}

const cell = (name: string) => document.querySelector(`[data-cell="${name}"]`) as HTMLElement;

describe('InfoPill', () => {
  it('shows code, level and the last move in GTP (eyebrow over value)', () => {
    renderWithI18n(<InfoPill {...props()} />);
    expect(screen.getByRole('group', { name: 'Game info' })).toBeInTheDocument();
    expect(cell('code')).toHaveTextContent('Game');
    expect(cell('code')).toHaveTextContent('K7QW2M');
    expect(cell('opponent')).toHaveTextContent('Level');
    expect(cell('opponent')).toHaveTextContent('5');
    expect(screen.getByRole('button', { name: 'Show all moves' })).toHaveAccessibleDescription('3. G3');
  });

  it('a pass reads `4. Pass`', () => {
    renderWithI18n(<InfoPill {...props({ cursor: 4 })} />);
    expect(screen.getByRole('button', { name: 'Show all moves' })).toHaveAccessibleDescription('4. Pass');
  });

  it('numbers from the first move and follows the cursor', () => {
    renderWithI18n(<InfoPill {...props({ cursor: 1 })} />);
    expect(cell('moves')).toHaveTextContent('1.');
    expect(cell('moves')).toHaveTextContent('E5');
    expect(cell('moves')).not.toHaveTextContent('C7');
  });

  it('previews the ghost stone’s coordinate as the next move (`D4?`)', () => {
    renderWithI18n(<InfoPill {...props({ moves: ['ee'], cursor: 1, ghost: 'dd' })} />);
    const strip = cell('moves');
    expect(strip.querySelector('[data-ghost="true"]')).not.toBeNull();
    expect(strip).toHaveTextContent('2.');
    expect(strip).toHaveTextContent('D6?');
    expect(screen.getByRole('button', { name: 'Show all moves' })).toHaveAccessibleDescription('Placing D6');
  });

  it('shows the ghost on an empty board too, in GTP of the board size', () => {
    renderWithI18n(<InfoPill {...props({ moves: [], cursor: 0, size: 19, ghost: 'dp' })} />);
    expect(cell('moves')).toHaveTextContent('1.');
    expect(cell('moves')).toHaveTextContent('D4?');
  });

  it('keeps all three cells at every width; below 360 px they fold into two rows (DESIGN 4.2)', () => {
    renderWithI18n(<InfoPill {...props({ opponent: { kind: 'room', score: [1, 0] } })} />);
    const pill = screen.getByRole('group', { name: 'Game info' });
    for (const name of ['code', 'opponent', 'moves']) {
      expect(cell(name).className).not.toMatch(/hidden/);
      expect(cell(name).parentElement!.className).not.toMatch(/hidden/);
    }
    expect(cell('opponent')).toHaveTextContent('1 – 0');
    expect(pill.className).toContain('max-[359px]:inline-grid');
    expect(cell('moves').className).toContain('max-[359px]:col-span-3');
  });

  it('gives every cell the same eyebrow-over-value structure, so the rows line up', () => {
    renderWithI18n(<InfoPill {...props({ presence: <span data-testid="dot" /> })} />);
    const eyebrows = new Set<string>();
    for (const name of ['code', 'opponent', 'moves']) {
      const el = cell(name);
      expect(el.className).toContain('flex-col');
      const [eyebrow, value] = Array.from(el.children) as HTMLElement[];
      eyebrows.add(eyebrow.className);
      expect(value.className).toContain('h-5');
      expect(value.className).toContain('items-center');
    }
    expect(eyebrows.size).toBe(1);
  });

  it('the move strip button scales when pressed (Ztyle 08)', () => {
    renderWithI18n(<InfoPill {...props()} />);
    expect(cell('moves').className).toContain('active:scale-95');
  });

  it('shows a dash and cannot open the list before the first move', () => {
    renderWithI18n(<InfoPill {...props({ moves: [], cursor: 0 })} />);
    expect(cell('moves')).toHaveTextContent('–');
    expect(screen.getByRole('button', { name: 'Show all moves' })).toBeDisabled();
  });

  it('opponent cell: two players and the room score', () => {
    const { rerender } = renderWithI18n(<InfoPill {...props({ opponent: { kind: 'local' } })} />);
    expect(cell('opponent')).toHaveTextContent('Players');
    expect(cell('opponent')).toHaveTextContent('2');
    rerender(<InfoPill {...props({ opponent: { kind: 'room', score: [2, 1.5] } })} />);
    expect(cell('opponent')).toHaveTextContent('Score');
    expect(cell('opponent')).toHaveTextContent('2 – 1½');
  });

  it('renders the presence slot next to the code', () => {
    renderWithI18n(<InfoPill {...props({ presence: <span data-testid="dot" /> })} />);
    expect(within(cell('code')).getByTestId('dot')).toBeInTheDocument();
  });

  it('shows a faint note line under the pill (territory preview `B+3.5`)', () => {
    const { rerender, container } = renderWithI18n(<InfoPill {...props({ note: 'B+3.5' })} />);
    expect(container.querySelector('[data-part="note"]')).toHaveTextContent('B+3.5');
    rerender(<InfoPill {...props()} />);
    expect(container.querySelector('[data-part="note"]')).toBeNull();
  });

  it('tapping the strip opens the move list; a move jumps and closes it', async () => {
    const onJump = vi.fn();
    renderWithI18n(<InfoPill {...props({ onJump })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all moves' }));
    const list = await screen.findByRole('list', { name: 'Moves' });
    fireEvent.click(within(list).getByRole('button', { name: 'Go to move 2: White C7' }));
    expect(onJump).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('list', { name: 'Moves' })).toBeNull();
  });

  it('positions itself as a top pill or a left rail, or not at all inline', () => {
    const { rerender, container } = renderWithI18n(<InfoPill {...props()} />);
    expect((container.firstChild as HTMLElement).className).toContain('top-[max(1rem');
    rerender(<InfoPill {...props()} landscape />);
    expect((container.firstChild as HTMLElement).className).toContain('left-[max(1rem');
    expect(screen.getByRole('group').className).toContain('flex-col');
    rerender(<InfoPill {...props()} placement="inline" className="extra" />);
    expect(container.firstChild).toBe(screen.getByRole('group'));
    expect(screen.getByRole('group').className).toContain('extra');
  });

  it('hides toward the top and becomes inert', () => {
    const { container } = renderWithI18n(<InfoPill {...props()} visible={false} />);
    const wrap = container.firstChild as HTMLElement & { inert?: boolean };
    expect(wrap).toHaveAttribute('aria-hidden', 'true');
    expect(wrap.className).toContain('-translate-y-8');
    expect(wrap.inert).toBe(true);
  });

  it('is translated: a pass reads `Passen` in German', () => {
    renderWithI18n(<InfoPill {...props({ cursor: 4 })} />, 'de');
    expect(screen.getByRole('button', { name: 'Alle Züge anzeigen' })).toHaveAccessibleDescription('4. Passen');
  });
});

describe('MoveList', () => {
  it('numbers every ply, draws the mover’s stone and marks the current one', () => {
    renderWithI18n(<MoveList moves={MOVES} size={9} cursor={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('1E5');
    expect(items[3]).toHaveTextContent('4Pass');
    expect(document.querySelector('[data-ply="0"] [data-stone="B"]')).not.toBeNull();
    expect(document.querySelector('[data-ply="1"] [data-stone="W"]')).not.toBeNull();
    const current = document.querySelector('[aria-current="step"]')!;
    expect(current).toHaveAttribute('data-ply', '1');
    // plies after the cursor (review, redo tail) are dimmed
    expect(document.querySelector('[data-ply="2"]')!.className).toContain('text-foreground/50');
    expect(document.querySelector('[data-ply="1"]')!.className).not.toContain('text-foreground/50');
  });

  it('lays the moves out in two columns, so the colors line up', () => {
    renderWithI18n(<MoveList moves={MOVES} size={9} cursor={4} />);
    expect(screen.getByRole('list', { name: 'Moves' }).className).toContain('grid-cols-2');
  });

  it('is read-only without onJump', () => {
    renderWithI18n(<MoveList moves={MOVES} size={9} cursor={4} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('jumps to a move (cursor = ply + 1) or to the start position', () => {
    const onJump = vi.fn();
    renderWithI18n(<MoveList moves={MOVES} size={9} cursor={4} onJump={onJump} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to move 4: White Pass' }));
    expect(onJump).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByRole('button', { name: 'Go to move 1: Black E5' }));
    expect(onJump).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Start position' }));
    expect(onJump).toHaveBeenLastCalledWith(0);
  });

  it('starts with White in a handicap game', () => {
    renderWithI18n(<MoveList moves={['gc', 'cg']} size={9} cursor={2} firstColor="W" onJump={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Go to move 1: White G7' })).toHaveAttribute('data-color', 'W');
    expect(screen.getByRole('button', { name: 'Go to move 2: Black C3' })).toHaveAttribute('data-color', 'B');
  });
});
