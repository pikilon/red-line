import { expect, test } from "@playwright/test";
import { ms } from "./timeouts";

interface ElevationDebug {
  isReady(): boolean;
  entity(id: number): { x: number; y: number } | null;
}

type DebugWindow = Window & { __redline?: ElevationDebug };

test("AC-30-13: tanks climb the first-line plateau by its ramp", async ({
  page,
}, testInfo) => {
  test.setTimeout(ms(90_000));
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/?load=hills-and-cliffs");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: ms(15_000) },
  );
  // Entity 6 (after the six depots) is the first Leopard: it ends on the
  // plateau top (cells 40..47 x 80..89), which it can only reach by the ramp
  // (spec 30 §3).
  await expect
    .poll(
      async () => {
        const tank = await page.evaluate(
          () => (window as DebugWindow).__redline?.entity(6) ?? null,
        );
        return tank !== null && tank.x > 41 && tank.x < 47 && tank.y > 81;
      },
      { timeout: ms(60_000) },
    )
    .toBe(true);
  await testInfo.attach("plateau", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});
