#!/usr/bin/env node
/**
 * Rasterizes the Zigo brand images into public/ (DESIGN 2, Ztyle 01 and 12):
 *
 *   public/pwa-192x192.png            icon, 192 × 192 (also the apple-touch-icon in index.html)
 *   public/pwa-512x512.png            icon, 512 × 512
 *   public/pwa-512x512-maskable.png   icon, 512 × 512, motif scaled into the central 80 %
 *   public/favicon.ico                PNG-in-ICO: 16, 32, 48 (simplified) and 256 (full)
 *   public/og-image.png               social card, 1200 × 630
 *
 * Source artwork: scripts/brand/icon.svg (two stones from the stone set on a grid corner).
 * Rendering uses Playwright's bundled Chromium (`page.setContent` + `screenshot`), so no image
 * library is needed. The output is committed; run this again only when the artwork changes:
 *
 *   node scripts/generate-brand-images.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (name) => join(root, "public", name);

/** Ztyle dark tokens (hex), DESIGN 2 / Ztyle 01. */
const C = {
  tile: "#0d0d0d",
  card: "#171717",
  fg: "#f2f2f2",
  muted: "#8c8c8c",
};

/** Feature line of the OG image: three items, as Ztyle 01 asks. */
const FEATURES = ["9×9 to 19×19", "12 computer levels", "zero ads"];

const STONES_GROUP = /(<g id="stones"[^>]*>)/;

const master = readFileSync(join(root, "scripts/brand/icon.svg"), "utf8")
  .replace(/<\?xml[^>]*>\s*/, "")
  .replace(/<!--[\s\S]*?-->\s*/g, "");

/** The master SVG at a pixel size, optionally transformed into a variant. */
function iconSvg(size, variant = "full") {
  let svg = master.replace(/width="512" height="512"/, `width="${size}" height="${size}"`);
  if (variant === "maskable") {
    // Maskable icons are cropped to a circle of 80 % diameter: keep the tile full-bleed and
    // scale the motif to 80 %, which keeps the stones well inside the safe circle.
    svg = svg.replace('<g id="motif">', '<g id="motif" transform="translate(256 256) scale(0.8) translate(-256 -256)">');
  }
  if (variant === "small") {
    // Favicon sizes: grid lines at 16 px are noise. Drop them, enlarge the stones, thicken the outline.
    svg = svg
      .replace('<g id="grid" ', '<g id="grid" display="none" ')
      .replace(STONES_GROUP, (open) =>
        open
          .replace('<g id="stones"', '<g id="stones" transform="translate(256 256) scale(1.45) translate(-256 -256)"')
          .replace(/stroke-width="[\d.]+"/, 'stroke-width="12"'),
      );
  }
  return svg;
}

const page = (body, w, h, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${C.tile}; }
  svg { display: block; }
  ${extraCss}
</style></head><body>${body}</body></html>`;

function fontFace(weight) {
  const file = join(root, `node_modules/@fontsource/fira-code/files/fira-code-latin-${weight}-normal.woff2`);
  const data = readFileSync(file).toString("base64");
  return `@font-face { font-family: "Fira Code"; font-weight: ${weight}; font-style: normal;
    src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
}

/** A small opening on 9×9 for the blurred board: [column, row from the top, 1 black / 2 white]. */
const OG_STONES = [
  [2, 6, 1], [6, 2, 2], [6, 6, 1], [2, 2, 2], [4, 4, 1], [5, 6, 2], [6, 5, 1], [3, 3, 2], [2, 5, 1], [5, 3, 2],
];

/**
 * A 9 × 9 board as on the start screen (Ztyle 01: "blurred 8 px at 60 % opacity"): card surface,
 * grid lines, star points and a few stones in the ink colors with a foreground outline.
 */
function blurredBoard(side) {
  const n = 9;
  const pitch = side / (n + 0.6);
  const at = (i) => pitch * (0.8 + i);
  let svg = `<rect width="${side}" height="${side}" rx="12" fill="${C.card}" />`;
  for (let i = 0; i < n; i++) {
    const w = i === 0 || i === n - 1 ? 2 : 1;
    svg += `<line x1="${at(0)}" y1="${at(i)}" x2="${at(n - 1)}" y2="${at(i)}" stroke="${C.fg}" stroke-opacity="0.4" stroke-width="${w}" />`;
    svg += `<line x1="${at(i)}" y1="${at(0)}" x2="${at(i)}" y2="${at(n - 1)}" stroke="${C.fg}" stroke-opacity="0.4" stroke-width="${w}" />`;
  }
  for (const [c, r] of [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]]) {
    svg += `<circle cx="${at(c)}" cy="${at(r)}" r="${pitch * 0.12}" fill="${C.fg}" fill-opacity="0.4" />`;
  }
  for (const [c, r, color] of OG_STONES) {
    // White at 30 %: blurred, full white stones read as bright blobs behind the wordmark.
    const paint = color === 1 ? `fill="${C.tile}" stroke="${C.fg}" stroke-opacity="0.5"` : `fill="${C.fg}" fill-opacity="0.3" stroke="none"`;
    svg += `<circle cx="${at(c)}" cy="${at(r)}" r="${pitch * 0.45}" ${paint} stroke-width="2" />`;
  }
  return `<svg width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${svg}</svg>`;
}

function ogHtml() {
  const css = `
    ${fontFace(300)}
    ${fontFace(400)}
    body {
      font-family: "Fira Code", monospace; color: ${C.fg};
      background-color: ${C.tile};
      background-image: radial-gradient(circle, rgba(242, 242, 242, 0.06) 1px, transparent 1px);
      background-size: 8px 8px;
      display: flex; align-items: center; justify-content: center; position: relative;
    }
    .board { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
             filter: blur(8px); opacity: 0.6; }
    .text { position: relative; text-align: center; }
    .mark { font-weight: 300; font-size: 96px; letter-spacing: 0.3em; margin-right: -0.3em; line-height: 1; }
    .tag  { margin-top: 36px; font-size: 36px; color: ${C.muted}; font-weight: 400; }
    .feat { margin-top: 44px; font-size: 24px; color: ${C.muted}; opacity: 0.7; white-space: pre; font-weight: 400; }
  `;
  const body = `
    <div class="board">${blurredBoard(520)}</div>
    <div class="text">
      <div class="mark">ZIGO</div>
      <div class="tag">Zero Distractions. Just Go.</div>
      <div class="feat">${FEATURES.join("  |  ")}</div>
    </div>`;
  return page(body, 1200, 630, css);
}

/** PNG-in-ICO container (Vista+): header, directory, then the PNG files as they are. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const tab = await ctx.newPage();

  const render = async (html, w, h) => {
    await tab.setViewportSize({ width: w, height: h });
    await tab.setContent(html, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    return tab.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } });
  };

  const icon = (size, variant) => render(page(iconSvg(size, variant), size, size), size, size);

  writeFileSync(pub("pwa-512x512.png"), await icon(512));
  writeFileSync(pub("pwa-192x192.png"), await icon(192));
  writeFileSync(pub("pwa-512x512-maskable.png"), await icon(512, "maskable"));

  const icoImages = [];
  for (const size of [16, 32, 48]) icoImages.push({ size, png: await icon(size, "small") });
  icoImages.push({ size: 256, png: await icon(256) });
  writeFileSync(pub("favicon.ico"), ico(icoImages));

  writeFileSync(pub("og-image.png"), await render(ogHtml(), 1200, 630));

  console.log("Wrote pwa-192x192.png, pwa-512x512.png, pwa-512x512-maskable.png, favicon.ico, og-image.png to public/");
} finally {
  await browser.close();
}
