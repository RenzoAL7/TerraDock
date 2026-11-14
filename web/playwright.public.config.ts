import { defineConfig } from "@playwright/test";
import { publicDevPort, publicPreviewPort } from "./ports";

const deployedURL = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");

export default defineConfig({
  testDir: "./tests/public",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/public", open: "never" }],
  ],
  outputDir: "test-results/public",
  use: {
    baseURL: deployedURL || `http://127.0.0.1:${publicPreviewPort}`,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Both entries are isolated from Go and the local API.
  webServer: deployedURL
    ? undefined
    : [
        {
          command: "npm run build:public && npm run preview:public",
          url: `http://127.0.0.1:${publicPreviewPort}`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: "npm run dev:public",
          url: `http://127.0.0.1:${publicDevPort}`,
          reuseExistingServer: false,
        },
      ],
});
