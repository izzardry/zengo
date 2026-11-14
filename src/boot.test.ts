import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_MS, FONT_WAIT_MS, FONT_WEIGHTS, READY_CLASS, firstChild, loadFonts, reveal, revealWhenSettled } from './boot';

function fakeDoc(load?: (font: string) => Promise<unknown>) {
  const doc = document.implementation.createHTMLDocument('boot');
  if (load) Object.defineProperty(doc, 'fonts', { value: { load } });
  return doc;
}

describe('boot', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads every weight of the brand font', async () => {
    const asked: string[] = [];
    await loadFonts(fakeDoc(async (f) => asked.push(f)));
    expect(asked).toEqual(FONT_WEIGHTS.map((w) => `${w} 1rem "Fira Code"`));
  });

  it('resolves when fonts are unsupported or a load fails', async () => {
    await expect(loadFonts(fakeDoc())).resolves.toBeUndefined();
    await expect(loadFonts(fakeDoc(() => Promise.reject(new Error('offline'))))).resolves.toBeUndefined();
  });

  it('reveals once, and without a second fade after the fallback showed the page', () => {
    const early = fakeDoc();
    reveal(early, 500);
    reveal(early, 600);
    expect(early.documentElement.className).toBe(READY_CLASS);
    const late = fakeDoc();
    reveal(late, FALLBACK_MS);
    expect(late.documentElement.classList.contains('zengo-late')).toBe(true);
    expect(late.documentElement.classList.contains(READY_CLASS)).toBe(true);
  });

  it('waits for the fonts and the first commit, then two frames', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    vi.useFakeTimers();
    const doc = fakeDoc();
    let fontsDone!: () => void;
    let mountDone!: () => void;
    const fonts = new Promise<void>((r) => (fontsDone = r));
    const mounted = new Promise<void>((r) => (mountDone = r));
    void revealWhenSettled(fonts, mounted, doc);
    mountDone();
    await vi.advanceTimersByTimeAsync(100);
    expect(doc.documentElement.classList.contains(READY_CLASS)).toBe(false);
    fontsDone();
    await vi.advanceTimersByTimeAsync(20);
    expect(doc.documentElement.classList.contains(READY_CLASS)).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(doc.documentElement.classList.contains(READY_CLASS)).toBe(true);
  });

  it('does not wait longer than FONT_WAIT_MS for fonts', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    vi.useFakeTimers();
    const doc = fakeDoc();
    void revealWhenSettled(new Promise<void>(() => undefined), Promise.resolve(), doc);
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 1);
    expect(doc.documentElement.classList.contains(READY_CLASS)).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(doc.documentElement.classList.contains(READY_CLASS)).toBe(true);
  });
});

describe('firstChild', () => {
  it('resolves when the element gets its first child', async () => {
    const el = document.createElement('div');
    let done = false;
    void firstChild(el).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    el.appendChild(document.createElement('main'));
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(true);
    await expect(firstChild(el)).resolves.toBeUndefined();
  });
});
