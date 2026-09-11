import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:7332",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        // Keep Chromium's native OS user agent so Monaco keyboard bindings
        // agree with ControlOrMeta on macOS and Linux runners.
        browserName: "chromium",
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: "http://127.0.0.1:7332/api/session",
    timeout: 180_000,
    stdout: "pipe",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 8_000 },
  },
});
