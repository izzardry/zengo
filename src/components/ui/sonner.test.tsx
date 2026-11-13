import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { Toaster, toast } from './sonner';
import {
  BOTTOM_CHROME_VAR,
  MIN_BESIDE_PX,
  TOAST_BOTTOM_CAP,
  TOAST_BOTTOM_PORTRAIT,
  TOAST_SIDE_PHONE,
  TOAST_WIDTH_BESIDE,
  TOAST_WIDTH_CENTERED,
  TOAST_WIDTH_LANDSCAPE,
  besideWidthPx,
  portraitBoardPx,
  portraitToastBottomPx,
  toasterPlacement,
} from './toasterPlacement';

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

function renderToaster(language: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider language={language}>
      <Toaster />
    </I18nProvider>,
  );
}

describe('Toaster', () => {
  it('labels the notification region in the app language (DESIGN 14)', async () => {
    renderToaster('de');
    act(() => {
      toast('Hallo');
    });
    await screen.findByText('Hallo');
    const region = document.querySelector('section[aria-label]');
    expect(region?.getAttribute('aria-label')).toMatch(/^Benachrichtigungen\b/);
  });

  it('sits above the portrait toolbar and the bottom safe area, on phones and wide screens', async () => {
    renderToaster();
    act(() => {
      toast('Link copied to clipboard!');
    });
    await screen.findByText('Link copied to clipboard!');
    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement;
    expect(toaster.style.getPropertyValue('--mobile-offset-bottom')).toBe(TOAST_BOTTOM_PORTRAIT);
    expect(toaster.style.getPropertyValue('--offset-bottom')).toBe(TOAST_BOTTOM_PORTRAIT);
    expect(TOAST_BOTTOM_PORTRAIT).toContain('env(safe-area-inset-bottom)');
    // The toolbar: 44 px buttons, py-1.5 and a border = 58 px above its own inset.
    expect(TOAST_BOTTOM_PORTRAIT).toContain('58px');
  });

  it('starts system toasts at the icon, not space-between (Ztyle .toast recipe)', async () => {
    renderToaster();
    act(() => {
      toast.success('Done');
    });
    await screen.findByText('Done');
    const frame = document.querySelector('[data-sonner-toast]') as HTMLElement;
    expect(frame).toHaveClass('toast');
    expect(frame).toHaveClass('justify-start');
  });

  it('in mobile landscape takes the bottom right beside the board', () => {
    const p = toasterPlacement(true);
    expect(p.className).toBe('zigo-toaster-rail');
    expect((p.style as Record<string, string>)['--width']).toBe(TOAST_WIDTH_LANDSCAPE);
    expect(p.offset).toMatchObject({ right: 'max(1rem, env(safe-area-inset-right))' });
    expect(p.mobileOffset).toEqual(p.offset);
    expect(String((p.offset as { bottom: string }).bottom)).toContain('env(safe-area-inset-bottom)');
  });

  it('on a wide portrait screen sits right of the board, narrowed so it clears the frame (1280×800)', () => {
    const viewport = { width: 1280, height: 800 };
    const p = toasterPlacement(false, viewport);
    expect(p.layout).toBe('beside');
    expect(p.position).toBe('bottom-right');
    expect((p.style as Record<string, string>)['--width']).toBe(TOAST_WIDTH_BESIDE);
    expect(p.offset).toMatchObject({ bottom: TOAST_BOTTOM_PORTRAIT, right: 'max(1rem, env(safe-area-inset-right))' });
    // The board is 576 px (800 − 14rem), centered; its frame adds 4 px outside.
    const board = portraitBoardPx(viewport);
    expect(board).toBe(576);
    const frameRight = (viewport.width + board) / 2 + 4;
    const toastLeft = viewport.width - 16 - besideWidthPx(viewport);
    expect(toastLeft).toBeGreaterThanOrEqual(frameRight + 8);
    // Sonner's default 356 px would reach over the frame.
    expect(viewport.width - 16 - 356).toBeLessThan(frameRight);
  });

  it('beside the board needs room for a usable toast; 1024×768 still has it', () => {
    expect(besideWidthPx({ width: 1024, height: 768 })).toBeGreaterThanOrEqual(MIN_BESIDE_PX);
    expect(toasterPlacement(false, { width: 1024, height: 768 }).layout).toBe('beside');
  });

  it('on a portrait tablet goes above the bottom chrome, centered and at most 356 px wide', () => {
    const p = toasterPlacement(false, { width: 768, height: 1024 });
    expect(p.layout).toBe('above');
    expect(p.position).toBe('bottom-center');
    expect((p.style as Record<string, string>)['--width']).toBe(TOAST_WIDTH_CENTERED);
    expect(p.offset).toMatchObject({ bottom: TOAST_BOTTOM_PORTRAIT });
  });

  it('on a phone sits above the bottom chrome, centered and at most 356 px wide', () => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      const p = toasterPlacement(false, viewport);
      expect(p.layout).toBe('above');
      expect(p.position).toBe('bottom-right');
      expect(p.style).toBeUndefined();
      expect(p.mobileOffset).toEqual({ bottom: TOAST_BOTTOM_PORTRAIT, left: TOAST_SIDE_PHONE, right: TOAST_SIDE_PHONE });
      expect(TOAST_SIDE_PHONE).toBe('max(1rem, calc((100vw - 356px) / 2))');
    }
  });

  it('clears the scoring bar and its note when the bar publishes its height', () => {
    // The toolbar's 58 px unless the bottom chrome (the scoring bar with a note) says more.
    expect(TOAST_BOTTOM_PORTRAIT).toContain(`var(${BOTTOM_CHROME_VAR}, 58px)`);
    expect(TOAST_BOTTOM_PORTRAIT).toContain(TOAST_BOTTOM_CAP);
    // 390×844 in scoring with the one-line note (58 + 0.5rem + 16 = 82 px): the toast's bottom edge
    // (844 − 106 = 738) is above the note's top (844 − 16 − 82 = 746).
    const phone = { width: 390, height: 844 };
    expect(portraitToastBottomPx(phone)).toBe(82);
    expect(portraitToastBottomPx(phone, 82)).toBe(106);
    expect(phone.height - portraitToastBottomPx(phone, 82)).toBeLessThan(phone.height - 16 - 82);
    // A one-line toast (48 px) there still clears the bottom strip (about 28 px below the board).
    const stripBottom = phone.height / 2 + portraitBoardPx(phone) / 2 + 28;
    expect(phone.height - portraitToastBottomPx(phone, 82) - 48).toBeGreaterThanOrEqual(stripBottom + 8);
  });

  it('never rises from above the toolbar into the board where no row is free (320×568)', () => {
    const small = { width: 320, height: 568 };
    // The note wraps to two lines there (98 px of chrome), and the board leaves no row for a toast.
    expect(portraitToastBottomPx(small, 98)).toBe(82);
    // Tablets and wide screens keep the toast above the toolbar, beside the board or centered.
    expect(portraitToastBottomPx({ width: 768, height: 1024 }, 82)).toBe(82);
    expect(portraitToastBottomPx({ width: 1280, height: 800 }, 82)).toBe(82);
  });

  it('follows the window: centered on a portrait tablet, right of the board on a wide screen', async () => {
    const size = { w: window.innerWidth, h: window.innerHeight };
    const resize = (w: number, h: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
      window.dispatchEvent(new Event('resize'));
    };
    try {
      act(() => resize(768, 1024));
      renderToaster();
      act(() => {
        toast('Opponent joined');
      });
      await screen.findByText('Opponent joined');
      const toaster = () => document.querySelector('[data-sonner-toaster]') as HTMLElement;
      expect(toaster().getAttribute('data-x-position')).toBe('center');
      expect(toaster().style.getPropertyValue('--width')).toBe(TOAST_WIDTH_CENTERED);
      act(() => resize(1280, 800));
      expect(toaster().getAttribute('data-x-position')).toBe('right');
      expect(toaster().style.getPropertyValue('--width')).toBe(TOAST_WIDTH_BESIDE);
    } finally {
      act(() => resize(size.w, size.h));
    }
  });
});
