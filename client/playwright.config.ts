import { defineConfig } from "@playwright/test";
import { ms } from "./tests/e2e/timeouts";

const PERF_TAG = /@perf/;

export default defineConfig({
  testDir: "tests/e2e",
  // Defaults scaled for slow CI runners (#291); explicit waits use `ms()` too.
  timeout: ms(30_000),
  expect: { timeout: ms(5_000) },
  use: {
    baseURL: "http://127.0.0.1:4173",
    // The e2e suite keeps the procedural textures (spec 12 §2): the generated
    // ones load 4 MB of PNGs, which makes timing-sensitive tests flaky on the
    // software WebGL of CI. `textures.spec.ts` overrides this to test the default.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:4173",
          localStorage: [
            {
              name: "redline.settings.v1",
              value: JSON.stringify({ gore: true, generatedTextures: false }),
            },
          ],
        },
      ],
    },
  },
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
