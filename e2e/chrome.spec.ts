/**
 * Final phase (PLAN.md section 5): game chrome geometry on phones, in the production build.
 *
 * - Face-to-face scoring: the far player's compact Accept has a 44 px hit area at 390×844
 *   (DESIGN 13, 14.1), although it is drawn 32 px high in the far strip.
 * - Mobile landscape: the left rail (far strip, info pill, near strip) fits below the Back button
 *   and above the bottom inset, in play with prisoners and komi and in face-to-face scoring with
 *   the score line, at 844×390 and 667×375.
 */
import { test, expect, type Page } from '@playwright/test';
import { encodeMoves } from '../src/lib/zigo';
import { cell, sgf, skipTutorial, stage } from './helpers';

/** 9×9 walls on E and F, a white invader at B5, then two passes: the link opens in scoring. */
const WALLS9 = ['E5', 'F5', 'E4', 'F4', 'E6', 'F6', 'E3', 'F3', 'E7', 'F7', 'E2', 'F2', 'E8', 'F8', 'E1', 'F1', 'E9', 'B5', 'C5', 'F9'];
/** 9×9 in progress with a capture on each side (Black takes E5, White takes H8). */
const CAPTURES9 = ['D5', 'E5', 'F5', 'C3', 'E4', 'G7', 'E6', 'G8', 'H8', 'J8', 'C7', 'H9', 'D3', 'H7', 'C4', 'F3', 'D7', 'G5'];

/** A pass-and-play game link (relative to the config's baseURL). */
const link = (code: string, gtps: readonly string[], passes = 0) => {
  const plies = [...gtps.map((m) => sgf(m, 9)), ...Array<string>(passes).fill('tt')].map((m) => ({ m, ms: 0 }));
  return `./#/?s=${code}&p=1&o=l&n=9&m=${encodeMoves(plies)}`;
};

/** A touch phone of this size, tutorial skipped, face-to-face seating (the touch default, set anyway). */
function phone(width: number, height: number) {
  test.use({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  test.beforeEach(async ({ context }) => {
    await skipTutorial(context);
    await context.addInitScript(() => localStorage.setItem('zigo:seating', JSON.stringify('face')));
  });
}

/** The far Accept is enabled once the engine's dead-stone proposal has run (DESIGN 8.4 step 1). */
async function openScoring(page: Page, code: string) {
  await page.goto(link(code, WALLS9, 2));
  await expect(stage(page)).toHaveAttribute('data-phase', 'scoring');
  const far = page.getByRole('button', { name: 'Accept the count for White' });
  await expect(far).toBeEnabled({ timeout: 60_000 });
  return far;
}

test.describe('390×844: the far Accept', () => {
  phone(390, 844);

  test('face to face, the far Accept answers taps 5 px above and below its 32 px button (44 px)', async ({ page }) => {
    test.setTimeout(120_000);
    const far = await openScoring(page, 'HIT044');
    const box = (await far.boundingBox())!;
    expect(box.height).toBeLessThan(44);
    const x = box.x + box.width / 2;
    // The point 5 px outside the drawn button, on either side, still belongs to it.
    for (const y of [box.y - 5, box.y + box.height + 5]) {
      const hit = await page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py);
          return !!el?.closest('button[data-action="accept"][data-side="W"]');
        },
        [x, y] as const,
      );
      expect(hit, `tap at y=${Math.round(y)}`).toBe(true);
    }
  });
});

/** The two player strips and the info pill lie below the Back button and above the bottom inset. */
async function expectRailFits(page: Page, height: number) {
  const back = (await page.getByRole('button', { name: 'Back to start' }).boundingBox())!;
  const top = back.y + back.height;
  const strips = page.locator('[data-color]');
  await expect(strips).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const b = (await strips.nth(i).boundingBox())!;
    expect(b.y, 'strip below the Back button').toBeGreaterThanOrEqual(top);
    expect(b.y + b.height, 'strip above the bottom inset').toBeLessThanOrEqual(height - 16 + 1);
  }
  const pill = (await page.getByRole('group', { name: 'Game info' }).boundingBox())!;
  expect(pill.y).toBeGreaterThanOrEqual(top);
}

for (const [width, height] of [
  [844, 390],
  [667, 375],
] as const) {
  test.describe(`${width}×${height}: the left rail`, () => {
    phone(width, height);

    test('fits in play, with prisoners on both strips and komi on White’s', async ({ page }) => {
      await page.goto(link(`RAIL${width}`, CAPTURES9));
      await expect(stage(page)).toHaveAttribute('data-phase', 'playing');
      await expect(page.locator('[data-part="prisoners"]')).toHaveCount(2);
      await expectRailFits(page, height);
    });

    test('fits in face-to-face scoring: the far Accept and the score line on both strips', async ({ page }) => {
      test.setTimeout(120_000);
      await openScoring(page, `RSC${width}`);
      await expect(cell(page, 'B5')).toBeVisible();
      await expect(page.locator('[data-part="score-side"]')).toHaveCount(4);
      await expectRailFits(page, height);
    });
  });
}
