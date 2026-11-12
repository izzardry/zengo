/**
 * Shared steps for the Zigo end-to-end suites: the start screen, the Go board by GTP coordinate,
 * the toolbar, history and fresh browser contexts.
 */
import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { fromGtp } from '../src/lib/zigo';
import type { Point, Size } from '../src/lib/types';

export const BASE_URL = 'http://localhost:4173';
export const SHOTS = 'docs/screenshots/m1';

/** The tutorial is covered by unit tests; here it would only sit on top of the board. */
export async function skipTutorial(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('zigo:tutorial-seen', 'true');
    } catch {
      /* storage blocked */
    }
  });
}

/** Share falls back to the clipboard (the native share sheet cannot be driven). */
export async function forceClipboardShare(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
}

/** A new context (fresh storage) with the tutorial skipped. */
export async function freshPage(browser: Browser, options: BrowserContextOptions): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE_URL, ...options });
  await skipTutorial(ctx);
  return ctx.newPage();
}

/** SGF point of a GTP coordinate (`D4` on 9×9 → `df`). */
export function sgf(gtp: string, size: Size): Point {
  const p = fromGtp(gtp, size);
  if (!p) throw new Error(`not a point: ${gtp}`);
  return p;
}

/* ---- the board ---------------------------------------------------------------------------- */

export const board = (page: Page) => page.getByRole('grid');

/** An intersection, by its accessible name (`black stone, D4`, `empty, D4, star point`). */
export function cell(page: Page, gtp: string): Locator {
  return board(page).getByRole('gridcell', { name: new RegExp(`^[^,]+, ${gtp}(,|$)`) });
}

export type StoneState = 'black stone' | 'white stone' | 'empty';

export async function expectPoint(page: Page, gtp: string, state: StoneState) {
  await expect(cell(page, gtp)).toHaveAccessibleName(new RegExp(`^${state}, ${gtp}(,|$)`));
}

/** Places the stone of the side to move with the mouse (a click places on every size). */
export async function place(page: Page, gtp: string, expected: 'black stone' | 'white stone') {
  await cell(page, gtp).click();
  await expectPoint(page, gtp, expected);
}

/** Plays alternating moves from the side to move (`first`), checking each stone. */
export async function playMoves(page: Page, moves: readonly string[], first: 'B' | 'W' = 'B') {
  let black = first === 'B';
  for (const m of moves) {
    await place(page, m, black ? 'black stone' : 'white stone');
    black = !black;
  }
}

/* ---- toolbar and chrome -------------------------------------------------------------------- */

export const stage = (page: Page) => page.getByTestId('stage');
export const toolbar = (page: Page) => page.getByRole('toolbar');
export const flag = (page: Page) => toolbar(page).getByRole('button', { name: /^Pass/ });
export const info = (page: Page) => page.getByRole('group', { name: 'Game info' });
export const live = (page: Page) => page.getByTestId('board-live');
export const passedBadge = (page: Page) => page.getByText('passed', { exact: true });
export const scoringBar = (page: Page) => page.getByRole('group', { name: 'Scoring' });
export const gameOver = (page: Page) => page.getByTestId('game-over');

export async function pass(page: Page) {
  await flag(page).click();
}

/** Two passes: the board enters scoring, and the engine's dead-stone proposal has had its chance. */
export async function passTwice(page: Page) {
  await pass(page);
  await expect(passedBadge(page)).toBeVisible();
  await pass(page);
  await expect(stage(page)).toHaveAttribute('data-phase', 'scoring');
  await expect(scoringBar(page)).toBeVisible();
  await settleProposal(page);
}

/**
 * How long the dead-stone proposal may take once the engine is ready: its search stops after 3 s
 * (lib/proposal.ts), and a hint search still running from the last turn may be ahead of it.
 */
export const PROPOSAL_SETTLE_MS = 7_000;

/**
 * Waits out the engine's dead-stone proposal on entering scoring (DESIGN 8.4: in every solo mode,
 * pass-and-play included). The proposal applies only to an unmarked position, all at once, so the
 * marks are settled once it shows, or once it had time to and showed nothing (every stone alive).
 * Without this, a tap and the proposal race: a tap on a stone the proposal already marked dead
 * would mark it alive again.
 */
export async function settleProposal(page: Page) {
  // The proposal's search loads the engine itself.
  await expect(stage(page)).toHaveAttribute('data-engine', /^(ready|failed)$/, { timeout: 60_000 });
  await expect
    .poll(() => page.locator('[data-mark="dead"]').count(), { timeout: PROPOSAL_SETTLE_MS })
    .toBeGreaterThan(0)
    .catch(() => undefined);
}

/** Makes a stone's group dead in scoring: taps it unless the proposal already marked it. */
export async function markDead(page: Page, gtp: string) {
  if (!/\bdead\b/.test((await cell(page, gtp).getAttribute('aria-label')) ?? '')) {
    await cell(page, gtp).click();
  }
  await expect(cell(page, gtp)).toHaveAccessibleName(/dead/);
}

/** Side-by-side seating: the one Accept of the scoring bar. */
export async function accept(page: Page) {
  await scoringBar(page).getByRole('button', { name: /^Accept/ }).click();
}

/** Code of the open game, from the address bar (`s`). */
export function codeOf(page: Page): string {
  const query = new URL(page.url()).hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('s') ?? '';
}

/** A query parameter of the address bar. */
export function param(page: Page, name: string): string | null {
  const query = new URL(page.url()).hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get(name);
}

/* ---- start screen ----------------------------------------------------------------------------- */

export const startPill = (page: Page, label = 'Start') => page.getByRole('button', { name: label, exact: true });
export const sizePill = (page: Page) => page.getByTestId('size-pill');
export const colorPill = (page: Page) => page.getByTestId('color-pill');

export async function selectTwoPlayers(page: Page) {
  const value = page.getByTestId('opponent-selector').getByText('Two players', { exact: true });
  const prev = page.getByRole('button', { name: 'Previous opponent' });
  for (let i = 0; i < 14 && !(await value.isVisible()); i++) await prev.click();
  await expect(value).toBeVisible();
}

/** Taps the size pill until it shows `size×size`. */
export async function selectSize(page: Page, size: Size) {
  const label = new RegExp(`^Board ${size}×${size},`);
  for (let i = 0; i < 3 && !label.test((await sizePill(page).getAttribute('aria-label')) ?? ''); i++) {
    await sizePill(page).click();
  }
  await expect(sizePill(page)).toHaveAttribute('aria-label', label);
}

/** A 500 ms hold with the mouse, released where it started: the dial stays open for a tap. */
async function hold(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

/** Hold the size pill, pick the rule set in the rules dial. */
export async function selectRules(page: Page, rules: 'area' | 'territory') {
  await hold(page, sizePill(page));
  // The menu itself is a 0×0 anchor at the dial's center; its items are what shows.
  const dial = page.getByTestId('rules-dial');
  const item = dial.getByRole('menuitemradio', { name: rules === 'area' ? /^Area scoring/ : /^Territory scoring/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(dial).toHaveCount(0);
  await expect(sizePill(page)).toHaveAttribute('aria-label', new RegExp(`${rules} scoring`));
}

/** Hold the color pill, pick the handicap in the handicap dial. */
export async function selectHandicap(page: Page, n: number) {
  await hold(page, colorPill(page));
  const dial = page.getByTestId('handicap-dial');
  const item = dial.getByRole('menuitemradio', { name: n === 0 ? 'No handicap' : `${n} handicap stones` });
  await expect(item).toBeVisible();
  await item.click();
  await expect(dial).toHaveCount(0);
}

export interface StartOptions {
  size?: Size;
  rules?: 'area' | 'territory';
  handicap?: number;
  /** Skip `page.goto` (already on the start screen). */
  here?: boolean;
}

/** Start screen → TWO PLAYERS (size, rules, handicap) → Start. */
export async function startTwoPlayers(page: Page, opts: StartOptions = {}) {
  if (!opts.here) await page.goto('./');
  await expect(stage(page)).toHaveAttribute('data-phase', 'start');
  await selectTwoPlayers(page);
  if (opts.size) await selectSize(page, opts.size);
  if (opts.rules) await selectRules(page, opts.rules);
  if (opts.handicap !== undefined) await selectHandicap(page, opts.handicap);
  await startPill(page).click();
  await expect(stage(page)).toHaveAttribute('data-phase', 'playing');
  await expect(toolbar(page)).toBeVisible();
  const size = opts.size ?? 9;
  await expect(board(page).getByRole('gridcell')).toHaveCount(size * size);
}

export async function backToStart(page: Page) {
  await page.getByRole('button', { name: 'Back to start' }).click();
  await expect(stage(page)).toHaveAttribute('data-phase', 'start');
}

/** A new random code on the start screen (the pill turns from Resume back to Start). */
export async function newCode(page: Page) {
  await page.getByRole('button', { name: /Tap for a new random code/ }).click();
  await expect(startPill(page)).toBeVisible();
}

export async function scrollToHistory(page: Page) {
  // The bounce chevron is always moving; scroll the way a user does.
  await expect(page.getByRole('button', { name: 'Show previous games' })).toBeVisible();
  await page.mouse.move(10, 10);
  await page.mouse.wheel(0, page.viewportSize()?.height ?? 800);
  await expect(page.getByRole('heading', { name: 'Previous games' })).toBeVisible();
}

export function historyCard(page: Page, code: string): Locator {
  return page.getByTestId('history-card').filter({ hasText: code });
}
