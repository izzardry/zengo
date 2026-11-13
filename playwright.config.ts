import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

// End-to-end tests run against the production build served by `vite preview`,
// so the service worker, base "./" and the engine paths are exercised as shipped.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  // Every game page runs the engine in a worker (loading, hint searches, the dead-stone proposal)
  // and the room tests drive two pages each. Playwright's default of half the cores (7 here) made
  // the machine so busy that pages stalled for seconds and timed tests failed; 4 keeps it stable.
  // `--workers` on the command line still overrides this.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always build and serve fresh, so a gate never tests a stale preview left running.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
