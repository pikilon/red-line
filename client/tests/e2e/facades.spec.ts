import { expect, test } from "@playwright/test";
import { ms } from "./timeouts";

interface FacadesDebug {
  isReady(): boolean;
  modelsReady(): boolean;
  tick(): number;
}

type DebugWindow = Window & { __redline?: FacadesDebug };

const FACADES = ["ua-wall", "ua-roof"];

// A fresh browser profile: no saved settings, so the generated textures apply.
test.use({ storageState: { cookies: [], origins: [] } });

test("AC-16-07: facades and HQ flags render without errors", async ({
  page,
}) => {
  test.setTimeout(ms(60_000));
  const errors: string[] = [];
  const loaded = new Set<string>();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const match = /textures\/([a-z-]+)\.webp$/.exec(response.url());
    if (match?.[1] !== undefined && response.ok()) loaded.add(match[1]);
  });

  await page.goto("/?load=showcase");
  await page.waitForFunction(
    () => {
      const debug = (window as DebugWindow).__redline;
      return debug?.isReady() === true && debug.modelsReady();
    },
    undefined,
    { timeout: ms(15_000) },
  );
  await expect
    .poll(() => FACADES.filter((id) => loaded.has(id)))
    .toEqual(FACADES);
  // Both HQs fly their flag with the facade shaders compiled: the game keeps
  // ticking.
  const before = await page.evaluate(
    () => (window as DebugWindow).__redline?.tick() ?? 0,
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as DebugWindow).__redline?.tick() ?? 0),
    )
    .toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
