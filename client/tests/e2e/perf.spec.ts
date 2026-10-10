import { expect, type Page, test } from "@playwright/test";

interface RedlinePerfView {
  isReady(): boolean;
  unitCount(): number;
  commandMove(ids: number[], x: number, y: number): void;
  resetFrameStats(): void;
  frameStats(): { frames: number; p95FrameMs: number };
}

type DebugWindow = Window & { __redline?: RedlinePerfView };

const MEASURED_FRAMES = 300;

test("AC-02-44: keeps 60 fps with 500 moving units @perf", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?mode=tech-slice&debug=1");
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => {
    const api = (window as DebugWindow).__redline as RedlinePerfView;
    const ids = Array.from({ length: api.unitCount() }, (_, id) => id);
    api.commandMove(ids, 100.5, 100.5);
    api.resetFrameStats();
  });
  await page.waitForFunction(
    (frames) =>
      ((window as DebugWindow).__redline as RedlinePerfView).frameStats()
        .frames >= frames,
    MEASURED_FRAMES,
    { timeout: 30_000 },
  );
  const stats = await page.evaluate(() =>
    ((window as DebugWindow).__redline as RedlinePerfView).frameStats(),
  );
  console.log(
    `AC-02-44 frames=${stats.frames} p95FrameMs=${stats.p95FrameMs.toFixed(2)}`,
  );
  expect(stats.frames).toBeGreaterThanOrEqual(MEASURED_FRAMES);
  expect(stats.p95FrameMs).toBeLessThanOrEqual(19);
});

/** Fixed-point scale, `client/src/sim/fixed.ts` (spec §3). */
const FX_ONE = 65536;

interface SkirmishPerfEntity {
  id: number;
  owner: number;
  kind: number;
}

/** Debug API of the skirmish app, `?debug=1` (spec §6.7). */
interface SkirmishPerfView {
  isReady(): boolean;
  typeIndex(id: string): number;
  entities(): SkirmishPerfEntity[];
  viewer(): number;
  command(command: Record<string, unknown>): void;
  setCameraTarget(x: number, y: number): void;
  resetFrameStats(): void;
  frameStats(): { frames: number; p95FrameMs: number };
}

type SkirmishDebugWindow = Window & { __redline?: SkirmishPerfView };

/** One 200-rifleman block of AC-03-63; positions are cell centres. */
interface PerfBlock {
  owner: number;
  typeId: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  targetX: number;
  targetY: number;
}

const PERF_BLOCKS: readonly PerfBlock[] = [
  {
    owner: 0,
    typeId: "ua-rifleman",
    x0: 40,
    x1: 59,
    y0: 2,
    y1: 11,
    targetX: 50.5,
    targetY: 18.5,
  },
  {
    owner: 1,
    typeId: "ru-rifleman",
    x0: 40,
    x1: 59,
    y0: 14,
    y1: 23,
    targetX: 50.5,
    targetY: 6.5,
  },
];

/** Spawns one rifleman at the centre of every cell of `block` (spec §5.16). */
function spawnPerfBlock(page: Page, block: PerfBlock): Promise<void> {
  return page.evaluate(
    (args: { block: PerfBlock; fx: number }) => {
      const api = (window as SkirmishDebugWindow).__redline as SkirmishPerfView;
      const kind = api.typeIndex(args.block.typeId);
      for (let x = args.block.x0; x <= args.block.x1; x++) {
        for (let y = args.block.y0; y <= args.block.y1; y++) {
          api.command({
            kind: "debugSpawn",
            player: args.block.owner,
            typeIndex: kind,
            xRaw: Math.round((x + 0.5) * args.fx),
            yRaw: Math.round((y + 0.5) * args.fx),
          });
        }
      }
    },
    { block, fx: FX_ONE },
  );
}

test("AC-03-63: keeps 60 fps in a 400-unit skirmish @perf", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/?debug=1");
  await page.waitForFunction(
    () => (window as SkirmishDebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 15_000 },
  );

  for (const block of PERF_BLOCKS) {
    await spawnPerfBlock(page, block);
  }

  // Reveal first: the ids of the owner-1 block are only in the snapshot with
  // `F3` (spec §6.5), and `drawCalls`/`frameStats` measure the revealed battle.
  await page.keyboard.press("F3");
  await page.waitForFunction(
    (blocks: readonly PerfBlock[]) => {
      const api = (window as SkirmishDebugWindow).__redline as SkirmishPerfView;
      if (api.viewer() !== 255) return false;
      const entities = api.entities();
      return blocks.every((block) => {
        const kind = api.typeIndex(block.typeId);
        const expected = (block.x1 - block.x0 + 1) * (block.y1 - block.y0 + 1);
        return (
          entities.filter(
            (entity) => entity.owner === block.owner && entity.kind === kind,
          ).length === expected
        );
      });
    },
    PERF_BLOCKS,
    { timeout: 30_000 },
  );

  await page.evaluate(
    (args: { blocks: readonly PerfBlock[]; fx: number }) => {
      const api = (window as SkirmishDebugWindow).__redline as SkirmishPerfView;
      for (const block of args.blocks) {
        const ids = api
          .entities()
          .filter((entity) => entity.owner === block.owner)
          .map((entity) => entity.id);
        api.command({
          kind: "move",
          player: block.owner,
          units: ids,
          xRaw: Math.round(block.targetX * args.fx),
          yRaw: Math.round(block.targetY * args.fx),
        });
      }
      api.setCameraTarget(50, 12);
      api.resetFrameStats();
    },
    { blocks: PERF_BLOCKS, fx: FX_ONE },
  );

  await page.waitForFunction(
    (frames) =>
      (
        (window as SkirmishDebugWindow).__redline as SkirmishPerfView
      ).frameStats().frames >= frames,
    MEASURED_FRAMES,
    { timeout: 90_000 },
  );
  const stats = await page.evaluate(() =>
    (
      (window as SkirmishDebugWindow).__redline as SkirmishPerfView
    ).frameStats(),
  );
  console.log(
    `AC-03-63 frames=${stats.frames} p95FrameMs=${stats.p95FrameMs.toFixed(2)}`,
  );
  expect(stats.frames).toBeGreaterThanOrEqual(MEASURED_FRAMES);
  expect(stats.p95FrameMs).toBeLessThanOrEqual(19);
});
