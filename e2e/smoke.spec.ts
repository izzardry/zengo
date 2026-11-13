import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

test("start page shows the wordmark and tagline", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("./");

  await expect(page.getByRole("heading", { name: "ZIGO" })).toBeVisible();
  await expect(page.getByText("Zero Distractions. Just Go.")).toBeVisible();
  await expect(page).toHaveTitle("Zigo - Zero Distractions. Just Go.");
  expect(errors).toEqual([]);
});

test("engine files are served as shipped: networks as gzip bytes, TF.js backends as wasm", async ({ request }) => {
  // The 6-block network (stage 1). Served as plain gzip bytes without Content-Encoding, as GitHub
  // Pages does, so the worker inflates it itself (BUILD-LOG 0a).
  const small = await request.get("engine/nets/g170-b6c96-s175395328-d26788732.bin.gz");
  expect(small.ok()).toBe(true);
  expect(small.headers()["content-type"]).toContain("application/gzip");
  expect(small.headers()["content-encoding"]).toBeUndefined();
  const bytes = await small.body();
  expect(bytes.length).toBe(3_827_339);
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);

  // The 10-block network (stage 2): only the headers.
  const large = await request.head("engine/nets/g170e-b10c128-s1141046784-d204142634.bin.gz");
  expect(large.ok()).toBe(true);
  expect(large.headers()["content-type"]).toContain("application/gzip");
  expect(large.headers()["content-encoding"]).toBeUndefined();

  for (const file of ["tfjs-backend-wasm.wasm", "tfjs-backend-wasm-simd.wasm", "tfjs-backend-wasm-threaded-simd.wasm"]) {
    const wasm = await request.get(`engine/tfjs/${file}`);
    expect(wasm.ok(), file).toBe(true);
    expect(wasm.headers()["content-type"], file).toContain("application/wasm");
  }
});

test("no built chunk imports the engine worker's entry file (Safari would run the worker twice)", () => {
  // Safari evaluates a module worker's entry again when a chunk imports it, which registered TF.js
  // twice and replaced the worker's message handler with an uninitialised one: every search failed
  // with "engine worker not initialised". The worker's shared code lives in the engine-core chunk.
  const dir = path.resolve("dist/assets");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const entry = files.find((f) => f.startsWith("engine.worker-"));
  expect(entry).toBeDefined();
  expect(files.some((f) => f.startsWith("engine-core-"))).toBe(true);
  const importers = files.filter((f) => f !== entry && fs.readFileSync(path.join(dir, f), "utf8").includes(`./${entry}`));
  expect(importers).toEqual([]);
});

test("unknown routes show the not-found page", async ({ page }) => {
  await page.goto("./#/no-such-page");
  await expect(page.getByText("404")).toBeVisible();
});

test("theme follows the system color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("./");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});

test("the brand font is self-hosted and loaded", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "ZIGO" })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    // fonts.check() alone is true for undeclared families, so look for a loaded face.
    return [...document.fonts].some(
      (f) => f.family.replace(/"/g, "") === "Fira Code" && f.weight === "300" && f.status === "loaded",
    );
  });
  expect(loaded).toBe(true);
});
