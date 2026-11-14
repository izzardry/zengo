#!/usr/bin/env node
/**
 * Screenshots for the gates and the visual pass (PLAN.md section 5: Gate 1, final phase step 4).
 *
 *   node scripts/screenshots.mjs <baseURL> <outDir> [--only start,game-9,…] [--sizes 390x844,…] [--themes light,dark]
 *
 * Runs against an already running `vite preview` (for example `npx vite preview --port 4180
 * --strictPort` after `npm run build`; baseURL `http://localhost:4180/`). Writes
 * `<screen>-<theme>-<width>x<height>.png` into `outDir`.
 *
 * Screens, each in a fresh browser context with its own seeded localStorage (the app's own
 * `zengo:` storage format, see src/lib/storage.ts and src/lib/types.ts `SavedGame` / `Room`):
 *
 *   start        idle start screen, with history below the fold
 *   dial         start screen with the custom clock dial held open on the clock pill
 *   game-9       a timed 9×9 pass-and-play game in progress (one capture on each side)
 *   game-13      a 13×13 pass-and-play game in progress
 *   game-19      a 19×19 pass-and-play game in progress
 *   toast        the 9×9 game right after Share copied the link (a sonner toast)
 *   scoring      a 9×9 pass-and-play game in scoring, one dead stone marked
 *   review       a finished 13×13 computer game in review, three plies back from the end
 *   overlay      pass-and-play game-over overlay (the scoring game accepted in the session)
 *   overlay-win  computer game won by count in the session: success tint and overlay
 *   invite       a new room's invite sheet (PeerJS broker blocked, nothing leaves the machine)
 *   history      the history section with several games (scrolled to its heading)
 *   history-end  the same page scrolled to the bottom (more-games button, credits, footer)
 *
 * Sizes: 320×568, 390×844, 844×390 (landscape phone), 1280×800, 2560×1440. The three phone sizes
 * run as touch devices (isMobile, hasTouch, deviceScaleFactor 2), the two desktop sizes with a
 * mouse at scale 1. Dark mode is the system preference (`colorScheme`), which the app follows.
 *
 * Only the app's own origin is contacted: the PeerJS broker WebSocket and HTTP are blocked in every
 * context. Math.random is seeded per context; codes drawn from crypto.getRandomValues still vary.
 * The prepared games are encoded and checked with the app's own rules core (src/lib/zengo.ts,
 * imported with Node's type stripping), so a bad move fails here and not in the screenshot.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const zengo = await import(pathToFileURL(join(root, 'src/lib/zengo.ts')).href);

/* ---------------------------------------------------------------------------------------------- */
/* Arguments                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const [, , baseArg, outArg] = process.argv;
if (!baseArg || !outArg || baseArg.startsWith('--')) {
  console.error('usage: node scripts/screenshots.mjs <baseURL> <outDir> [--only a,b] [--sizes WxH,…] [--themes light,dark]');
  process.exit(2);
}
const BASE = baseArg.endsWith('/') ? baseArg : `${baseArg}/`;
const OUT = resolve(outArg);

function listArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const ALL_SIZES = [
  { width: 320, height: 568, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 1280, height: 800, touch: false },
  { width: 2560, height: 1440, touch: false },
];
const sizeFilter = listArg('sizes');
const SIZES = sizeFilter ? ALL_SIZES.filter((s) => sizeFilter.includes(`${s.width}x${s.height}`)) : ALL_SIZES;
const THEMES = listArg('themes') ?? ['light', 'dark'];

/* ---------------------------------------------------------------------------------------------- */
/* Prepared games in the app's storage format                                                       */
/* ---------------------------------------------------------------------------------------------- */

/**
 * GTP moves (`D4`, `pass`) → `moves` (DESIGN 13.2: two SGF letters per ply, `tt` = pass),
 * replayed by the rules core so an illegal move throws here.
 */
function encode(gtps, size, handicap = 0, rules = 'area') {
  const moves = gtps
    .map((m) => {
      const p = zengo.fromGtp(m, size);
      if (!p) throw new Error(`Bad GTP move ${m} on ${size}×${size}`);
      return p;
    })
    .join('');
  const g = zengo.fromRecord({ size, rules, handicap, moves });
  return { moves, plies: g.cursor };
}

/** SGF points of GTP coordinates (dead stones). */
const points = (gtps, size) => gtps.map((m) => zengo.fromGtp(m, size)).sort();

/** Plausible per-ply thinking times (ms), deterministic. */
const msFor = (n, base = 4000) => Array.from({ length: n }, (_, i) => base + ((i * 7919) % 9000));

/** 9×9 in progress: Black captures E5, White captures H8. */
const CAPTURES9 = ['D5', 'E5', 'F5', 'C3', 'E4', 'G7', 'E6', 'G8', 'H8', 'J8', 'C7', 'H9', 'D3', 'H7', 'C4', 'F3', 'D7', 'G5'];

/**
 * 9×9 to the end: a black wall on E, a white wall on F, a white invader at B5 that dies.
 * Area: Black 35 + 10 = 45, White 27 + 9 + 7.5 = 43.5, Black wins by 1.5 with B5 dead.
 */
const WALLS9 = [
  'E5', 'F5', 'E4', 'F4', 'E6', 'F6', 'E3', 'F3', 'E7', 'F7', 'E2', 'F2', 'E8', 'F8', 'E1', 'F1', 'E9', 'B5', 'C5', 'F9',
  'pass', 'pass',
];
const WALLS9_DEAD = points(['B5'], 9);

/** 13×13 opening. */
const OPENING13 = ['K10', 'D4', 'K4', 'D10', 'J3', 'C6', 'G3', 'F11', 'K7', 'D7', 'L9', 'H10', 'C10', 'J11', 'G10', 'G11'];

/** 13×13 with three handicap stones (D4, K10, D10): White moves first. */
const HANDICAP13 = ['K4', 'C6', 'J3', 'F3', 'C9', 'K7', 'L5', 'G4'];

/** 19×19 opening. */
const OPENING19 = [
  'Q16', 'D4', 'Q4', 'D16', 'R10', 'C10', 'F17', 'C14', 'F3', 'C6', 'K4', 'O17', 'R14', 'K16', 'N3', 'H17', 'P10', 'K10',
  'J3', 'E10', 'O16', 'P17', 'L17', 'L16',
];

/**
 * One SavedGame (DESIGN 12.1). `ago` is minutes before page load (resolved in the page, so
 * relative times read naturally); `extra` overrides fields (`size`, `handicap`, `rules` first).
 */
function game(id, mode, gtps, extra = {}) {
  const size = extra.size ?? 9;
  const handicap = extra.handicap ?? 0;
  const rules = extra.rules ?? 'area';
  const e = encode(gtps, size, handicap, rules);
  return {
    id,
    code: id.split('.')[0],
    mode,
    color: 'B',
    size,
    rules,
    handicap,
    tc: null,
    moves: e.moves,
    ms: msFor(e.plies),
    assisted: false,
    ago: 5,
    ...extra,
  };
}

const SCORING = { round: 1, rev: 1, dead: WALLS9_DEAD, accepted: [0, 0] };
const B_BY_1_5 = { winner: 'B', by: 'score', margin: 3 };

/** Games for the history screen: every card kind (DESIGN 12.2). More than five, so `N more games` shows. */
const HISTORY_GAMES = [
  game('K7QW2M', 'local', CAPTURES9, { tc: '5+7', ago: 3 }),
  game('R00M42.2', 'room', OPENING19, { size: 19, color: 'W', tc: '20m5x30', room: { n: 2, epoch: 0 }, ago: 20 }),
  game('R00M42.1', 'room', WALLS9, { color: 'B', room: { n: 1, epoch: 0 }, scoring: { ...SCORING, accepted: [1, 1] }, result: B_BY_1_5, ago: 60 }),
  game('C4FE88', 'computer', WALLS9, { level: 3, assisted: true, scoring: SCORING, ago: 180 }),
  game('LOST12', 'computer', OPENING13, { size: 13, level: 8, color: 'B', tc: '10+5', result: { winner: 'W', by: 'resign' }, ago: 60 * 26 }),
  game('TERR77', 'local', WALLS9, { rules: 'territory', scoring: { ...SCORING, accepted: [1, 1] }, result: { winner: 'B', by: 'score', margin: 5 }, ago: 60 * 24 * 3 }),
  game('TIME01', 'computer', OPENING19.slice(0, 12), { size: 19, level: 12, color: 'W', tc: '5+7', result: { winner: 'W', by: 'time' }, ago: 60 * 24 * 9 }),
  game('HANDI3', 'computer', HANDICAP13, { size: 13, handicap: 3, level: 5, ago: 60 * 24 * 40 }),
];

const HISTORY_ROOMS = [
  {
    code: 'R00M42',
    key: 'q2Zt8vXcR1mK0aBdE3fGhw',
    seat: 0,
    createdAt: -90, // minutes ago, resolved in the page
    lastSeenAt: -20,
    score: [2, 0], // seat 0 (Black) won game 1 by 1.5
    games: ['R00M42.1', 'R00M42.2'],
  },
];

const PREFS = {
  'tutorial-seen': true,
  'donation-shown': true,
  'install-dismissed': true,
  lang: 'en',
};

/* ---------------------------------------------------------------------------------------------- */
/* Browser helpers                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

/** A fresh context: seeded storage (once per context), seeded Math.random, broker blocked. */
async function newContext(browser, size, theme, seed) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.touch ? 2 : 1,
    isMobile: size.touch,
    hasTouch: size.touch,
    colorScheme: theme,
    locale: 'en-US',
    baseURL: BASE,
  });
  await context.addInitScript((data) => {
    // Seeded Math.random (mulberry32), so anything drawn from it repeats between runs.
    let a = 0x5eed;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // The native share sheet cannot be driven; Share falls back to the clipboard.
    try {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
    } catch {
      /* ignore */
    }
    try {
      if (sessionStorage.getItem('shots:seeded')) return;
      sessionStorage.setItem('shots:seeded', '1');
      const now = Date.now();
      const min = 60_000;
      for (const [k, v] of Object.entries(data.prefs)) localStorage.setItem(`zengo:${k}`, JSON.stringify(v));
      if (data.games.length) {
        const games = data.games.map(({ ago, ...g }) => ({
          ...g,
          createdAt: now - (ago + 30) * min,
          lastPlayedAt: now - ago * min,
        }));
        localStorage.setItem('zengo:games', JSON.stringify(games));
      }
      if (data.rooms.length) {
        const rooms = data.rooms.map((r) => ({ ...r, createdAt: now + r.createdAt * min, lastSeenAt: now + r.lastSeenAt * min }));
        localStorage.setItem('zengo:rooms', JSON.stringify(rooms));
      }
    } catch {
      /* storage blocked */
    }
  }, { prefs: { ...PREFS, ...(seed.prefs ?? {}) }, games: seed.games ?? [], rooms: seed.rooms ?? [] });
  await context.routeWebSocket(/peerjs/, (ws) => ws.close());
  await context.route(/peerjs\.com/, (route) => route.abort());
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  return context;
}

/**
 * The scoring bar's Accept buttons (`data-action="accept"`, see ScoringBar.tsx): face to face in
 * pass-and-play each side has its own, named "Accept the count for Black" and so on (DESIGN 8.4),
 * so they are found by their data attribute and not by an accessible name starting with "Accept".
 */
function acceptButtons(page) {
  return page.locator('button[data-action="accept"]:visible');
}

/** Clicks every visible Accept that has not been pressed yet, one at a time (the bar re-renders). */
async function acceptAll(page) {
  const open = page.locator('button[data-action="accept"][data-accepted="false"]:visible');
  await acceptButtons(page).first().waitFor({ state: 'visible', timeout: 15_000 });
  for (let i = 0; i < 4 && (await open.count()) > 0; i++) {
    await open.first().click();
    await page.waitForTimeout(150);
  }
}

async function settle(page, ms = 700) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

/** Opens a stored game by its code from the start screen (Resume / Review pill). */
async function openStored(page, code, label) {
  await page.goto(`./#/?s=${code}`);
  const pill = page.getByRole('button', { name: label, exact: true });
  await pill.waitFor({ state: 'visible', timeout: 15_000 });
  await pill.click();
  // A game in scoring shows the scoring bar where the toolbar was (StatusBar.tsx), so either counts.
  await page.getByRole('toolbar').or(acceptButtons(page)).first().waitFor({ state: 'visible', timeout: 30_000 });
}

/* ---------------------------------------------------------------------------------------------- */
/* Screens                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const SCREENS = {
  async start(page) {
    await page.goto('./');
    await page.getByTestId('stage').waitFor();
    await settle(page);
  },

  async dial(page) {
    await page.goto('./');
    const pill = page.getByTestId('clock-pill');
    await pill.waitFor();
    await settle(page, 300);
    const box = await pill.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    return async () => {
      await page.mouse.up().catch(() => {});
    };
  },

  async 'game-9'(page) {
    await openStored(page, 'K7QW2M', 'Resume');
    await settle(page, 900);
  },

  async 'game-13'(page) {
    await openStored(page, 'MID013', 'Resume');
    await settle(page, 900);
  },

  async 'game-19'(page) {
    await openStored(page, 'MID019', 'Resume');
    await settle(page, 900);
  },

  async toast(page) {
    await openStored(page, 'K7QW2M', 'Resume');
    await settle(page, 300);
    await page.getByRole('toolbar').getByRole('button', { name: 'Share game' }).click();
    await page.getByText('Link copied to clipboard!').waitFor({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
  },

  async scoring(page) {
    await openStored(page, 'SCORE9', 'Resume');
    await acceptButtons(page).first().waitFor({ timeout: 15_000 });
    await settle(page, 900);
  },

  async review(page) {
    await openStored(page, 'LOST12', 'Review');
    await settle(page, 300);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(120);
    }
    await settle(page, 500);
  },

  async overlay(page) {
    await openStored(page, 'SCORE9', 'Resume');
    await settle(page, 300);
    await acceptAll(page);
    await page.getByRole('dialog', { name: /wins|won/i }).waitFor({ timeout: 10_000 });
    await settle(page, 1200);
  },

  async 'overlay-win'(page) {
    await openStored(page, 'WIN001', 'Resume');
    await settle(page, 600);
    await acceptAll(page);
    await page.getByRole('dialog', { name: /won/i }).waitFor({ timeout: 20_000 });
    await settle(page, 1200);
  },

  async invite(page) {
    await page.goto('./#/?s=NV1TE5');
    const value = page.getByText('Room', { exact: true });
    await value.waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const sheet = page.getByTestId('invite-sheet');
    await sheet.waitFor({ timeout: 15_000 });
    // With the broker blocked the sheet settles on `Connect manually`.
    await sheet.getByRole('button', { name: 'Connect manually' }).waitFor({ timeout: 25_000 }).catch(() => {});
    await settle(page, 600);
  },

  async history(page) {
    await page.goto('./');
    await page.getByTestId('stage').waitFor();
    await settle(page, 300);
    const heading = page.getByRole('heading', { name: 'Previous games' });
    await page.mouse.move(10, 10);
    for (let i = 0; i < 6 && !(await heading.isVisible()); i++) {
      await page.mouse.wheel(0, page.viewportSize().height * 0.8);
      await page.waitForTimeout(250);
    }
    await heading.scrollIntoViewIfNeeded();
    await settle(page, 900);
  },

  async 'history-end'(page) {
    await SCREENS.history(page);
    await page.mouse.wheel(0, 20_000);
    await settle(page, 900);
  },
};

const GAME9 = game('K7QW2M', 'local', CAPTURES9, { tc: '5+7', ms: msFor(CAPTURES9.length, 6000) });
const SCORE9 = game('SCORE9', 'local', WALLS9, { tc: '5+7', scoring: SCORING });

/** What each screen's context holds. */
const SEEDS = {
  start: { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
  dial: { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
  'game-9': { games: [GAME9] },
  'game-13': { games: [game('MID013', 'local', OPENING13, { size: 13, tc: '10+5' })] },
  'game-19': { games: [game('MID019', 'local', OPENING19, { size: 19, tc: '20m5x30' })] },
  toast: { games: [GAME9] },
  scoring: { games: [SCORE9] },
  review: { games: [HISTORY_GAMES[4]] },
  overlay: { games: [SCORE9] },
  'overlay-win': { games: [game('WIN001', 'computer', WALLS9, { level: 1, color: 'B', tc: '10+5', scoring: SCORING })] },
  invite: { prefs: { opponent: { mode: 'room' }, color: 'W', clock: { 9: null } } },
  history: { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
  'history-end': { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
};

/* ---------------------------------------------------------------------------------------------- */
/* Run                                                                                              */
/* ---------------------------------------------------------------------------------------------- */

const only = listArg('only');
const names = Object.keys(SCREENS).filter((n) => !only || only.includes(n));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let failed = 0;
try {
  for (const name of names) {
    for (const size of SIZES) {
      for (const theme of THEMES) {
        const file = join(OUT, `${name}-${theme}-${size.width}x${size.height}.png`);
        const context = await newContext(browser, size, theme, SEEDS[name]);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        try {
          const result = await SCREENS[name](page);
          await page.screenshot({ path: file, animations: 'disabled' });
          if (typeof result === 'function') await result();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          console.log(`ok   ${file}${overflow > 0 ? `  (horizontal overflow ${overflow}px)` : ''}${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`);
        } catch (e) {
          failed++;
          await page.screenshot({ path: file.replace(/\.png$/, '.failed.png') }).catch(() => {});
          console.log(`FAIL ${file}: ${e.message.split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
