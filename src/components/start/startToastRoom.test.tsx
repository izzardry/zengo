import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  START_TOAST_VAR,
  TOAST_BOTTOM_LANDSCAPE,
  TOAST_BOTTOM_PORTRAIT,
  toasterPlacement,
} from '@/components/ui/toasterPlacement';
import { StartFooter } from './StartFooter';
import { START_TOAST_GAP_PX, START_TOAST_ROW_PX, measureStartFooter, startToastBottomPx } from './startToastRoom';

/** The 390×844 start screen as Chromium lays it out: selector, pills, status line, chevron. */
const PHONE_WITH_CHEVRON = { viewportHeight: 844, footerTop: 605, contentBottom: 753, footerBottom: 32 };
const PILLS_BOTTOM_PHONE = 721;

describe('startToastBottomPx', () => {
  it('puts the toast in the chevron row at Ztyle\'s start-screen offset, clear of the pills and the status line (390×844)', () => {
    const bottom = startToastBottomPx(PHONE_WITH_CHEVRON);
    expect(bottom).toBe(24);
    // The toast that covered the pills in game placement (bottom 82, 46 px high) started at 716.
    const top = PHONE_WITH_CHEVRON.viewportHeight - bottom - START_TOAST_ROW_PX;
    expect(top).toBeGreaterThanOrEqual(PHONE_WITH_CHEVRON.contentBottom + START_TOAST_GAP_PX);
    expect(top).toBeGreaterThan(PILLS_BOTTOM_PHONE);
  });

  it('keeps the bottom safe area: Ztyle\'s inset + 0.5rem with a home indicator', () => {
    // max(2rem, 34 px + 1rem) = 50 px footer offset; everything moves up by 18 px.
    const box = { viewportHeight: 844, footerTop: 587, contentBottom: 735, footerBottom: 50 };
    expect(startToastBottomPx(box)).toBe(42);
    expect(844 - 42 - START_TOAST_ROW_PX).toBeGreaterThanOrEqual(box.contentBottom + START_TOAST_GAP_PX);
  });

  it('without the chevron row goes above the footer instead of over the pills (390×844, no history)', () => {
    const box = { viewportHeight: 844, footerTop: 664, contentBottom: 812, footerBottom: 32 };
    const bottom = startToastBottomPx(box);
    expect(bottom).toBe(844 - 664 + 8);
    // The toast's bottom edge is above the opponent selector.
    expect(844 - bottom).toBeLessThanOrEqual(box.footerTop - START_TOAST_GAP_PX);
  });

  it('in mobile landscape goes above the footer row (844×390)', () => {
    const box = { viewportHeight: 390, footerTop: 334, contentBottom: 374, footerBottom: 16 };
    expect(startToastBottomPx(box)).toBe(390 - 334 + 8);
  });

  it('a wrapped pill row on a 320×568 phone still leaves the chevron row to the toast', () => {
    const box = { viewportHeight: 568, footerTop: 285, contentBottom: 477, footerBottom: 32 };
    const bottom = startToastBottomPx(box);
    expect(bottom).toBe(24);
    expect(568 - bottom - START_TOAST_ROW_PX).toBeGreaterThanOrEqual(477 + START_TOAST_GAP_PX);
  });
});

describe('toaster placement on the start screen', () => {
  it('the portrait and landscape offsets give way to the start footer\'s variable', () => {
    expect(TOAST_BOTTOM_PORTRAIT.startsWith(`var(${START_TOAST_VAR}, `)).toBe(true);
    expect(TOAST_BOTTOM_LANDSCAPE.startsWith(`var(${START_TOAST_VAR}, `)).toBe(true);
    expect(TOAST_BOTTOM_LANDSCAPE).toContain('env(safe-area-inset-bottom)');
    expect(toasterPlacement(true).offset).toMatchObject({ bottom: TOAST_BOTTOM_LANDSCAPE });
    expect(toasterPlacement(false, { width: 390, height: 844 }).mobileOffset).toMatchObject({ bottom: TOAST_BOTTOM_PORTRAIT });
  });
});

/* ---------------------------------------------------------------------------------------------- */

/** jsdom has no layout: offsets come from `data-h` / `data-y` on each element. */
function stubLayout() {
  const proto = HTMLElement.prototype;
  const saved = {
    h: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'),
    y: Object.getOwnPropertyDescriptor(proto, 'offsetTop'),
  };
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.h ?? 0);
    },
  });
  Object.defineProperty(proto, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.dataset.y ?? 0);
    },
  });
  return () => {
    if (saved.h) Object.defineProperty(proto, 'offsetHeight', saved.h);
    if (saved.y) Object.defineProperty(proto, 'offsetTop', saved.y);
  };
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

const published = () => document.documentElement.style.getPropertyValue(START_TOAST_VAR);

describe('StartFooter publishes the start-screen toast offset', () => {
  let restore: () => void;
  const initial = { width: window.innerWidth, height: window.innerHeight };
  beforeEach(() => {
    restore = stubLayout();
    setViewport(390, 844);
  });
  afterEach(() => {
    restore();
    setViewport(initial.width, initial.height);
    document.documentElement.style.removeProperty(START_TOAST_VAR);
  });

  // The 390×844 footer: 207 px high, 32 px off the bottom; rows as Chromium lays them out.
  const rows = (chevron: boolean) => ({
    selector: <div data-h="68" data-y="0" />,
    pills: <div data-h="36" data-y="80" />,
    status: <div data-h="24" data-y="124" />,
    chevron: chevron ? <span /> : undefined,
  });

  function Footer({ visible, chevron = true, landscape = false }: { visible: boolean; chevron?: boolean; landscape?: boolean }) {
    const r = rows(chevron);
    return (
      <div>
        <StartFooter visible={visible} landscape={landscape} selector={r.selector} pills={r.pills} status={r.status} chevron={r.chevron} />
      </div>
    );
  }

  /** Gives the rendered footer and its wrappers the stubbed layout (the wrappers carry the rows). */
  function layOut(container: HTMLElement, chevron: boolean) {
    const footer = container.querySelector<HTMLElement>('[data-testid="start-footer"]')!;
    footer.style.bottom = '32px';
    footer.dataset.h = chevron ? '207' : '148';
    const kids = Array.from(footer.children) as HTMLElement[];
    const layout = [
      ['0', '68'],
      ['80', '36'],
      ['124', '24'],
      ['172', '35'],
    ];
    kids.forEach((k, i) => {
      k.dataset.y = layout[i][0];
      k.dataset.h = layout[i][1];
    });
    return footer;
  }

  it('measures the footer and leaves the chevron row out of its content', () => {
    const { container } = render(<Footer visible={false} />);
    const footer = layOut(container, true);
    expect(footer.querySelector('[data-start-toast-free]')).not.toBeNull();
    expect(measureStartFooter(footer, 844)).toEqual(PHONE_WITH_CHEVRON);
  });

  it('sets the variable while the footer shows, and removes it when it hides or goes away', () => {
    const { container, rerender, unmount } = render(<Footer visible={false} />);
    layOut(container, true);
    expect(published()).toBe('');
    rerender(<Footer visible />);
    expect(published()).toBe('24px');
    rerender(<Footer visible={false} />);
    expect(published()).toBe('');
    rerender(<Footer visible />);
    expect(published()).toBe('24px');
    unmount();
    expect(published()).toBe('');
  });

  it('without the chevron sends the toast above the footer', () => {
    const { container, rerender } = render(<Footer visible={false} chevron={false} />);
    layOut(container, false);
    rerender(<Footer visible chevron={false} />);
    // Footer top 844 − 32 − 148 = 664; the toast's bottom 8 px above it.
    expect(published()).toBe(`${844 - 664 + 8}px`);
  });

  it('follows a resize, and leaves wide portrait screens (toast beside the board) to the game offset', () => {
    const { container, rerender } = render(<Footer visible={false} />);
    layOut(container, true);
    rerender(<Footer visible />);
    expect(published()).toBe('24px');
    setViewport(1280, 800);
    window.dispatchEvent(new Event('resize'));
    expect(published()).toBe('');
    setViewport(390, 844);
    window.dispatchEvent(new Event('resize'));
    expect(published()).toBe('24px');
  });
});
