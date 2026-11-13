import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Score } from '@/lib/types';
import { PlayerStrip, type PlayerStripProps } from './PlayerStrip';
import { ScoringAccept } from './ScoringBar';
import { renderWithI18n } from './testUtils';

vi.mock('@/components/board', () => import('./stoneStub'));

function props(over: Partial<PlayerStripProps> = {}): PlayerStripProps {
  return { color: 'W', prisoners: 0, active: true, ...over };
}

const strip = () => document.querySelector('[data-color]') as HTMLElement;
const part = (name: string) => document.querySelector(`[data-part="${name}"]`) as HTMLElement | null;

const AREA: Score = {
  rules: 'area',
  B: { territory: 20, stones: 25, prisoners: 0 },
  W: { territory: 15, stones: 25, prisoners: 0 },
  komi2: 15,
  compensation2: 0,
  total2: { B: 90, W: 95 },
  margin2: -5,
};

const TERRITORY: Score = {
  rules: 'territory',
  B: { territory: 12, stones: 30, prisoners: 3 },
  W: { territory: 10, stones: 28, prisoners: 1 },
  komi2: 13,
  compensation2: 0,
  total2: { B: 30, W: 35 },
  margin2: -5,
};

describe('PlayerStrip', () => {
  it('shows prisoners as a stone of the captured color and a count (DESIGN 4.2)', () => {
    renderWithI18n(<PlayerStrip {...props({ prisoners: 3 })} />);
    const prisoners = screen.getByRole('img', { name: 'White has captured 3' });
    expect(prisoners).toHaveTextContent('3');
    // White's strip shows a black stone: White has captured black stones.
    expect(prisoners.querySelector('[data-stone="B"]')).not.toBeNull();
  });

  it('a Black strip shows white stones; no prisoners shows nothing', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ color: 'B', prisoners: 1 })} />);
    expect(part('prisoners')!.querySelector('[data-stone="W"]')).not.toBeNull();
    rerender(<PlayerStrip {...props({ color: 'B', prisoners: 0 })} />);
    expect(part('prisoners')).toBeNull();
  });

  it('shows komi faint on White’s strip only', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ komi2: 15 })} />);
    expect(part('komi')).toHaveTextContent('+7.5');
    expect(part('komi')).toHaveTextContent('Komi 7.5');
    expect(part('komi')!.className).toContain('text-muted-foreground');
    rerender(<PlayerStrip {...props({ komi2: 1 })} />);
    expect(part('komi')).toHaveTextContent('+0.5');
    rerender(<PlayerStrip {...props({ color: 'B', komi2: 15 })} />);
    expect(part('komi')).toBeNull();
  });

  it('shows the passed badge after a pass', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ passed: true })} />);
    expect(part('passed')).toHaveTextContent('passed');
    rerender(<PlayerStrip {...props({ passed: false })} />);
    expect(part('passed')).toBeNull();
  });

  it('active at full opacity, inactive at 50 %', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props()} />);
    expect(strip().className).toContain('opacity-100');
    rerender(<PlayerStrip {...props({ active: false })} />);
    expect(strip().className).toContain('opacity-50');
  });

  it('the clock is a timer with states: running, low, flagged, untimed', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ color: 'B', clock: { text: '4:31', running: true } })} />);
    const timer = screen.getByRole('timer', { name: 'Black clock' });
    expect(timer).toHaveTextContent('4:31');
    expect(timer).toHaveAttribute('data-running', 'true');
    expect(timer.className).toContain('bg-foreground/10');

    rerender(<PlayerStrip {...props({ color: 'B', clock: { text: '9.7', running: true, low: true } })} />);
    expect(screen.getByRole('timer').className).toContain('font-bold');

    rerender(<PlayerStrip {...props({ color: 'B', clock: { text: '0.0', flagged: true } })} />);
    expect(screen.getByRole('timer').className).toContain('text-destructive');
    expect(screen.getByRole('timer').className).toContain('font-bold');

    rerender(<PlayerStrip {...props({ color: 'B', clock: { text: '12:08', untimed: true, running: true } })} />);
    const used = screen.getByRole('timer', { name: 'Black time used' });
    expect(used.className).toContain('text-muted-foreground');
    expect(used.className).not.toContain('bg-foreground/10');
  });

  it('accepts a preformatted clock element with a spoken reading (byo-yomi in M2)', () => {
    renderWithI18n(
      <PlayerStrip
        {...props({ clock: { text: <span data-testid="byo">0:24 ·3</span>, label: '24 seconds, 3 periods', running: true } })}
      />,
    );
    const timer = screen.getByRole('timer', { name: 'White clock' });
    expect(screen.getByTestId('byo')).toHaveTextContent('0:24 ·3');
    expect(timer).toHaveTextContent('24 seconds, 3 periods');
  });

  it('has no clock slot without a clock', () => {
    renderWithI18n(<PlayerStrip {...props()} />);
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('is drawn upside down when rotated (face to face)', () => {
    const { rerender } = renderWithI18n(<PlayerStrip {...props({ rotated: true })} />);
    expect(strip().className).toContain('rotate-180');
    rerender(<PlayerStrip {...props()} />);
    expect(strip().className).not.toContain('rotate-180');
  });

  it('hides details but keeps the clock while the UI is hidden', () => {
    renderWithI18n(<PlayerStrip {...props({ prisoners: 2, komi2: 15, details: false, clock: { text: '1:00' } })} />);
    const details = part('details')!;
    expect(details.className).toContain('opacity-0');
    expect(details).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('timer')).toBeVisible();
  });

  it('rail layout stacks the clock over the details', () => {
    renderWithI18n(<PlayerStrip {...props({ layout: 'rail', prisoners: 1, clock: { text: '1:00' } })} />);
    expect(strip().className).toContain('flex-col');
    expect(strip().firstElementChild).toHaveAttribute('data-part', 'clock');
  });

  it('rail layout keeps prisoners and komi on one row, so the short landscape rail fits', () => {
    renderWithI18n(<PlayerStrip {...props({ color: 'W', layout: 'rail', prisoners: 1, komi2: 15, clock: { text: '1:00' } })} />);
    const details = part('details')!;
    expect(details.className).not.toContain('flex-col');
    expect(details.className).toContain('flex-wrap');
    expect(details).toContainElement(part('prisoners'));
    expect(details).toContainElement(part('komi'));
  });

  it('rail scoring: one line per side and no stopped clock (DESIGN 8.4)', () => {
    renderWithI18n(<PlayerStrip {...props({ layout: 'rail', score: TERRITORY, clock: { text: '1:00' } })} />);
    const sides = [...document.querySelectorAll('[data-part="score-side"]')].map((el) => el.textContent);
    expect(sides).toEqual(['B 12 + 3', 'W 10 + 1 + 6.5']);
    expect(part('score')).toHaveTextContent(/Count: Black/);
    expect(screen.queryByRole('timer')).toBeNull();
  });

  describe('scoring (DESIGN 8.4)', () => {
    it('area: the running score line replaces prisoners, komi and badge; both strips at full opacity', () => {
      renderWithI18n(<PlayerStrip {...props({ prisoners: 2, komi2: 15, passed: true, active: false, score: AREA })} />);
      expect(part('score')).toHaveTextContent('B 45 · W 40 + 7.5');
      expect(part('score')).toHaveTextContent('Count: Black 45, White 47.5');
      expect(part('prisoners')).toBeNull();
      expect(part('komi')).toBeNull();
      expect(part('passed')).toBeNull();
      expect(strip()).toHaveAttribute('data-scoring', 'true');
      expect(strip().className).toContain('opacity-100');
    });

    it('territory: territory + prisoners, and komi on White', () => {
      renderWithI18n(<PlayerStrip {...props({ score: TERRITORY })} />);
      expect(part('score')).toHaveTextContent('B 12 + 3 · W 10 + 1 + 6.5');
    });

    it('takes an action in place of the clock: the far player’s Accept, rotated with the strip', () => {
      const onAccept = vi.fn();
      renderWithI18n(
        <PlayerStrip
          {...props({ rotated: true, score: AREA, clock: { text: '1:00' }, action: <ScoringAccept onAccept={onAccept} side="W" variant="compact" /> })}
        />,
      );
      expect(screen.queryByRole('timer')).toBeNull();
      const accept = screen.getByRole('button', { name: 'Accept the count for White' });
      expect(accept.closest('.rotate-180')).not.toBeNull();
      accept.click();
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
  });

  it('is translated', () => {
    renderWithI18n(<PlayerStrip {...props({ prisoners: 2, clock: { text: '1:00' }, passed: true })} />, 'fr');
    expect(screen.getByRole('img', { name: 'Prisonniers de Blanc : 2' })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: 'Pendule de Blanc' })).toBeInTheDocument();
    expect(part('passed')).toHaveTextContent('passé');
  });
});
