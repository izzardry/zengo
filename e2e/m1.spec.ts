/**
 * Gate 1 (PLAN.md, milestone 1): pass-and-play Go end to end on the production build, at a phone
 * (390×844) and a desktop (1280×800) viewport, plus 19×19 ghost placement with touch at 320×568
 * and 390×844. The screenshots for the verifier are written to docs/screenshots/m1/.
 */
import { test, expect, type Page } from '@playwright/test';
import { encodeMoves } from '../src/lib/zigo';
import {
  BASE_URL,
  SHOTS,
  accept,
  backToStart,
  board,
  cell,
  codeOf,
  expectPoint,
  flag,
  forceClipboardShare,
  gameOver,
  historyCard,
  info,
  live,
  markDead,
  newCode,
  param,
  passTwice,
  pass,
  passedBadge,
  place,
  playMoves,
  scoringBar,
  scrollToHistory,
  sgf,
  skipTutorial,
  stage,
  startPill,
  startTwoPlayers,
  toolbar,
} from './helpers';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

/*
 * The scripted 9×9 game. Black builds a wall on column F, White on column G. In the middle a ko:
 * White F5 throws in, Black G5 takes it (1 prisoner), White may not retake at once, plays B7 inside
 * Black's side instead, and Black connects at F5. The walls close, both pass, and B7 is marked dead.
 *
 * Final position (hand count):
 *   Black stones: F1–F9, E5, G5 = 11. Black's side A–E: 45 points less the stone on E5 = 44,
 *   B7 included (a dead stone's point is territory). White stones: G1–G4, G6–G9, H5 = 9.
 *   White's side H–J: 18 points less the stone on H5 = 17.
 *   Area (komi 7.5):      B 11 + 44 = 55, W 9 + 17 = 26 + 7.5 = 33.5  → Black wins by 21.5.
 *   Territory (komi 6.5): B 44 + 2 prisoners (F5 taken, B7 dead) = 46,
 *                         W 17 + 0 + 6.5 = 23.5                        → Black wins by 22.5.
 */
const OPENING = ['F4', 'G4', 'F6', 'G6', 'E5', 'H5', 'F3', 'F5'];
const AFTER_KO = ['B7', 'F5', 'G3', 'F2', 'G2', 'F1', 'G1', 'F7', 'G7', 'F8', 'G8', 'F9', 'G9'];

/** Plays the scripted game up to scoring, checking the capture and the refused ko retake. */
async function playScriptedGame(page: Page) {
  await playMoves(page, OPENING);

  // Black G5 captures the white stone on F5: the prisoner count and the live region update.
  await place(page, 'G5', 'black stone');
  await expectPoint(page, 'F5', 'empty');
  await expect(page.getByLabel('Black has captured 1')).toBeVisible();
  await expect(live(page)).toContainText('Black: G5, captures 1');

  // White's immediate retake is refused, with the one-time ko toast.
  await cell(page, 'F5').click();
  await expect(page.getByText(/^Ko:/)).toBeVisible();
  await expectPoint(page, 'F5', 'empty');
  await expectPoint(page, 'G5', 'black stone');

  // White plays elsewhere, Black connects, and the walls close.
  await playMoves(page, AFTER_KO, 'W');
  await expect(page.getByLabel('Black has captured 1')).toBeVisible();

  // Black passes, White passes: scoring.
  await passTwice(page);
}

for (const vp of VIEWPORTS) {
  test.describe(`milestone 1 @ ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    let errors: string[];
    test.beforeEach(async ({ context, page }) => {
      await skipTutorial(context);
      errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
    });
    test.afterEach(() => {
      expect(errors, 'no uncaught page errors').toEqual([]);
    });

    test('pass-and-play 9×9: capture, refused ko, two passes, a dead group, Accept: Black wins by 21.5', async ({ page }) => {
      await startTwoPlayers(page);
      await playScriptedGame(page);

      await markDead(page, 'B7');
      await expect(page.getByText('B 55 · W 26 + 7.5').first()).toBeVisible();
      await accept(page);

      const overlay = page.getByRole('dialog', { name: 'Black wins by 21.5!' });
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText('9×9');
      await expect(overlay.getByRole('button', { name: 'New game' })).toBeVisible();
    });

    test('the same final position under territory rules: Black wins by 22.5', async ({ page }) => {
      await startTwoPlayers(page, { rules: 'territory' });
      expect(param(page, 'g')).toBe('t');
      await playScriptedGame(page);

      await markDead(page, 'B7');
      await expect(page.getByText('B 44 + 2 · W 17 + 0 + 6.5').first()).toBeVisible();
      await accept(page);

      const overlay = page.getByRole('dialog', { name: 'Black wins by 22.5!' });
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText('9×9');
    });

    test('handicap 3 on 13×13: stones on D4, K10, D10, komi +0.5, White moves first', async ({ page }) => {
      await startTwoPlayers(page, { size: 13, handicap: 3 });
      for (const p of ['D4', 'K10', 'D10']) await expectPoint(page, p, 'black stone');
      // The fourth corner star point stays empty.
      await expectPoint(page, 'K4', 'empty');
      await expect(page.getByText('+0.5', { exact: true })).toBeVisible();
      expect(param(page, 'h')).toBe('3');
      expect(param(page, 'n')).toBe('13');
      // White is to move: the first stone placed is white.
      await place(page, 'G7', 'white stone');
      await place(page, 'K4', 'black stone');
    });

    test('undo twice and redo once across a pass: the position and the passed badge match', async ({ page }) => {
      await startTwoPlayers(page);
      await place(page, 'D4', 'black stone');
      await pass(page); // White passes
      await expect(passedBadge(page)).toBeVisible();
      await place(page, 'E5', 'black stone');
      await expect(passedBadge(page)).toBeHidden();

      const undo = toolbar(page).getByRole('button', { name: 'Undo', exact: true });
      const redo = toolbar(page).getByRole('button', { name: 'Redo', exact: true });
      await undo.click();
      await expectPoint(page, 'E5', 'empty');
      await expect(passedBadge(page)).toBeVisible();
      await undo.click();
      await expectPoint(page, 'D4', 'black stone');
      await expect(passedBadge(page)).toBeHidden();
      await redo.click();

      // After D4 and White's pass: D4 stands, E5 is empty, White's badge is back, Black is to move.
      await expectPoint(page, 'D4', 'black stone');
      await expectPoint(page, 'E5', 'empty');
      await expect(passedBadge(page)).toBeVisible();
      await expect(flag(page)).toHaveAccessibleName('Pass and end the game (hold to resign)');
      await expect(redo).toBeEnabled();
      const m = encodeMoves([
        { m: sgf('D4', 9), ms: 0 },
        { m: 'tt', ms: 0 },
      ]);
      await expect(page).toHaveURL(new RegExp(`m=${m}(&|$)`));
      // Black is to move.
      await place(page, 'C3', 'black stone');
    });

    test('typing D4 + Enter places the stone; pass + Enter passes', async ({ page }) => {
      await startTwoPlayers(page);
      await page.keyboard.type('d4');
      await page.keyboard.press('Enter');
      await expectPoint(page, 'D4', 'black stone');
      await expect(live(page)).toHaveText('Black: D4');
      await page.keyboard.type('pass');
      await page.keyboard.press('Enter');
      await expect(passedBadge(page)).toBeVisible();
      await expect(live(page)).toHaveText('White passes');
    });

    test('reload during scoring keeps the marks; Back lists the game in history; resume it', async ({ page }) => {
      await startTwoPlayers(page);
      await playMoves(page, ['E5', 'B7']);
      await passTwice(page);
      await markDead(page, 'B7');
      await expect(page.getByText('B 81 · W 0 + 7.5').first()).toBeVisible();
      const code = codeOf(page);
      expect(code).toMatch(/^[0-9A-Z]{6}$/);

      await page.reload();
      await expect(stage(page)).toHaveAttribute('data-phase', 'scoring');
      await expect(cell(page, 'B7')).toHaveAccessibleName(/^white stone, B7.*dead/);
      await expect(page.getByText('B 81 · W 0 + 7.5').first()).toBeVisible();
      expect(codeOf(page)).toBe(code);

      await backToStart(page);
      await expect(startPill(page, 'Resume')).toBeVisible();
      await scrollToHistory(page);
      const card = historyCard(page, code);
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('9×9');
      await expect(card).toContainText('Scoring');

      await card.click();
      await expect(stage(page)).toHaveAttribute('data-phase', 'scoring');
      await expect(cell(page, 'B7')).toHaveAccessibleName(/dead/);
      expect(codeOf(page)).toBe(code);
      // The marks still count: Accept ends the game.
      await accept(page);
      await expect(page.getByRole('dialog', { name: 'Black wins by 73.5!' })).toBeVisible();
    });

    test('a finished game opens in review; stepping works; continue from here starts a new game at the same size', async ({ page }) => {
      await startTwoPlayers(page, { size: 13 });
      await playMoves(page, ['D4', 'K10', 'K4']);
      await passTwice(page); // White passes, Black passes
      await accept(page);
      await expect(page.getByRole('dialog', { name: 'White wins by 6.5!' })).toBeVisible();
      const code = codeOf(page);
      await page.keyboard.press('Escape');
      await expect(gameOver(page)).toBeHidden();
      await backToStart(page);
      await expect(startPill(page, 'Review')).toBeVisible();

      await scrollToHistory(page);
      const card = historyCard(page, code);
      await expect(card).toContainText('13×13');
      await card.click();

      await expect(stage(page)).toHaveAttribute('data-phase', 'review');
      await expect(gameOver(page)).toBeHidden();
      await expect(board(page).getByRole('gridcell')).toHaveCount(169);
      await expectPoint(page, 'K4', 'black stone');

      const back = toolbar(page).getByRole('button', { name: /^Previous move/ });
      const forward = toolbar(page).getByRole('button', { name: /^Next move/ });
      // D4, K10, K4, pass, pass: three steps back stand after K10.
      await back.click();
      await back.click();
      await expectPoint(page, 'K4', 'black stone');
      await back.click();
      await expectPoint(page, 'K4', 'empty');
      await forward.click();
      await expectPoint(page, 'K4', 'black stone');
      await back.click();
      await expectPoint(page, 'K4', 'empty');
      await expectPoint(page, 'K10', 'white stone');
      // The board is read-only in review.
      await cell(page, 'K4').click();
      await expectPoint(page, 'K4', 'empty');

      await toolbar(page).getByRole('button', { name: 'Continue from here' }).click();
      await expect(stage(page)).toHaveAttribute('data-phase', 'playing');
      const fresh = codeOf(page);
      expect(fresh).toMatch(/^[0-9A-Z]{6}$/);
      expect(fresh).not.toBe(code);
      await expect(board(page).getByRole('gridcell')).toHaveCount(169);
      expect(param(page, 'n')).toBe('13');
      await expectPoint(page, 'D4', 'black stone');
      await expectPoint(page, 'K10', 'white stone');
      // A live game from that position: Black is to move and can play.
      await place(page, 'K4', 'black stone');
    });

    test('a share URL with moves and n=13 opens in a fresh context; Copy SGF has SZ[13] and the result', async ({ page, context, browser }) => {
      await forceClipboardShare(context);
      await startTwoPlayers(page, { size: 13 });
      await playMoves(page, ['D4', 'K10', 'K4']);

      await toolbar(page).getByRole('button', { name: 'Share game' }).click();
      await expect(page.getByText('Link copied to clipboard!')).toBeVisible();
      const url = await page.evaluate(() => navigator.clipboard.readText());
      expect(url).toMatch(/[?&]n=13(&|$)/);
      expect(url).toMatch(/[?&]m=[a-t]+(&|$)/);

      const other = await browser.newContext({ baseURL: BASE_URL, viewport: { width: vp.width, height: vp.height } });
      try {
        await skipTutorial(other);
        await forceClipboardShare(other);
        const p2 = await other.newPage();
        const errors2: string[] = [];
        p2.on('pageerror', (e) => errors2.push(e.message));
        await p2.goto(url);
        await expect(stage(p2)).toHaveAttribute('data-phase', 'playing');
        await expect(board(p2).getByRole('gridcell')).toHaveCount(169);
        await expectPoint(p2, 'D4', 'black stone');
        await expectPoint(p2, 'K10', 'white stone');
        await expectPoint(p2, 'K4', 'black stone');
        await expectPoint(p2, 'G7', 'empty');

        // Finish it there (White passes, Black passes, Accept: B 2 · W 1 + 7.5) and copy the SGF.
        await passTwice(p2);
        await expect(p2.getByText('B 2 · W 1 + 7.5').first()).toBeVisible();
        await accept(p2);
        const overlay = p2.getByRole('dialog', { name: 'White wins by 6.5!' });
        await expect(overlay).toBeVisible();
        await overlay.getByRole('button', { name: 'Share' }).click();
        await p2.getByRole('menuitem', { name: 'Copy SGF' }).click();
        await expect(p2.getByText('SGF copied!')).toBeVisible();
        const sgfText = await p2.evaluate(() => navigator.clipboard.readText());
        expect(sgfText).toContain('SZ[13]');
        expect(sgfText).toContain('RE[W+6.5]');
        expect(sgfText).toContain(';B[dj]');
        expect(errors2).toEqual([]);
      } finally {
        await other.close();
      }
    });

    for (const theme of ['light', 'dark'] as const) {
      test(`screenshots: start, game at each size, scoring, overlay and history (${theme})`, async ({ page }) => {
        const shot = async (name: string) => {
          await page.waitForTimeout(700);
          await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${vp.width}x${vp.height}.png`, animations: 'disabled' });
        };
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('./');
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await expect(startPill(page)).toBeVisible();
        await shot('start');

        await startTwoPlayers(page, { here: true });
        await playMoves(page, ['C3', 'G7', 'C7', 'G3', 'E5', 'E3', 'D6', 'F6', 'C5', 'G5']);
        await shot('game-9');

        await backToStart(page);
        await newCode(page);
        await startTwoPlayers(page, { here: true, size: 13 });
        await playMoves(page, ['D4', 'K10', 'D10', 'K4', 'G7', 'J7', 'F9', 'H3']);
        await shot('game-13');

        await backToStart(page);
        await newCode(page);
        await startTwoPlayers(page, { here: true, size: 19 });
        await playMoves(page, ['D4', 'Q16', 'D16', 'Q4', 'K10', 'R10', 'C10', 'K3', 'F3', 'O17', 'D10', 'Q10']);
        await shot('game-19');

        await passTwice(page);
        await markDead(page, 'K3');
        await expect(scoringBar(page)).toBeVisible();
        await shot('scoring');

        await accept(page);
        await expect(gameOver(page)).toBeVisible();
        await shot('overlay');

        await page.keyboard.press('Escape');
        await expect(gameOver(page)).toBeHidden();
        await backToStart(page);
        await scrollToHistory(page);
        await expect(page.getByTestId('history-card')).toHaveCount(3);
        await shot('history');
      });
    }
  });
}

/* ---- 19×19 ghost placement with touch (DESIGN 6.1) ------------------------------------------- */

const TOUCH_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

for (const vp of TOUCH_VIEWPORTS) {
  test.describe(`19×19 touch @ ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });

    let errors: string[];
    test.beforeEach(async ({ context, page }) => {
      await skipTutorial(context);
      errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
    });
    test.afterEach(() => {
      expect(errors, 'no uncaught page errors').toEqual([]);
    });

    test('a tap shows the ghost, a second tap on it commits, a tap elsewhere moves it', async ({ page }) => {
      await startTwoPlayers(page, { size: 19 });
      const ghost = page.getByTestId('ghost');

      // First tap: the ghost with crosshairs, the info pill previews `D4?`, nothing is placed.
      await cell(page, 'D4').tap();
      await expect(ghost).toHaveAttribute('data-point', sgf('D4', 19));
      await expect(page.locator('[data-mark="crosshair"]')).toHaveCount(1);
      await expectPoint(page, 'D4', 'empty');
      await expect(info(page)).toContainText('D4?');

      // Second tap on the ghost: the stone is placed.
      await cell(page, 'D4').tap();
      await expectPoint(page, 'D4', 'black stone');
      await expect(ghost).toHaveCount(0);

      // White: a tap shows the ghost, a tap elsewhere moves it; neither commits.
      await cell(page, 'Q16').tap();
      await expect(ghost).toHaveAttribute('data-point', sgf('Q16', 19));
      await cell(page, 'K10').tap();
      await expect(ghost).toHaveAttribute('data-point', sgf('K10', 19));
      await expectPoint(page, 'Q16', 'empty');
      await expectPoint(page, 'K10', 'empty');
      await expect(info(page)).toContainText('K10?');

      // Confirm on the moved ghost.
      await cell(page, 'K10').tap();
      await expectPoint(page, 'K10', 'white stone');
      await expectPoint(page, 'Q16', 'empty');

      // A few more stones for the picture: stones must be told apart at this size.
      for (const [p, s] of [
        ['Q16', 'black stone'],
        ['D16', 'white stone'],
        ['Q4', 'black stone'],
        ['K11', 'white stone'],
      ] as const) {
        await cell(page, p).tap();
        await expect(ghost).toHaveAttribute('data-point', sgf(p, 19));
        await cell(page, p).tap();
        await expectPoint(page, p, s);
      }
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/game-19-touch-${theme}-${vp.width}x${vp.height}.png`, animations: 'disabled' });
      }
    });
  });
}
