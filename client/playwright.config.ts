import { defineConfig } from "@playwright/test";

const PERF_TAG = /@perf/;

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command:
      "node --run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
  projects: [
    { name: "default", grepInvert: PERF_TAG },
    {
      // Reference machine only (AC-02-44); run with `node --run test:perf`.
      name: "perf",
      default: false,
      grep: PERF_TAG,
      use: {
        launchOptions: {
          args: ["--ignore-gpu-blocklist", "--use-angle=metal"],
        },
      },
    },
  ],
});
