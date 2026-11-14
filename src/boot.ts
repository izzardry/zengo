/**
 * First paint without flicker. index.html keeps #root transparent (inline CSS) and sets the theme
 * and background before anything loads. Here the brand font's weights start loading at once (they
 * are also preloaded by index.html in the build), React renders the app hidden, and the page fades
 * in (300 ms, Ztyle's chrome duration) only once the fonts are in and the first layout has settled:
 * no text drawn in a fallback font that changes shape a few frames later, no element finding its
 * place in view.
 *
 * Bounded: the reveal never waits longer than `FONT_WAIT_MS` for fonts, and index.html's CSS shows
 * the page by itself after 4 s if this script never runs.
 */

/** Fira Code weights the app uses (font-light … font-bold). */
export const FONT_WEIGHTS = [300, 400, 500, 600, 700] as const;

/** The longest the reveal waits for the fonts. */
export const FONT_WAIT_MS = 1500;

/** Animation frames after the first commit before the reveal: effects, measurements and their re-renders land. */
export const SETTLE_FRAMES = 2;

/** The class on <html> that fades #root in (index.html). */
export const READY_CLASS = 'zigo-ready';

/** Starts loading every weight of the brand font; resolves when all are in (or failed). */
export function loadFonts(doc: Document = document): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
  return Promise.all(FONT_WEIGHTS.map((w) => fonts.load(`${w} 1rem "Fira Code"`))).then(
    () => undefined,
    () => undefined,
  );
}

/** Resolves when `el` gets its first child: React's first commit inserts the whole screen at once. */
export function firstChild(el: Element): Promise<void> {
  if (el.firstElementChild) return Promise.resolve();
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (!el.firstElementChild) return;
      obs.disconnect();
      resolve();
    });
    obs.observe(el, { childList: true });
  });
}

/** Resolves after `n` animation frames. */
export function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });
}

/** index.html's fallback shows the page by itself this long after loading. */
export const FALLBACK_MS = 10_000;

/** Fades the page in (once); after the fallback has shown it, without a second fade. */
export function reveal(doc: Document = document, now: number = performance.now()): void {
  const root = doc.documentElement;
  if (root.classList.contains(READY_CLASS)) return;
  if (now >= FALLBACK_MS - 300) root.classList.add('zigo-late');
  root.classList.add(READY_CLASS);
}

/**
 * Reveals the page once `fonts` and `mounted` (the first React commit) are done and the layout has
 * had `SETTLE_FRAMES` frames to settle, or after `FONT_WAIT_MS` at the latest for the fonts.
 */
export function revealWhenSettled(fonts: Promise<void>, mounted: Promise<void>, doc: Document = document): Promise<void> {
  const fontsOrTimeout = Promise.race([fonts, new Promise<void>((r) => setTimeout(r, FONT_WAIT_MS))]);
  return Promise.all([fontsOrTimeout, mounted])
    .then(() => frames(SETTLE_FRAMES))
    .then(() => reveal(doc));
}
