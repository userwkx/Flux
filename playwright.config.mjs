import { defineConfig } from "@playwright/test";

const port = Number.parseInt(process.env.FLUX_TEST_PORT || "4173", 10);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "msedge",
    headless: true,
    viewport: { width: 920, height: 700 },
  },
  webServer: {
    command: "node tests/static-server.mjs",
    port,
    reuseExistingServer: true,
  },
});
