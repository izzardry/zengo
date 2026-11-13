/**
 * Gate 3 (PLAN.md, milestone 3): rooms between two isolated browser contexts (two devices) on the
 * real build served by `vite preview`, over real WebRTC data channels.
 *
 *  - Manual path (must pass, no third party): the PeerJS broker is blocked in both contexts, so the
 *    room offers `Connect manually` (DESIGN 9). The host creates a 9×9 territory room with the clock
 *    off; the host's offer link goes to the guest context, the guest's answer link comes back
 *    through the paste field. Both see the settings; stones go both ways with one capture; a
 *    takeback is asked and accepted; both pass; the host's (seat 0's) proposal shows on both boards;
 *    the guest toggles a group, which clears both acceptances; both accept the same marking; the
 *    result matches on both; rematch with swapped colors; score `1 – 0`.
 *  - Resume (must pass): after both pass the guest presses Resume, play continues, and the next two
 *    passes end the game at once from seat 0's proposal (round 2, DESIGN 9.5) with the same result
 *    on both devices.
 *  - Recovery (must pass): game 1 ends by resignation, game 2 reaches scoring and the guest toggles
 *    a group; the guest's storage is cleared, it starts the same code with ROOM, the host allows the
 *    rejoin, and the restored guest shows the same marks, the score and both games in its history.
 *  - Offline pass (must pass): untimed game, the guest page closes, the host passes, the guest page
 *    comes back, and the pass arrives on reconnect (DESIGN 9.3).
 *  - BroadcastChannel hand-over: the answer link opened in a second tab of the host's context hands
 *    the answer to the waiting tab, which connects.
 *  - Broker path (best effort): the same join through the public PeerJS broker. Marked fixme at
 *    runtime only when the app classifies the broker as unreachable.
 *
 * The dead-stone proposal comes from seat 0's real engine (the small net). The manual path's
 * position is built so the engine has an obvious dead stone (B5, as in m2's settled position), but
 * the test asserts only what the room guarantees: both boards show the same marks, whatever the
 * engine proposed (DESIGN 9.5, PLAN 7: the proposal is data sent with `mark`).
 *
 * Only public STUN servers and, in the broker test, the public PeerJS broker are contacted. Codes are
 * random per run. Screenshots for the verifier go to docs/screenshots/m3/.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  BASE_URL,
  cell,
  flag,
  gameOver,
  historyCard,
  info,
  passedBadge,
  scoringBar,
  stage,
  toolbar,
  type StoneState,
} from './helpers';

const SHOTS = 'docs/screenshots/m3';
const PHONE = { width: 390, height: 844 } as const;

/* ---------------------------------------------------------------------------------------------- */
/* Devices and the start screen                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/** A fresh room code per test run, so runs never meet each other's rooms. */
function randomCode(): string {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

interface Device {
  context: BrowserContext;
  page: Page;
}

/**
 * A device: an isolated browser context with the tutorial, the one-time donation prompt and the
 * install hint already seen. `broker: false` blocks the PeerJS broker's WebSocket, so nothing but
 * STUN leaves the machine (the app then classifies the broker as unreachable and offers the manual
 * exchange).
 */
async function device(
  browser: Browser,
  opts: { broker: boolean; viewport?: { width: number; height: number }; noEngine?: boolean },
): Promise<Device> {
  const context = await browser.newContext({ baseURL: BASE_URL, ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('zigo:tutorial-seen', 'true');
      localStorage.setItem('zigo:donation-shown', 'true');
      localStorage.setItem('zigo:install-dismissed', 'true');
    } catch {
      /* storage blocked */
    }
  });
  // A device without the engine's files: it can never compute a proposal of its own.
  if (opts.noEngine) await context.route(/\/engine\//, (route) => route.abort());
  if (!opts.broker) {
    await context.routeWebSocket(/peerjs/, (ws) => ws.close());
    await context.route(/peerjs\.com/, (route) => route.abort());
  }
  const page = await context.newPage();
  return { context, page };
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  const vp = page.viewportSize();
  await page.screenshot({ path: `${SHOTS}/${name}-${vp?.width}x${vp?.height}.png`, animations: 'disabled' });
}

/** Start screen: the opponent selector shows ROOM. */
async function selectRoom(page: Page) {
  const value = page.getByTestId('opponent-selector').getByText('Room', { exact: true });
  const prev = page.getByRole('button', { name: 'Previous opponent' });
  for (let i = 0; i < 16 && !(await value.isVisible()); i++) await prev.click();
  await expect(value).toBeVisible();
}

/**
 * Start screen → opponent ROOM → Start: create or join the room of `code` (DESIGN 9). The address
 * may preset this side's color, the size and the rules (`w`, `n`, `g`); no `t` keeps the clock off.
 */
async function startRoom(page: Page, code: string, preset = '') {
  await page.goto(`./#/?s=${code}${preset}`);
  await expect(stage(page)).toHaveAttribute('data-phase', 'start');
  await selectRoom(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(stage(page)).toHaveAttribute('data-phase', /^(playing|scoring)$/);
}

/**
 * Where a device stands in the room and the manual exchange: the stage's room attributes, the
 * manual sheet's step and any problem it shows. Attached to a failed connection wait, so a stall
 * says which side and which step it stopped at.
 */
async function roomDiagnosis(page: Page): Promise<string> {
  if (page.isClosed()) return '(page closed)';
  return page
    .evaluate(() => {
      const st = document.querySelector('[data-testid="stage"]');
      const attrs = st ? [...st.attributes].filter((a) => a.name.startsWith('data-room')).map((a) => `${a.name}=${a.value}`) : [];
      const sheet = document.querySelector('[data-testid="manual-sheet"]');
      const step = sheet?.querySelector('[data-step]')?.getAttribute('data-step') ?? '(no manual sheet)';
      const alerts = sheet ? [...sheet.querySelectorAll('[role="alert"]')].map((e) => e.textContent?.trim()).filter(Boolean) : [];
      return `${attrs.join(' ')} manual-step=${step}${alerts.length ? ` manual-alert="${alerts.join(' / ')}"` : ''}`;
    })
    .catch((e: unknown) => `(no diagnosis: ${String(e)})`);
}

/** Runs `wait`; when it fails, the error names every device's room state (see `roomDiagnosis`). */
async function diagnosed(devices: Record<string, Page>, wait: () => Promise<void>) {
  try {
    await wait();
  } catch (e) {
    const lines = await Promise.all(Object.entries(devices).map(async ([name, p]) => `  ${name}: ${await roomDiagnosis(p)}`));
    if (e instanceof Error) e.message += `\n\nRoom state at the failure:\n${lines.join('\n')}`;
    throw e;
  }
}

async function expectConnected(...pages: Page[]) {
  const devices = Object.fromEntries(pages.map((p, i) => [pages.length === 2 ? ['host', 'guest'][i] : `device ${i}`, p]));
  await diagnosed(devices, async () => {
    for (const p of pages) await expect(stage(p)).toHaveAttribute('data-room-presence', 'connected', { timeout: 30_000 });
  });
}

/* ---------------------------------------------------------------------------------------------- */
/* The manual exchange (DESIGN 9: the link fallback)                                                */
/* ---------------------------------------------------------------------------------------------- */

/** The read-only link field of a sheet. */
async function linkIn(sheet: Locator): Promise<string> {
  const field = sheet.getByRole('textbox', { name: 'Invite link' });
  await expect(field).toHaveValue(/#\/\?s=/, { timeout: 15_000 });
  return field.inputValue();
}

/** Host: `Connect manually` (from the invite sheet, opened by itself or through the presence dot); returns the offer link. */
async function hostOffer(host: Page): Promise<string> {
  const invite = host.getByTestId('invite-sheet');
  // The creator's invite sheet opens by itself; otherwise the presence dot opens it.
  if (!(await invite.isVisible())) await host.getByRole('button', { name: /Show invite$/ }).click({ timeout: 15_000 });
  await expect(invite).toBeVisible();
  // The broker is blocked: the app classifies it as unreachable and offers the manual exchange.
  const connect = invite.getByRole('button', { name: 'Connect manually' });
  await expect(connect).toBeVisible({ timeout: 20_000 });
  await expect(host.getByText('Could not reach the connection service.')).toHaveCount(1);
  await connect.click();
  const sheet = host.getByTestId('manual-sheet');
  await expect(sheet.getByText('Step 1 of 2')).toBeVisible({ timeout: 15_000 });
  const offer = await linkIn(sheet);
  expect(offer).toMatch(/[?&]o=r&x=/);
  return offer;
}

/** Guest: the answer link for an offer link opened in this page. */
async function guestAnswer(guest: Page): Promise<string> {
  const sheet = guest.getByTestId('manual-sheet');
  await expect(sheet.getByText('Send this link back to your opponent')).toBeVisible({ timeout: 15_000 });
  // The guest of a manual exchange is never offered `Connect manually`.
  await expect(guest.getByRole('button', { name: 'Connect manually' })).toHaveCount(0);
  const answer = await linkIn(sheet);
  expect(answer).toMatch(/&y=/);
  return answer;
}

/** Host: pastes the answer link into the waiting sheet. */
async function hostPaste(host: Page, answer: string) {
  const sheet = host.getByTestId('manual-sheet');
  await sheet.getByRole('textbox', { name: 'Answer link' }).fill(answer);
  await sheet.getByRole('button', { name: 'Connect', exact: true }).click();
}

/** Opens a link in a page that already runs the app, as a same-document hash change (no reload). */
async function openInPlace(page: Page, link: string) {
  await page.evaluate((url) => {
    window.location.hash = new URL(url).hash;
  }, link);
}

/** The whole manual exchange: host offer → guest → answer → host paste → connected. */
async function connectManually(host: Page, guest: Page, opts: { guestInPlace?: boolean } = {}) {
  const offer = await hostOffer(host);
  if (opts.guestInPlace) await openInPlace(guest, offer);
  else await guest.goto(offer);
  let answer = '';
  await diagnosed({ host, guest }, async () => {
    answer = await guestAnswer(guest);
  });
  await hostPaste(host, answer);
  await expectConnected(host, guest);
  await expect(stage(host)).toHaveAttribute('data-room-via', 'manual');
  await expect(stage(guest)).toHaveAttribute('data-room-via', 'manual');
  // The transient `x` / `y` left the address bar.
  expect(guest.url()).not.toMatch(/[?&][xy]=/);
}

/** Host creates the room (Black unless `preset` says otherwise) with the broker blocked; both devices connect manually. */
async function manualRoom(
  browser: Browser,
  code: string,
  preset = '&w=B&n=9',
  viewport?: { width: number; height: number },
  guestOpts: { noEngine?: boolean } = {},
): Promise<{ host: Device; guest: Device }> {
  const host = await device(browser, { broker: false, viewport });
  const guest = await device(browser, { broker: false, viewport, ...guestOpts });
  await startRoom(host.page, code, preset);
  await expect(stage(host.page)).toHaveAttribute('data-room-cause', 'broker-unreachable', { timeout: 20_000 });
  await connectManually(host.page, guest.page);
  return { host, guest };
}

/* ---------------------------------------------------------------------------------------------- */
/* Board, scoring and requests                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** A point's state, waiting for it (a remote move takes a moment). */
async function seePoint(page: Page, gtp: string, state: StoneState, timeout = 15_000) {
  await expect(cell(page, gtp)).toHaveAccessibleName(new RegExp(`^${state}, ${gtp}(,|$)`), { timeout });
}

/** `mover` places the next stone at `gtp`; both devices show it. */
async function playAndSee(mover: Page, watcher: Page, gtp: string, state: 'black stone' | 'white stone') {
  await cell(mover, gtp).click();
  await seePoint(mover, gtp, state);
  await seePoint(watcher, gtp, state);
}

/** Alternating moves, Black first by default; `black` / `white` are the devices of each color. */
async function playLine(black: Page, white: Page, moves: readonly string[], first: 'B' | 'W' = 'B') {
  let isBlack = first === 'B';
  for (const m of moves) {
    if (isBlack) await playAndSee(black, white, m, 'black stone');
    else await playAndSee(white, black, m, 'white stone');
    isBlack = !isBlack;
  }
}

/** Taps the flag (a pass in a room); the opponent sees the `passed` badge or the scoring phase. */
async function passAndSee(mover: Page, watcher: Page) {
  await expect(flag(mover)).toBeEnabled({ timeout: 15_000 });
  await flag(mover).click();
  await expect(passedBadge(watcher).or(scoringBar(watcher))).toBeVisible({ timeout: 15_000 });
}

/** Holds a toolbar button (resign: 500 ms, DESIGN 8.3). */
async function hold(page: Page, button: Locator, ms = 900) {
  const box = await button.boundingBox();
  if (!box) throw new Error('button not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const incoming = (page: Page, text: string) => page.getByRole('alertdialog', { name: text });
const acceptButton = (page: Page) => scoringBar(page).getByRole('button', { name: /^Accept/ });
const resumeButton = (page: Page) => scoringBar(page).getByRole('button', { name: 'Resume', exact: true });

/** The dead stones shown on a board, as sorted SGF points. */
async function deadSet(page: Page): Promise<string[]> {
  const points = await page.locator('[data-mark="dead"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-point') ?? ''));
  return points.sort();
}

/**
 * Both devices are in scoring and the first proposal has arrived (rev ≥ 1: Accept is no longer
 * locked behind `Finding dead stones…`); both boards show the same marks. Returns them.
 */
async function proposalOnBoth(a: Page, b: Page): Promise<string[]> {
  for (const p of [a, b]) {
    await expect(stage(p)).toHaveAttribute('data-phase', 'scoring', { timeout: 15_000 });
    await expect(scoringBar(p)).toBeVisible();
    // The engine may need to load on seat 0 first (the proposal's own timeout is 20 s).
    await expect(acceptButton(p)).toBeEnabled({ timeout: 45_000 });
    await expect(p.getByText('Finding dead stones…')).toHaveCount(0);
  }
  await expect.poll(async () => JSON.stringify(await deadSet(b)), { timeout: 10_000 }).toBe(JSON.stringify(await deadSet(a)));
  return deadSet(a);
}

const isDead = async (page: Page, gtp: string) => /\bdead\b/.test((await cell(page, gtp).getAttribute('aria-label')) ?? '');

/** The game-over overlay of each device: the titles mirror each other, the count lines are identical. */
async function sameResult(a: Page, b: Page): Promise<{ winner: Page; loser: Page; margin: string }> {
  await expect(gameOver(a)).toBeVisible({ timeout: 45_000 });
  await expect(gameOver(b)).toBeVisible({ timeout: 45_000 });
  const ta = ((await gameOver(a).locator('h2').textContent()) ?? '').trim();
  const tb = ((await gameOver(b).locator('h2').textContent()) ?? '').trim();
  const won = /^You won by (\d+(?:\.5)?)!$/;
  const lost = /^Lost by (\d+(?:\.5)?)$/;
  const aWon = won.test(ta);
  const [winner, loser, wt, lt] = aWon ? [a, b, ta, tb] : [b, a, tb, ta];
  expect(wt, `titles: "${ta}" / "${tb}"`).toMatch(won);
  expect(lt, `titles: "${ta}" / "${tb}"`).toMatch(lost);
  const margin = won.exec(wt)![1];
  expect(lost.exec(lt)![1]).toBe(margin);
  // Both devices count from the same shared dead set (DESIGN 9.5).
  const ca = await gameOver(a).locator('[data-part="count"]').textContent();
  const cb = await gameOver(b).locator('[data-part="count"]').textContent();
  expect(ca).toBeTruthy();
  expect(cb).toBe(ca);
  return { winner, loser, margin };
}

/** The info pill's score cell (this device's points first). */
async function expectScore(page: Page, score: string) {
  await expect(info(page)).toContainText(score, { timeout: 15_000 });
}

/* ---------------------------------------------------------------------------------------------- */
/* Positions                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/*
 * The manual path's 9×9 game (territory, komi 6.5). Black walls column D, White column E. White
 * throws a stone in at B5 inside Black's side (dead). In the corner White's A1 is captured by
 * Black's A2 and B1 (one prisoner). White's last stone, G5, sits in its own side.
 */
const WALLS = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((r) => [`D${r}`, `E${r}`]);
const MANUAL_GAME = [...WALLS, 'C5', 'B5', 'A2', 'A1', 'B1', 'G5'];

/* ---------------------------------------------------------------------------------------------- */
/* Scenarios                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

test.describe('Gate 3 · rooms', () => {
  // Each room test runs alone: Playwright's built-in `-exclusive-` lock starts it only when no
  // other test is running, and no other test starts until it ends. Each of these tests drives two
  // complete app instances over real WebRTC (non-trickle ICE with mDNS host candidates and STUN),
  // and seat 0 runs the engine. Run side by side with each other and with m1/m2's engine games
  // (`npm run e2e`, fullyParallel), the manual exchange stalled at the gate: the guest's answer
  // came too late, or the host stayed `connecting` after the paste until its 20 s connect timer
  // gave up. Run one at a time (`--workers=1`) every room test passed. The lock gives the room
  // tests that condition inside the normal parallel run; the other suites stay parallel, and the
  // room tests' own waits and assertions are unchanged.
  test.describe.configure({ timeout: 240_000, lock: '-exclusive-' });

  test('manual path: offer, answer, stones with a capture, takeback, both pass, the host proposal, a toggle, both accept, rematch and score', async ({
    browser,
  }) => {
    const code = randomCode();
    // The host takes Black on a 9×9 board with territory rules; no `t`: the clock is off.
    // The guest's device cannot load the engine: every mark it shows is data from the host (PLAN 7).
    const { host, guest } = await manualRoom(browser, code, '&w=B&n=9&g=t', PHONE, { noEngine: true });
    const h = host.page;
    const g = guest.page;

    // Both see the creator's settings: 9×9, territory (komi 6.5), untimed (time used, not a clock).
    for (const p of [h, g]) {
      await expect(stage(p)).toHaveAttribute('data-size', '9');
      await expect(p.getByRole('grid').getByRole('gridcell')).toHaveCount(81);
      await expect(p.getByText('Komi 6.5', { exact: true }).first()).toBeAttached();
      await expect(p.locator('[data-color="B"] [role="timer"]').first()).toHaveAttribute('aria-label', /time used/);
      // The room address carries the code only, never moves (DESIGN 13.2).
      expect(new URL(p.url()).hash).toBe(`#/?s=${code}&p=1&o=r`);
      await expectScore(p, '0 – 0');
    }
    // Seats: the host created the room (seat 0), the guest joined (seat 1).
    await expect(stage(h)).toHaveAttribute('data-room-seat', '0');
    await expect(stage(g)).toHaveAttribute('data-room-seat', '1');
    await shot(h, 'connected-host');
    await shot(g, 'connected-guest');

    // Stones both ways (twelve each), with one capture: Black's B1 takes White's A1.
    await playLine(h, g, MANUAL_GAME.slice(0, -2));
    await playAndSee(h, g, 'B1', 'black stone');
    for (const p of [h, g]) await seePoint(p, 'A1', 'empty');
    await playAndSee(g, h, 'G5', 'white stone');
    await shot(g, 'capture-guest');

    // Takeback: the guest asks for G5 back (the undo slot), the host accepts the toast (DESIGN 9.4).
    await toolbar(g).getByRole('button', { name: 'Ask for a takeback' }).click();
    await expect(toolbar(g).getByRole('button', { name: 'Takeback requested' })).toBeVisible();
    const takeback = incoming(h, 'Your opponent asks for a takeback');
    await expect(takeback).toBeVisible({ timeout: 15_000 });
    await shot(h, 'takeback-toast-host');
    await takeback.getByRole('button', { name: 'Accept' }).click();
    for (const p of [h, g]) {
      await seePoint(p, 'G5', 'empty');
      await seePoint(p, 'B1', 'black stone');
    }
    await expect(toolbar(g).getByRole('button', { name: 'Ask for a takeback' })).toBeVisible();
    await playAndSee(g, h, 'G5', 'white stone');

    // Both pass: scoring opens on both devices with seat 0's proposal.
    await passAndSee(h, g);
    await expect(flag(g)).toHaveAccessibleName(/^Pass and end the game/);
    await passAndSee(g, h);
    const proposal = await proposalOnBoth(h, g);
    test.info().annotations.push({ type: 'proposal', description: `seat 0 proposed dead: [${proposal.join(', ')}]` });
    // The guest never had an engine of its own; its marks are the host's proposal, received as data.
    await expect(stage(g)).not.toHaveAttribute('data-engine', 'ready');
    await shot(h, 'scoring-host');
    await shot(g, 'scoring-guest');

    // The host accepts first; the guest is told.
    await acceptButton(h).click();
    await expect(acceptButton(h)).toHaveAttribute('aria-pressed', 'true');
    await expect(h.getByText('Waiting for your opponent to accept')).toBeVisible();
    await expect(g.getByText('Your opponent accepted this count')).toBeVisible({ timeout: 15_000 });
    await shot(g, 'they-accepted-guest');

    // The guest toggles the group at B5: it changes on both boards, and both acceptances clear.
    const b5Dead = await isDead(g, 'B5');
    await cell(g, 'B5').click();
    for (const p of [h, g]) {
      await expect(cell(p, 'B5')).toHaveAccessibleName(b5Dead ? /^white stone, B5(?!.*\bdead\b)/ : /^white stone, B5.*\bdead\b/, { timeout: 15_000 });
    }
    await expect(acceptButton(h)).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    await expect(h.getByText('Waiting for your opponent to accept')).toHaveCount(0);
    await expect(g.getByText('Your opponent accepted this count')).toHaveCount(0);
    await expect(acceptButton(g)).toHaveAttribute('aria-pressed', 'false');
    await shot(h, 'toggled-host');
    expect(await deadSet(g)).toEqual(await deadSet(h));

    // The host toggles B5 back: both boards show the proposal's marking again.
    await cell(h, 'B5').click();
    for (const p of [h, g]) {
      await expect(cell(p, 'B5')).toHaveAccessibleName(b5Dead ? /^white stone, B5.*\bdead\b/ : /^white stone, B5(?!.*\bdead\b)/, { timeout: 15_000 });
    }
    await expect.poll(async () => JSON.stringify(await deadSet(g)), { timeout: 10_000 }).toBe(JSON.stringify(proposal));
    expect(await deadSet(h)).toEqual(proposal);

    // Both accept the same marking (the guest first this time): the game ends with the same result.
    await acceptButton(g).click();
    await expect(h.getByText('Your opponent accepted this count')).toBeVisible({ timeout: 15_000 });
    const agreed = await deadSet(h);
    expect(await deadSet(g)).toEqual(agreed);
    await acceptButton(h).click();
    const { winner, loser } = await sameResult(h, g);
    await shot(h, 'over-host');
    await shot(g, 'over-guest');
    await expectScore(winner, '1 – 0');
    await expectScore(loser, '0 – 1');

    // Rematch from the host's overlay, accepted on the guest's toast: colors swap (DESIGN 9.4).
    await gameOver(h).getByRole('button', { name: 'Rematch' }).click();
    const rematch = incoming(g, 'Your opponent wants a rematch');
    await expect(rematch).toBeVisible({ timeout: 15_000 });
    await expect(gameOver(h).getByText('Waiting for your opponent', { exact: true })).toBeVisible();
    await shot(h, 'rematch-pending-host');
    await rematch.getByRole('button', { name: 'Accept' }).click();
    await expect(gameOver(h)).toHaveCount(0, { timeout: 15_000 });
    await expect(gameOver(g)).toHaveCount(0, { timeout: 15_000 });
    for (const p of [h, g]) {
      await expect(stage(p)).toHaveAttribute('data-phase', 'playing');
      await seePoint(p, 'D5', 'empty');
    }
    // Game 2: the guest plays Black now and moves first; the host plays White.
    await playAndSee(g, h, 'E5', 'black stone');
    await playAndSee(h, g, 'C3', 'white stone');

    // Score from each side's point of view: the game-1 winner leads 1 – 0.
    await expectScore(winner, '1 – 0');
    await expectScore(loser, '0 – 1');
    await shot(h, 'game2-host');
    await shot(g, 'game2-guest');

    await host.context.close();
    await guest.context.close();
  });

  test('resume: after both pass the guest resumes, play continues, and the next two passes end the game at once from seat 0', async ({ browser }) => {
    const code = randomCode();
    const { host, guest } = await manualRoom(browser, code, '&w=B&n=9');
    const h = host.page;
    const g = guest.page;

    await playLine(h, g, ['C3', 'G7', 'C7', 'G3']);
    await passAndSee(h, g);
    await passAndSee(g, h);
    await proposalOnBoth(h, g);

    // The guest presses Resume: scoring is dropped on both devices and Black (the host) plays on.
    await resumeButton(g).click();
    for (const p of [h, g]) {
      await expect(stage(p)).toHaveAttribute('data-phase', 'playing', { timeout: 15_000 });
      await expect(scoringBar(p)).toHaveCount(0);
    }
    await playLine(h, g, ['E5', 'E4']);

    // Two more passes (the guest's is the second): round 2 is scored at once from seat 0's
    // proposal, without a marking round, and both devices show the same result.
    await passAndSee(h, g);
    await expect(flag(g)).toHaveAccessibleName(/^Pass and end the game/);
    await flag(g).click();
    await sameResult(h, g);
    for (const p of [h, g]) await expect(scoringBar(p)).toHaveCount(0);
    expect(await deadSet(g)).toEqual(await deadSet(h));

    await host.context.close();
    await guest.context.close();
  });

  test('recovery: the guest loses its storage during scoring, starts the same code, the host allows the rejoin, the marks are restored', async ({
    browser,
  }) => {
    const code = randomCode();
    const { host, guest } = await manualRoom(browser, code, '&w=B&n=9');
    const h = host.page;
    let g = guest.page;

    // Game 1: the host (Black) resigns after one stone, by holding the flag.
    await playAndSee(h, g, 'E5', 'black stone');
    await hold(h, flag(h));
    await expect(gameOver(g)).toBeVisible({ timeout: 15_000 });
    await expect(gameOver(g).locator('h2')).toHaveText('You won by resignation!');
    await expect(gameOver(h).locator('h2')).toHaveText('Resigned', { timeout: 15_000 });
    await gameOver(g).getByRole('button', { name: 'Rematch' }).click();
    const rematch = incoming(h, 'Your opponent wants a rematch');
    await expect(rematch).toBeVisible({ timeout: 15_000 });
    await rematch.getByRole('button', { name: 'Accept' }).click();

    // Game 2: the guest plays Black now. A few stones, both pass, scoring with seat 0's proposal.
    await expect(gameOver(g)).toHaveCount(0, { timeout: 15_000 });
    await playLine(g, h, ['C3', 'G7', 'C7', 'G3']);
    await passAndSee(g, h);
    await passAndSee(h, g);
    await proposalOnBoth(h, g);

    // The guest toggles White's G7 group: a marking that differs from the proposal (rev 2).
    const g7Dead = await isDead(g, 'G7');
    await cell(g, 'G7').click();
    const toggled = g7Dead ? /^white stone, G7(?!.*\bdead\b)/ : /^white stone, G7.*\bdead\b/;
    for (const p of [h, g]) await expect(cell(p, 'G7')).toHaveAccessibleName(toggled, { timeout: 15_000 });
    const marks = await deadSet(h);
    expect(await deadSet(g)).toEqual(marks);

    // The guest's storage is cleared and the page reloaded (a lost device).
    await g.close();
    g = await guest.context.newPage();
    await g.goto(`./#/?s=${code}`);
    await g.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('zigo:tutorial-seen', 'true');
    });
    await g.reload();
    await expect(stage(g)).toHaveAttribute('data-phase', 'start');
    expect(await g.evaluate(() => localStorage.getItem('zigo:rooms'))).toBeNull();

    // The guest starts the same code with ROOM (it has no record now).
    await startRoom(g, code);

    // The host lost its manual channel; a new manual exchange connects the two again.
    await expect(stage(h)).not.toHaveAttribute('data-room-presence', 'connected', { timeout: 30_000 });
    const offer = await hostOffer(h);
    await openInPlace(g, offer);
    const answer = await guestAnswer(g);
    await hostPaste(h, answer);

    // The host's room is locked and the guest has no key: one Allow toast.
    const rejoin = incoming(h, 'Opponent is rejoining from a new device');
    await expect(rejoin).toBeVisible({ timeout: 30_000 });
    await rejoin.getByRole('button', { name: 'Allow' }).click();
    await expectConnected(h, g);

    // The guest is restored in scoring with the same marks, the same seat and the score of game 1.
    await expect(stage(g)).toHaveAttribute('data-phase', 'scoring', { timeout: 15_000 });
    await expect(stage(g)).toHaveAttribute('data-room-seat', '1');
    await expect(cell(g, 'G7')).toHaveAccessibleName(toggled, { timeout: 15_000 });
    await expect.poll(async () => JSON.stringify(await deadSet(g)), { timeout: 10_000 }).toBe(JSON.stringify(marks));
    await expectScore(g, '1 – 0');
    await expectScore(h, '0 – 1');

    // Scoring goes on: both accept the restored marking, the result matches.
    await expect(acceptButton(g)).toBeEnabled({ timeout: 15_000 });
    await acceptButton(g).click();
    await expect(h.getByText('Your opponent accepted this count')).toBeVisible({ timeout: 15_000 });
    await acceptButton(h).click();
    await sameResult(h, g);

    // The earlier game is in the restored guest's history.
    await g.keyboard.press('Escape');
    await expect(gameOver(g)).toHaveCount(0);
    await g.getByRole('button', { name: 'Back to start' }).click();
    await expect(stage(g)).toHaveAttribute('data-phase', 'start');
    await g.mouse.move(10, 10);
    await g.mouse.wheel(0, 900);
    await expect(g.getByRole('heading', { name: 'Previous games' })).toBeVisible();
    const cards = historyCard(g, code);
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Game 1' })).toContainText('Won');

    await host.context.close();
    await guest.context.close();
  });

  test('offline pass: the guest is away, the host passes, the pass arrives when the guest is back', async ({ browser }) => {
    const code = randomCode();
    const { host, guest } = await manualRoom(browser, code, '&w=B&n=9');
    const h = host.page;
    let g = guest.page;
    // Untimed room: the strips show time used, not a clock.
    await expect(h.locator('[data-color="B"] [role="timer"]').first()).toHaveAttribute('aria-label', /time used/);
    await playLine(h, g, ['C3', 'G7']);

    // The guest closes the app.
    await g.close();
    await expect(stage(h)).not.toHaveAttribute('data-room-presence', 'connected', { timeout: 30_000 });

    // The host passes while the opponent is away (DESIGN 9.3): stored and shown normally.
    await expect(flag(h)).toBeEnabled();
    await flag(h).click();
    await expect(passedBadge(h)).toBeVisible();
    await expect(stage(h)).toHaveAttribute('data-phase', 'playing');

    // The guest comes back to the room: its stored game does not have the pass yet.
    g = await guest.context.newPage();
    await g.goto(`./#/?s=${code}&p=1&o=r`);
    await expect(stage(g)).toHaveAttribute('data-phase', 'playing');
    await seePoint(g, 'G7', 'white stone');
    await expect(passedBadge(g)).toHaveCount(0);

    // On reconnect the pass arrives: the guest is to move and its pass would end the game.
    await connectManually(h, g, { guestInPlace: true });
    await expect(passedBadge(g)).toBeVisible({ timeout: 15_000 });
    await expect(flag(g)).toBeEnabled();
    await expect(flag(g)).toHaveAccessibleName(/^Pass and end the game/);
    await playAndSee(g, h, 'C7', 'white stone');
    await expect(stage(g)).toHaveAttribute('data-phase', 'playing');

    await host.context.close();
    await guest.context.close();
  });

  test('BroadcastChannel hand-over: the answer link opened in a second tab connects the waiting tab', async ({ browser }) => {
    const code = randomCode();
    const host = await device(browser, { broker: false });
    const guest = await device(browser, { broker: false });
    await startRoom(host.page, code, '&w=B&n=9');
    await expect(stage(host.page)).toHaveAttribute('data-room-cause', 'broker-unreachable', { timeout: 20_000 });
    const offer = await hostOffer(host.page);
    await guest.page.goto(offer);
    const answer = await guestAnswer(guest.page);

    // The host opens the answer link on its own device: a new tab of the same context.
    const tab = await host.context.newPage();
    await tab.goto(answer);
    const sheet = tab.getByTestId('manual-sheet');
    await expect(sheet.getByText('Done. Go back to the tab with your game.')).toBeVisible({ timeout: 15_000 });
    // The passing tab stays passive: it never connects itself.
    await expect(stage(tab)).toHaveAttribute('data-room-tab', 'handover');

    await expectConnected(host.page, guest.page);
    await playAndSee(host.page, guest.page, 'E5', 'black stone');

    await host.context.close();
    await guest.context.close();
  });

  test('broker path (best effort): the same join through the public PeerJS broker', async ({ browser }) => {
    const code = randomCode();
    const host = await device(browser, { broker: true });
    const guest = await device(browser, { broker: true });
    const h = host.page;
    const g = guest.page;
    await startRoom(h, code, '&w=B&n=9');
    // The invite link: `?s=CODE&o=r` opens the room at once.
    const inviteLink = await linkIn(h.getByTestId('invite-sheet'));
    expect(new URL(inviteLink).hash).toBe(`#/?s=${code}&o=r`);
    await g.goto(inviteLink);

    // Either both devices connect through the broker, or the app says the broker is unreachable.
    const brokerDown = async (p: Page) =>
      (await stage(p).getAttribute('data-room-cause')) === 'broker-unreachable' ||
      (await stage(p).getAttribute('data-room-failure')) === 'broker-unreachable';
    const outcome = async () => {
      const connected =
        (await stage(h).getAttribute('data-room-presence')) === 'connected' &&
        (await stage(g).getAttribute('data-room-presence')) === 'connected';
      if (connected) return 'connected';
      if ((await brokerDown(h)) || (await brokerDown(g))) return 'broker-unreachable';
      return 'pending';
    };
    await expect.poll(outcome, { timeout: 60_000, intervals: [500] }).not.toBe('pending');
    const result = await outcome();
    // Best effort only (PLAN Gate 3): the public broker is a third party this suite cannot control.
    test.fixme(
      result === 'broker-unreachable',
      'Not verified: the public PeerJS broker (0.peerjs.com) is unreachable or rate-limited from this machine (app failure class broker-unreachable).',
    );

    await expect(stage(h)).toHaveAttribute('data-room-via', 'broker');
    await expect(stage(g)).toHaveAttribute('data-room-via', 'broker');
    await playAndSee(h, g, 'E5', 'black stone');
    await playAndSee(g, h, 'C3', 'white stone');
    await expectScore(h, '0 – 0');

    await host.context.close();
    await guest.context.close();
  });
});
