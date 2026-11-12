/**
 * Gate 2 (PLAN.md, milestone 2): the computer opponent on the production build served by
 * `vite preview` (base "./", the service worker, the real KataGo worker on TF.js). Every bullet of
 * the gate's Playwright list is one test:
 *
 *  - first launch: the status line shows stage 1's progress, then `Computer ready offline`, and
 *    `engine-cache` holds the TF.js wasm files and the small net;
 *  - level 1 as Black on 9×9: the computer replies within 10 s, ten moves, no console errors;
 *  - as White the computer moves first; handicap 2 as White: Black's stones stand, White moves first;
 *  - selecting level 8 starts stage 2: `Levels 8–12 ·` progress, then ready;
 *  - undo takes back a full turn, redo restores it;
 *  - hint: one point pulses, then three numbered points; a hold shows the territory and `B+`/`W+`;
 *  - blunder guard: a big self-atari from a prepared position is bounced once, then played, and
 *    the game is marked assisted;
 *  - from a prepared settled position both pass; scoring opens with the engine's dead stone;
 *    Accept ends the game;
 *  - byo-yomi `1m 3×10s` from a prepared position (Playwright's clock): main time runs out, `·3`,
 *    a move inside a period keeps it, the last period running out ends the game `Out of time`;
 *  - offline after the first load: a new level-3 game plays.
 *
 * Screenshots for the verifier go to docs/screenshots/m2/.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { Game, Point, Size } from '../src/lib/types';
import { decodeMoves, encodeMoves, gtp, handicapPoints, indexToPoint, isLegal, libertiesOf, makeSettings, play, pointToIndex, replay, selfAtariSize } from '../src/lib/zigo';
import {
  accept,
  backToStart,
  board,
  cell,
  expectPoint,
  flag,
  historyCard,
  info,
  param,
  scoringBar,
  scrollToHistory,
  sgf,
  skipTutorial,
  stage,
  toolbar,
} from './helpers';

const SHOTS = 'docs/screenshots/m2';
const SMALL_NET = 'engine/nets/g170-b6c96-s175395328-d26788732.bin.gz';
const LARGE_NET = 'engine/nets/g170e-b10c128-s1141046784-d204142634.bin.gz';
const TFJS_WASM = ['engine/tfjs/tfjs-backend-wasm.wasm', 'engine/tfjs/tfjs-backend-wasm-simd.wasm'];

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const startPill = (page: Page) => page.getByTestId('start-pill');
const engineStatus = (page: Page) => page.getByTestId('engine-status');
const opponentName = (page: Page) => page.getByTestId('opponent-name');
const timer = (page: Page, color: 'B' | 'W') => page.locator(`[data-color="${color}"] [role="timer"]`).first();

/** Moves of the live game, from the address bar (`m`, written on every change). */
function pliesOf(page: Page): Point[] {
  const m = param(page, 'm');
  return m ? decodeMoves(m) : [];
}

async function expectPlies(page: Page, n: number, timeout = 10_000) {
  await expect.poll(() => pliesOf(page).length, { timeout }).toBe(n);
}

/** The live game rebuilt from the address bar (`n`, `g`, `h`, `m`). */
function gameOf(page: Page): Game {
  const size = Number(param(page, 'n') ?? 9) as Size;
  const rules = param(page, 'g') === 't' ? 'territory' : 'area';
  const handicap = Number(param(page, 'h') ?? 0);
  return replay(makeSettings(size, rules, handicap), pliesOf(page));
}

/** Points tried first by `quietPoint`: the 3-3, 4-4 and side points of a 9×9 opening. */
const PREFERRED = ['E5', 'C3', 'G7', 'C7', 'G3', 'E3', 'E7', 'C5', 'G5', 'D4', 'F6', 'D6', 'F4', 'B4', 'H6', 'B6', 'H4', 'D2', 'F8'];

/**
 * A sensible point for the side to move: legal, not into atari, not filling its own eye. The
 * preferred opening points first, then every point in order.
 */
function quietPoint(g: Game): string {
  const size = g.settings.size;
  const all: string[] = [...PREFERRED];
  for (let i = 0; i < size * size; i++) all.push(gtp(indexToPoint(i, size), size));
  const me = g.turn === 'B' ? 1 : 2;
  for (const name of all) {
    const p = sgf(name, size);
    if (!isLegal(g, p) || selfAtariSize(g, p) > 0) continue;
    if (libertiesOf(play(g, p, 0), p) < 2) continue;
    const i = pointToIndex(p, size);
    const r = Math.floor(i / size);
    const c = i % size;
    const nbrs = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ].filter(([y, x]) => y >= 0 && x >= 0 && y < size && x < size);
    if (nbrs.every(([y, x]) => g.board[y * size + x] === me)) continue;
    return name;
  }
  throw new Error('no quiet point left');
}

/**
 * Places a stone. If the blunder guard bounces it (it pulses red, nothing is played), the same
 * stone again confirms it within the 5-second window (DESIGN 7.2).
 */
async function playStone(page: Page, name: string) {
  const before = pliesOf(page).length;
  const size = Number(param(page, 'n') ?? 9) as Size;
  const bounced = page.locator(`[data-mark="blunder"][data-point="${sgf(name, size)}"]`);
  const played = () => pliesOf(page).length > before;
  await cell(page, name).click();
  await expect.poll(async () => played() || (await bounced.count()) > 0, { timeout: 5000 }).toBe(true);
  for (let attempt = 0; attempt < 2 && !played(); attempt++) {
    await cell(page, name).click();
    const ok = await expect
      .poll(played, { timeout: 5000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  if (!played()) throw new Error(`stone ${name} was not played`);
}

/** Start screen preselected by a start-screen link (`o`, `d`, `w`, `n`, `h`, `g`, `t`), then Start. */
async function startComputer(page: Page, query: string) {
  await page.goto(`./#/?o=c&${query}`);
  await expect(stage(page)).toHaveAttribute('data-phase', 'start');
  await expect(startPill(page)).toHaveAttribute('data-label', 'start');
  await startPill(page).click();
  await expect(stage(page)).toHaveAttribute('data-phase', 'playing', { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
}

/** A game link: the position is on the board at once; the engine warms up for the computer. */
async function openLink(page: Page, query: string) {
  await page.goto(`./#/?${query}`);
  await expect(stage(page)).toHaveAttribute('data-phase', 'playing');
  await expect(stage(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
}

/** Every text the start screen's status line showed, in order (recorded from the first paint). */
async function recordStatusLine(context: BrowserContext) {
  await context.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __engineStatus: string[] }).__engineStatus = log;
    const read = () => {
      const el = document.querySelector('[data-testid="engine-status"]');
      const text = el?.textContent?.trim() ?? '';
      if (text && log[log.length - 1] !== text) log.push(text);
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

const statusLog = (page: Page) => page.evaluate(() => (window as unknown as { __engineStatus?: string[] }).__engineStatus ?? []);

/** URLs per Cache Storage cache. */
async function cachedUrls(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
    return out;
  });
}

/** The service worker controls the page (needed before going offline). */
async function swControls(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  const vp = page.viewportSize();
  await page.screenshot({ path: `${SHOTS}/${name}-${vp?.width}x${vp?.height}.png`, animations: 'disabled' });
}

/* ---------------------------------------------------------------------------------------------- */
/* Prepared positions                                                                               */
/* ---------------------------------------------------------------------------------------------- */

const moves = (size: Size, list: readonly string[]) => encodeMoves(list.map((m) => ({ m: m === 'pass' ? 'tt' : sgf(m, size), ms: 0 })));

/*
 * Big self-atari (9×9, Black to move). Black C5–D5 has two liberties, B5 and E5; White stands on
 * C4, D4, C6, D6, E4, E6 and F5. Black E5 leaves C5–D5–E5 with the single liberty B5, which White
 * may take at once: three stones, the guard's rule (DESIGN 7.2).
 */
const SELF_ATARI = ['C5', 'C4', 'D5', 'D4', 'B8', 'C6', 'H8', 'D6', 'H2', 'E4', 'B2', 'E6', 'J5', 'F5'];

/*
 * Settled 9×9 under territory rules (Black to move). Black walls column D, White column E; Black
 * has C5 inside its side, and the white stone B5 next to it is dead. White's best move after
 * Black's pass is a pass (the small net passes at every level here, measured in Node).
 *
 * Hand count (komi 6.5): Black A–C = 27 points less C5 = 26 territory (B5's point included) + 1
 * prisoner (the dead B5); White F–J = 36 territory + 0 + 6.5 = 42.5. White wins by 15.5.
 */
const SETTLED = [...['1', '2', '3', '4', '5', '6', '7', '8', '9'].flatMap((r) => [`D${r}`, `E${r}`]), 'C5', 'B5'];

/* ---------------------------------------------------------------------------------------------- */
/* Scenarios                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

test.describe('milestone 2 · computer', () => {
  // A desktop window (1280×720, Playwright's default, counts as a phone held sideways here).
  test.use({ viewport: { width: 1280, height: 800 } });

  let errors: string[];
  test.beforeEach(async ({ context, page }) => {
    await skipTutorial(context);
    errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
  });
  test.afterEach(() => {
    expect(errors, 'no errors in the console').toEqual([]);
  });

  test('first launch: stage 1 progress, then "Computer ready offline"; engine-cache holds TF.js and the small net', async ({ page, context }) => {
    test.setTimeout(120_000);
    await recordStatusLine(context);
    await page.goto('./');
    await expect(stage(page)).toHaveAttribute('data-phase', 'start');
    await expect(engineStatus(page)).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await expect(engineStatus(page)).toHaveText('Computer ready offline');
    await shot(page, 'start-ready');

    // The line counted up through stage 1 before it said ready.
    const log = await statusLog(page);
    expect(log.some((t) => /^Computer \d{1,3}%$/.test(t)), log.join(' | ')).toBe(true);
    expect(log[log.length - 1]).toBe('Computer ready offline');
    expect(log.some((t) => t.startsWith('Levels 8–12'))).toBe(false);

    // Stage 1 sits in engine-cache: both TF.js wasm files and the 6-block net, not the 10-block one.
    const base = new URL('./', page.url().split('#')[0]).href;
    const cached = await cachedUrls(page);
    const engineCache = cached['engine-cache'] ?? [];
    for (const f of [...TFJS_WASM, SMALL_NET]) expect(engineCache, f).toContain(base + f);
    expect(engineCache).not.toContain(base + LARGE_NET);
    // The precache does not carry engine files (the page downloads them with progress).
    for (const [name, urls] of Object.entries(cached)) {
      if (name !== 'engine-cache') expect(urls.filter((u) => u.includes('/engine/')), name).toEqual([]);
    }
  });

  test('level 1 as Black on 9×9: the computer replies within 10 s, ten moves, no console errors', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('./#/?o=c&d=1&w=B&n=9');
    await expect(opponentName(page)).toHaveText('Beginner');
    await startPill(page).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'playing', { timeout: 60_000 });
    await expect(stage(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
    await expect(info(page).locator('[data-cell="opponent"]')).toContainText('1');
    expect(param(page, 'd')).toBe('1');
    expect(param(page, 'w')).toBe('B');

    for (let i = 0; i < 10; i++) {
      expect(pliesOf(page)).toHaveLength(2 * i);
      await playStone(page, quietPoint(gameOf(page)));
      const t0 = Date.now();
      // The computer replies within 10 s.
      await expectPlies(page, 2 * i + 2, 10_000);
      expect(Date.now() - t0).toBeLessThan(10_000);
      await expect(stage(page)).not.toHaveAttribute('data-computer', 'thinking');
      // Its stone is on the board (unless it passed).
      const reply = pliesOf(page)[2 * i + 1];
      if (reply !== 'tt') await expectPoint(page, gtp(reply, 9), 'white stone');
    }
    expect(pliesOf(page)).toHaveLength(20);
    expect(gameOf(page).end).toBeUndefined();
    await shot(page, 'level1-ten-moves');
  });

  test('as White, the computer moves first', async ({ page }) => {
    await startComputer(page, 'd=1&w=W&n=9');
    await expectPlies(page, 1, 10_000);
    await expect(page.getByTestId('board-live')).toHaveText(/^Black: [A-HJ]\d$/);
    await expectPoint(page, gtp(pliesOf(page)[0], 9), 'black stone');
    // Then it is the player's turn: a white stone goes down, and the computer answers.
    await playStone(page, quietPoint(gameOf(page)));
    await expectPlies(page, 3, 10_000);
  });

  test('handicap 2 as White on 9×9: Black\'s stones stand and White (the player) moves first', async ({ page }) => {
    await startComputer(page, 'd=1&w=W&n=9&h=2');
    expect(param(page, 'h')).toBe('2');
    const stones = handicapPoints(9, 2).map((p) => gtp(p, 9));
    expect(stones).toHaveLength(2);
    for (const p of stones) await expectPoint(page, p, 'black stone');
    // White moves first: the computer does not move.
    await page.waitForTimeout(1500);
    expect(pliesOf(page)).toHaveLength(0);
    await expect(board(page).getByRole('gridcell', { name: /^black stone/ })).toHaveCount(2);
    await expect(board(page).getByRole('gridcell', { name: /^white stone/ })).toHaveCount(0);

    const first = quietPoint(gameOf(page));
    await playStone(page, first);
    await expectPoint(page, first, 'white stone');
    // The computer (Black) answers.
    await expectPlies(page, 2, 10_000);
    await expectPoint(page, gtp(pliesOf(page)[1], 9), 'black stone');
  });

  test('selecting level 8 starts stage 2: "Levels 8–12 ·" progress, then ready; a level-8 game plays', async ({ page, context }) => {
    test.setTimeout(180_000);
    await recordStatusLine(context);
    await page.goto('./#/?o=c&d=7&w=B&n=9');
    await expect(opponentName(page)).toHaveText('Tricky');
    await expect(engineStatus(page)).toHaveText('Computer ready offline', { timeout: 60_000 });
    const before = (await statusLog(page)).length;

    await page.getByRole('button', { name: 'Next opponent' }).click();
    await expect(opponentName(page)).toHaveText('Hard');
    await expect(engineStatus(page)).toHaveText('Computer ready offline', { timeout: 120_000 });
    const log = (await statusLog(page)).slice(before);
    expect(log.some((t) => /^Levels 8–12 · \d{1,3}%$/.test(t)), log.join(' | ')).toBe(true);
    expect(log[log.length - 1]).toBe('Computer ready offline');

    const base = new URL('./', page.url().split('#')[0]).href;
    expect((await cachedUrls(page))['engine-cache']).toContain(base + LARGE_NET);

    // The large net plays: Start, one stone, a reply.
    await startPill(page).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'playing', { timeout: 60_000 });
    expect(param(page, 'd')).toBe('8');
    await playStone(page, quietPoint(gameOf(page)));
    await expectPlies(page, 2, 20_000);
  });

  test('undo takes back a full turn; redo restores it', async ({ page }) => {
    await startComputer(page, 'd=1&w=B&n=9');
    await playStone(page, quietPoint(gameOf(page)));
    await expectPlies(page, 2);
    await playStone(page, quietPoint(gameOf(page)));
    await expectPlies(page, 4);
    const four = pliesOf(page);
    const lastOwn = gtp(four[2], 9);
    const lastReply = gtp(four[3], 9);

    const undo = toolbar(page).getByRole('button', { name: 'Take back your last move' });
    const redo = toolbar(page).getByRole('button', { name: 'Redo', exact: true });
    await undo.click();
    await expectPlies(page, 2);
    expect(pliesOf(page)).toEqual(four.slice(0, 2));
    await expectPoint(page, lastOwn, 'empty');
    await expectPoint(page, lastReply, 'empty');
    // The computer does not move again: it is the player's turn.
    await page.waitForTimeout(1500);
    expect(pliesOf(page)).toEqual(four.slice(0, 2));

    await redo.click();
    await expectPlies(page, 4);
    expect(pliesOf(page)).toEqual(four);
    await expectPoint(page, lastOwn, 'black stone');
    await expectPoint(page, lastReply, 'white stone');
  });

  test('hint: one point pulses, a second tap shows three numbered points; a hold shows the territory and B+/W+ in the info pill', async ({ page }) => {
    await startComputer(page, 'd=1&w=B&n=9');
    // A few stones, so the territory has something to show.
    await playStone(page, 'E5');
    await expectPlies(page, 2);
    await playStone(page, quietPoint(gameOf(page)));
    await expectPlies(page, 4);

    const hint = toolbar(page).getByRole('button', { name: /^Hint/ });
    const best = page.locator('[data-mark="hint"]');
    const numbered = page.locator('[data-mark="hint-n"]');
    await expect(hint).toBeEnabled();
    await hint.click();
    await expect(best).toHaveCount(1, { timeout: 15_000 });
    const point = (await best.getAttribute('data-point'))!;
    // The hinted point is a legal stone for Black.
    expect(isLegal(gameOf(page), point)).toBe(true);
    await expectPoint(page, gtp(point, 9), 'empty');
    await shot(page, 'hint-best');

    await hint.click();
    await expect(numbered).toHaveCount(3);
    await expect(best).toHaveCount(0);
    expect(await numbered.evaluateAll((els) => els.map((e) => e.getAttribute('data-n')))).toEqual(['1', '2', '3']);
    // The best point is number 1.
    await expect(numbered.first()).toHaveAttribute('data-point', point);
    for (const p of await numbered.evaluateAll((els) => els.map((e) => e.getAttribute('data-point')!))) {
      expect(isLegal(gameOf(page), p)).toBe(true);
    }
    await shot(page, 'hint-top3');

    // Hold the bulb for a second: the territory preview and the lead in the info pill.
    const box = (await hint.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const squares = page.locator('[data-layer="preview"] [data-mark^="preview-"]');
    await expect.poll(() => squares.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    // The lead sits on its own line under the info pill (DESIGN 7.3).
    const note = page.getByTestId('preview-note');
    await expect(note).toHaveText(/^[BW]\+\d+(\.5)?$/);
    await expect(page.getByTestId('assist-live')).toHaveText(/^Territory preview: (Black|White) /);
    await shot(page, 'territory-preview');
    await page.mouse.up();
    await expect(squares).toHaveCount(0);
    await expect(note).toHaveCount(0);
  });

  test('blunder guard: a big self-atari from a prepared position is bounced once, accepted the second time; the game is marked assisted', async ({ page }) => {
    await openLink(page, `s=GUARD1&p=1&o=c&d=1&w=B&n=9&m=${moves(9, SELF_ATARI)}`);
    await expectPoint(page, 'D5', 'black stone');
    await expectPoint(page, 'F5', 'white stone');
    // Helpers are on by default (the shield).
    await expect(toolbar(page).getByRole('button', { name: 'Turn helpers off' })).toBeVisible();
    expect(pliesOf(page)).toHaveLength(14);

    const e5 = sgf('E5', 9);
    await cell(page, 'E5').click();
    // Bounced: the stone pulses red at E5, nothing is played, and screen readers are told why.
    await expect(page.locator(`[data-mark="blunder"][data-point="${e5}"]`)).toHaveCount(1);
    await expect(page.getByTestId('assist-live')).toHaveText('That move looks like a blunder. Play it again to confirm.');
    await shot(page, 'guard-bounced');
    await page.waitForTimeout(500);
    await expectPoint(page, 'E5', 'empty');
    expect(pliesOf(page)).toHaveLength(14);

    // The same stone again within 5 s: played.
    await cell(page, 'E5').click();
    await expectPoint(page, 'E5', 'black stone');
    await expect.poll(() => pliesOf(page).length, { timeout: 3000 }).toBeGreaterThanOrEqual(15);
    expect(pliesOf(page)[14]).toBe(e5);

    // The game is marked assisted: the history card shows the dot.
    await expectPlies(page, 16, 10_000);
    await backToStart(page);
    await scrollToHistory(page);
    const card = historyCard(page, 'GUARD1');
    await expect(card).toHaveCount(1);
    await expect(card.getByLabel('Assisted')).toBeVisible();
  });

  test('from a prepared settled position the player passes, the computer passes, scoring proposes the dead stone, Accept ends the game', async ({ page }) => {
    test.setTimeout(120_000);
    await openLink(page, `s=SETTLE&p=1&o=c&d=1&w=B&n=9&g=t&m=${moves(9, SETTLED)}`);
    await expectPoint(page, 'B5', 'white stone');
    expect(pliesOf(page)).toHaveLength(20);

    await flag(page).click();
    // The computer passes too: scoring.
    await expect(stage(page)).toHaveAttribute('data-phase', 'scoring', { timeout: 15_000 });
    expect(pliesOf(page).slice(-2)).toEqual(['tt', 'tt']);
    await expect(scoringBar(page)).toBeVisible();
    // The engine's proposal marks the white stone in Black's area dead.
    await expect(cell(page, 'B5')).toHaveAccessibleName(/^white stone, B5.*dead/, { timeout: 30_000 });
    await expect(page.locator('[data-mark="dead"]')).toHaveCount(1);
    await expect(page.getByText('B 26 + 1 · W 36 + 0 + 6.5').first()).toBeVisible();
    await shot(page, 'scoring-proposal');

    await accept(page);
    const overlay = page.getByRole('dialog', { name: 'Lost by 15.5' });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('SETTLE');
    expect(param(page, 'r')).toBe('W+15.5');
  });

  test('byo-yomi 1m 3×10s from a prepared position: main time runs out (·3), a move inside a period keeps it, the last period ends the game Out of time', async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    // Each side's first move is untimed; from Black's second move on, Black's clock runs.
    await openLink(page, `s=BYOYO1&p=1&o=c&d=1&w=B&t=1m3x10&n=9&m=${moves(9, ['C3', 'G7'])}`);
    const black = timer(page, 'B');
    await expect(black).toHaveAttribute('data-running', 'true');
    // The face reads `m:ss` in main time; its spoken reading follows for screen readers.
    await expect(black).toHaveText(/^(1:00|0:5\d)/);
    // Let the warm-up searches (guard, hint) finish before jumping the clock.
    await page.waitForTimeout(3000);

    // Main time runs out: the first of three periods runs (1 s into it).
    const main = Number(await black.getAttribute('data-ms'));
    expect(main).toBeGreaterThan(50_000);
    await page.clock.fastForward(main + 1000);
    await expect(black).toHaveText(/·3/);
    expect(Number(await black.getAttribute('data-ms'))).toBeLessThan(10_000);
    await shot(page, 'byoyomi-period');

    // A move inside the period keeps it.
    await playStone(page, quietPoint(gameOf(page)));
    await expectPlies(page, 4, 10_000);
    await expect(black).toHaveAttribute('data-running', 'true');
    await expect(black).toHaveText(/·3/);
    expect(Number(await black.getAttribute('data-ms'))).toBeGreaterThan(8_000);

    // Overrunning a period uses it up…
    await page.clock.fastForward(10_500);
    await expect(black).toHaveText(/·2/);
    // …and the last one running out loses.
    await page.clock.fastForward('00:21');
    await expect(black).toHaveAttribute('data-flagged', 'true');
    const overlay = page.getByRole('dialog', { name: 'Out of time' });
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await expect(overlay).toContainText('BYOYO1');
    expect(param(page, 'r')).toBe('W+T');
  });

  test('offline after the first load: a new level-3 game plays', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('./#/?o=c&d=3&w=B&n=9');
    await expect(opponentName(page)).toHaveText('Easy');
    await expect(engineStatus(page)).toHaveText('Computer ready offline', { timeout: 60_000 });
    await swControls(page);

    await context.setOffline(true);
    await page.reload();
    await expect(stage(page)).toHaveAttribute('data-phase', 'start');
    await expect(opponentName(page)).toHaveText('Easy');
    await expect(engineStatus(page)).toHaveAttribute('data-status', 'ready');
    await expect(startPill(page)).toHaveAttribute('data-label', 'start');
    await startPill(page).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'playing', { timeout: 60_000 });
    await expect(stage(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
    expect(param(page, 'd')).toBe('3');
    for (let i = 0; i < 3; i++) {
      await playStone(page, quietPoint(gameOf(page)));
      await expectPlies(page, 2 * i + 2, 10_000);
    }
    await context.setOffline(false);
  });
});

/* ---- a phone in both themes: the computer's game, the hint and the engine's scoring proposal ---- */

test.describe('milestone 2 · phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const theme of ['light', 'dark'] as const) {
    test(`screenshots: computer game, hint and scoring (${theme})`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await skipTutorial(context);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.emulateMedia({ colorScheme: theme });

      await openLink(page, `s=PHONE${theme === 'light' ? 'L' : 'D'}&p=1&o=c&d=1&w=B&n=9&m=${moves(9, ['E5', 'C4', 'G4', 'D6', 'F7', 'C7'])}`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/game-${theme}-390x844.png`, animations: 'disabled' });

      const hint = toolbar(page).getByRole('button', { name: /^Hint/ });
      await hint.tap();
      await expect(page.locator('[data-mark="hint"]')).toHaveCount(1, { timeout: 15_000 });
      await hint.tap();
      await expect(page.locator('[data-mark="hint-n"]')).toHaveCount(3);
      await page.screenshot({ path: `${SHOTS}/hint-top3-${theme}-390x844.png`, animations: 'disabled' });

      await openLink(page, `s=PHSET${theme === 'light' ? 'L' : 'D'}&p=1&o=c&d=1&w=B&n=9&g=t&m=${moves(9, SETTLED)}`);
      await flag(page).tap();
      await expect(stage(page)).toHaveAttribute('data-phase', 'scoring', { timeout: 15_000 });
      await expect(cell(page, 'B5')).toHaveAccessibleName(/dead/, { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/scoring-${theme}-390x844.png`, animations: 'disabled' });
      expect(errors).toEqual([]);
    });
  }
});
