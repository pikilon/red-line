import { expect, type Locator, type Page, test } from "@playwright/test";

interface Point {
  x: number;
  y: number;
}

interface EntityView {
  id: number;
  owner: number;
  kind: number;
  x: number;
  y: number;
  hp: number;
  flags: number;
  progress: number;
  target: number | null;
}

interface SkirmishDebugView {
  isReady(): boolean;
  mode(): "skirmish";
  tick(): number;
  controlledPlayer(): number;
  viewer(): number;
  entities(): EntityView[];
  entity(id: number): EntityView | null;
  typeIndex(id: string): number;
  fogAt(x: number, y: number): number;
  credits(): number;
  power(): { produced: number; consumed: number };
  outcome(): { outcome: "ongoing" | "winner" | "draw"; winner: number | null };
  selectedIds(): number[];
  worldToScreen(x: number, y: number): Point;
  cameraTarget(): Point;
  setCameraTarget(x: number, y: number): void;
  command(command: Record<string, unknown>): void;
  stateHash(): Promise<string>;
  drawCalls(): number;
  resetFrameStats(): void;
  frameStats(): { frames: number; p95FrameMs: number };
  injectFrameTimes(frameTimesMs: number[]): void;
  resumeFrameTimes(): void;
}

type DebugWindow = Window & { __redline?: SkirmishDebugView };

async function bootDebug(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await page.waitForFunction(
    () => (window as DebugWindow).__redline?.isReady() === true,
    undefined,
    { timeout: 10_000 },
  );
}

async function debugCall<T, A = undefined>(
  page: Page,
  body: (api: SkirmishDebugView, arg: A) => T,
  arg?: A,
): Promise<Awaited<T>> {
  const api = await page.evaluateHandle(
    () => (window as DebugWindow).__redline as SkirmishDebugView,
  );
  const run = body as (api: SkirmishDebugView, arg: unknown) => T;
  return (await api.evaluate(run, arg)) as Awaited<T>;
}

/** Type index of a type id, resolved through the debug API (no ruleset in the test). */
function kindOf(page: Page, id: string): Promise<number> {
  return debugCall(page, (api, typeId: string) => api.typeIndex(typeId), id);
}

test("AC-03-55: boots a skirmish with fog", async ({ page }) => {
  await bootDebug(page, "debug=1");

  expect(await debugCall(page, (api) => api.mode())).toBe("skirmish");
  const hq = await kindOf(page, "ua-hq");
  const dozer = await kindOf(page, "ua-dozer");
  const entities = await debugCall(page, (api) => api.entities());
  expect(entities.some((e) => e.owner === 0 && e.kind === hq)).toBe(true);
  expect(entities.some((e) => e.owner === 0 && e.kind === dozer)).toBe(true);
  expect(entities.some((e) => e.owner === 1)).toBe(false);

  expect(await debugCall(page, (api) => api.fogAt(14, 62))).toBe(2);
  expect(await debugCall(page, (api) => api.fogAt(113, 65))).toBe(0);

  await expect(page.locator("#res-credits")).toHaveText("Credits 5000");
  await expect(page.locator("#res-power")).toHaveText("Power 0/0");
  await expect(page.locator("#hud-player")).toHaveText("Player 1: Ukraine");

  const before = await debugCall(page, (api) => api.tick());
  await page.waitForTimeout(1000);
  const after = await debugCall(page, (api) => api.tick());
  expect(after).toBeGreaterThan(before);
});

test("AC-03-60: switches player and reveals the map", async ({ page }) => {
  await bootDebug(page, "debug=1");

  await page.keyboard.press("F2");
  await expect
    .poll(() => debugCall(page, (api) => api.controlledPlayer()))
    .toBe(1);
  await expect(page.locator("#hud-player")).toHaveText("Player 2: Russia");
  await expect(page.locator("#res-credits")).toHaveText("Credits 5000");
  const russia = await debugCall(
    page,
    async (api) => {
      const hq = api.typeIndex("ru-hq");
      return api.entities().some((e) => e.owner === 1 && e.kind === hq);
    },
    undefined,
  );
  expect(russia).toBe(true);
  expect(
    await debugCall(page, (api) => api.entities().some((e) => e.owner === 0)),
  ).toBe(false);

  await page.keyboard.press("F3");
  await expect.poll(() => debugCall(page, (api) => api.viewer())).toBe(255);
  const both = await debugCall(
    page,
    async (api) => {
      const uaHq = api.typeIndex("ua-hq");
      const ruHq = api.typeIndex("ru-hq");
      const entities = api.entities();
      return [
        entities.some((e) => e.owner === 0 && e.kind === uaHq),
        entities.some((e) => e.owner === 1 && e.kind === ruHq),
      ];
    },
    undefined,
  );
  expect(both).toEqual([true, true]);

  await page.keyboard.press("F3");
  await expect.poll(() => debugCall(page, (api) => api.viewer())).toBe(1);
});

test("AC-03-60: ignores F2 without debug", async ({ page }) => {
  // Without debug=1 the skirmish app still boots (default mode) but installs no
  // debug API; F2 must stay inert, which the debug API's absence proves.
  await page.goto("/?mode=skirmish");
  await expect(page.locator("#res-credits")).toHaveText("Credits 5000", {
    timeout: 10_000,
  });
  await page.keyboard.press("F2");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => "__redline" in window)).toBe(false);
});

test("AC-03-61: shows victory and defeat", async ({ page }) => {
  await bootDebug(page, "debug=1");

  await debugCall(page, (api) =>
    api.command({ kind: "debugSetHp", entity: 8, hp: 0 }),
  );
  await expect(page.locator("#outcome")).toHaveText("Victory", {
    timeout: 5000,
  });

  await page.keyboard.press("F2");
  await expect
    .poll(() => debugCall(page, (api) => api.controlledPlayer()))
    .toBe(1);
  await expect(page.locator("#outcome")).toHaveText("Defeat");
});

/** Fixed-point scale, `client/src/sim/fixed.ts` (spec §3). */
const FX_ONE = 65536;
/** Entity flags, `client/src/sim/matchSnapshot.ts` (spec §5.15). */
const FLAG_MOVING = 1;
const FLAG_UNDER_CONSTRUCTION = 2;

interface OwnedKind {
  owner: number;
  kind: number;
}

interface CountArgs extends OwnedKind {
  requireFlags: number;
  forbidFlags: number;
}

/** Entities of an owner and kind, optionally filtered by flag bits. */
function entityCount(
  page: Page,
  owner: number,
  kind: number,
  requireFlags = 0,
  forbidFlags = 0,
): Promise<number> {
  return debugCall(
    page,
    (api, args: CountArgs) =>
      api
        .entities()
        .filter(
          (entity) =>
            entity.owner === args.owner &&
            entity.kind === args.kind &&
            (entity.flags & args.requireFlags) === args.requireFlags &&
            (entity.flags & args.forbidFlags) === 0,
        ).length,
    { owner, kind, requireFlags, forbidFlags },
  );
}

/** The first entity of an owner and kind, or null. */
function entityOf(
  page: Page,
  owner: number,
  kind: number,
): Promise<EntityView | null> {
  return debugCall(
    page,
    (api, args: OwnedKind) =>
      api
        .entities()
        .find(
          (entity) => entity.owner === args.owner && entity.kind === args.kind,
        ) ?? null,
    { owner, kind },
  );
}

/** Left click (or right click) on the page position of a tile point. */
async function clickTiles(
  page: Page,
  x: number,
  y: number,
  button: "left" | "right" = "left",
): Promise<void> {
  const point = await debugCall(
    page,
    (api, tiles: Point) => api.worldToScreen(tiles.x, tiles.y),
    { x, y },
  );
  await page.mouse.click(point.x, point.y, { button });
}

/** Clicks a panel button on its live box with a real mouse event. The AC-03-57
 *  sequence must stay far inside the queued item's build time, and
 *  `locator.click()` waits for two stable animation frames plus a hit-target
 *  check, which a loaded runner can stretch past it. */
async function clickButton(
  page: Page,
  locator: Locator,
  button: "left" | "right" = "left",
): Promise<void> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("panel button is not rendered");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button,
  });
}

/** Sends a `construct` command for `dozer` (spec §5.8). */
function constructAt(
  page: Page,
  dozer: number,
  kind: number,
  originX: number,
  originY: number,
): Promise<void> {
  return debugCall(
    page,
    (
      api,
      args: { dozer: number; kind: number; originX: number; originY: number },
    ) => {
      api.command({
        kind: "construct",
        player: 0,
        dozer: args.dozer,
        typeIndex: args.kind,
        originX: args.originX,
        originY: args.originY,
      });
    },
    { dozer, kind, originX, originY },
  );
}

/** Sends a `debugSpawn` command at (x, y) tiles (spec §5.8, §5.16). */
function spawnAt(
  page: Page,
  owner: number,
  kind: number,
  x: number,
  y: number,
): Promise<void> {
  return debugCall(
    page,
    (
      api,
      args: { owner: number; kind: number; xRaw: number; yRaw: number },
    ) => {
      api.command({
        kind: "debugSpawn",
        player: args.owner,
        typeIndex: args.kind,
        xRaw: args.xRaw,
        yRaw: args.yRaw,
      });
    },
    { owner, kind, xRaw: Math.round(x * FX_ONE), yRaw: Math.round(y * FX_ONE) },
  );
}

test("AC-03-56: builds a power plant through the UI", async ({ page }) => {
  await bootDebug(page, "debug=1&speed=4");
  const dozerKind = await kindOf(page, "ua-dozer");
  const plantKind = await kindOf(page, "ua-power-plant");

  const dozer = await entityOf(page, 0, dozerKind);
  if (dozer === null) throw new Error("missing ua-dozer");
  await clickTiles(page, dozer.x, dozer.y);

  const plantButton = page.locator(
    '#command-panel button[data-type="ua-power-plant"]',
  );
  await expect(plantButton).toBeEnabled();
  await plantButton.click();
  // The 3x3 footprint centred on (19.5, 65.5) has origin (18, 64).
  await clickTiles(page, 19.5, 65.5);

  await expect
    .poll(() => entityCount(page, 0, plantKind, FLAG_UNDER_CONSTRUCTION), {
      timeout: 2000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator("#res-credits")).toHaveText("Credits 4400");
  await expect
    .poll(() => entityCount(page, 0, plantKind, 0, FLAG_UNDER_CONSTRUCTION), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator("#res-power")).toHaveText("Power 10/0", {
    timeout: 30_000,
  });

  // A right click while placing cancels it, so the next ground click, which is
  // a legal 3x3 site, must not start a second building.
  const builder = await entityOf(page, 0, dozerKind);
  if (builder === null) throw new Error("missing ua-dozer");
  await clickTiles(page, builder.x, builder.y);
  await expect(plantButton).toBeEnabled();
  await plantButton.click();
  await clickTiles(page, 25.5, 68.5, "right");
  await clickTiles(page, 19.5, 58.5);
  await page.waitForTimeout(1000);
  expect(await entityCount(page, 0, plantKind)).toBe(1);
});

test("AC-03-64: shows placement feedback", async ({ page }) => {
  await bootDebug(page, "debug=1&speed=4");
  const dozerKind = await kindOf(page, "ua-dozer");
  const hqKind = await kindOf(page, "ua-hq");
  const dozer = await entityOf(page, 0, dozerKind);
  const hq = await entityOf(page, 0, hqKind);
  if (dozer === null || hq === null)
    throw new Error("missing ua-dozer or ua-hq");
  await clickTiles(page, dozer.x, dozer.y);

  const plantButton = page.locator(
    '#command-panel button[data-type="ua-power-plant"]',
  );
  const hint = page.locator("#placement-hint");
  await expect(plantButton).toHaveAttribute("aria-pressed", "false");
  await expect(hint).toBeHidden();
  await plantButton.click();
  await expect(plantButton).toHaveAttribute("aria-pressed", "true");
  await expect(plantButton).toHaveClass(/\bactive\b/);
  await expect(hint).toBeVisible();
  // The last pointer position is the dozer, an illegal site; (19.5, 65.5)
  // centres a legal 3x3 footprint (AC-03-56).
  const legal = await debugCall(
    page,
    (api, tiles: Point) => api.worldToScreen(tiles.x, tiles.y),
    { x: 19.5, y: 65.5 },
  );
  await page.mouse.move(legal.x, legal.y);
  await expect(hint).toHaveText(
    "Left click on the ground to build · right click or Esc to cancel",
  );

  const overHq = await debugCall(
    page,
    (api, tiles: Point) => api.worldToScreen(tiles.x, tiles.y),
    { x: hq.x, y: hq.y },
  );
  await page.mouse.move(overHq.x, overHq.y);
  await expect(hint).toHaveText("Cannot build here");

  await page.keyboard.press("Escape");
  await expect(hint).toBeHidden();
  await expect(plantButton).toHaveAttribute("aria-pressed", "false");
});

test("AC-03-57: produces and cancels through the UI", async ({ page }) => {
  // At speed 1 the two buildings take 10 s of sim time each (spec §6.7).
  test.setTimeout(120_000);
  // Speed 1 instead of the 4 of the spec's Given: a ua-rifleman is 75 ticks,
  // which is 1.25 s at speed 4 and 5 s at speed 1. Production advances on the
  // worker clock while Playwright drives the page, so at speed 4 a loaded
  // runner can take longer than 1.25 s between the produce clicks and the
  // right click; the queued head then completes by itself, the cancel removes
  // the only remaining item and the queue empties (CI flake). At speed 1 the
  // head cannot complete during the sequence, and the "within 20 s" check below
  // still holds (75 ticks = 5 s).
  await bootDebug(page, "debug=1&speed=1");
  const dozerKind = await kindOf(page, "ua-dozer");
  const plantKind = await kindOf(page, "ua-power-plant");
  const barracksKind = await kindOf(page, "ua-barracks");
  const riflemanKind = await kindOf(page, "ua-rifleman");

  const dozer = await entityOf(page, 0, dozerKind);
  if (dozer === null) throw new Error("missing ua-dozer");
  await constructAt(page, dozer.id, plantKind, 18, 64);
  await expect
    .poll(() => entityCount(page, 0, plantKind, 0, FLAG_UNDER_CONSTRUCTION), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await constructAt(page, dozer.id, barracksKind, 12, 65);
  await expect
    .poll(
      () => entityCount(page, 0, barracksKind, 0, FLAG_UNDER_CONSTRUCTION),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  // Click the barracks on its footprint cell farthest from the dozer, so the
  // unit is never picked instead of the building (its origin is (12, 65)).
  const builder = await entityOf(page, 0, dozerKind);
  if (builder === null) throw new Error("missing ua-dozer");
  let click = { x: 12.5, y: 65.5 };
  let best = -1;
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      const point = { x: 12.5 + dx, y: 65.5 + dy };
      const distance = Math.hypot(point.x - builder.x, point.y - builder.y);
      if (distance > best) {
        best = distance;
        click = point;
      }
    }
  }
  await clickTiles(page, click.x, click.y);

  const rifleButton = page.locator(
    '#command-panel button[data-type="ua-rifleman"]',
  );
  await expect(rifleButton).toBeVisible();
  await expect(
    page.locator('#command-panel button[data-type="ua-stugna-team"]'),
  ).toBeVisible();

  await clickButton(page, rifleButton);
  await clickButton(page, rifleButton);
  await expect(page.locator("#queue .queue-item")).toHaveCount(2);
  await expect(page.locator("#res-credits")).toHaveText("Credits 3700");
  await clickButton(page, rifleButton, "right");
  await expect(page.locator("#queue .queue-item")).toHaveCount(1);
  await expect(page.locator("#res-credits")).toHaveText("Credits 3800");
  await expect
    .poll(() => entityCount(page, 0, riflemanKind), { timeout: 20_000 })
    .toBeGreaterThan(0);
});

test("AC-03-58: harvests supplies", async ({ page }) => {
  await bootDebug(page, "debug=1&speed=4");
  const dozerKind = await kindOf(page, "ua-dozer");
  const centerKind = await kindOf(page, "ua-supply-center");
  const truckKind = await kindOf(page, "ua-supply-truck");

  const dozer = await entityOf(page, 0, dozerKind);
  if (dozer === null) throw new Error("missing ua-dozer");
  await constructAt(page, dozer.id, centerKind, 15, 55);
  await expect
    .poll(() => entityCount(page, 0, truckKind), { timeout: 30_000 })
    .toBeGreaterThan(0);

  const before = await debugCall(page, (api) => api.credits());
  await expect
    .poll(
      async () => (await debugCall(page, (api) => api.credits())) > before,
      {
        timeout: 30_000,
      },
    )
    .toBe(true);
});

test("AC-03-59: attacks with a right click", async ({ page }) => {
  await bootDebug(page, "debug=1&speed=4");
  const kozakKind = await kindOf(page, "ua-kozak-scout");
  const leopardKind = await kindOf(page, "ua-leopard-2a4");
  const tankKind = await kindOf(page, "ru-t-72b3");

  await spawnAt(page, 0, kozakKind, 30.5, 62.5);
  await spawnAt(page, 0, leopardKind, 30.5, 64.5);
  await spawnAt(page, 1, tankKind, 40.5, 62.5);
  await expect
    .poll(() => entityCount(page, 0, leopardKind), { timeout: 5000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => entityCount(page, 1, tankKind), { timeout: 5000 })
    .toBeGreaterThan(0);

  // The app boots centred on the own HQ; pan to the engagement so both units
  // are on screen and clickable, as a player would before giving the order.
  await debugCall(page, (api) => api.setCameraTarget(35.5, 63.5));

  const leopard = await entityOf(page, 0, leopardKind);
  if (leopard === null) throw new Error("missing ua-leopard-2a4");
  const tank = await entityOf(page, 1, tankKind);
  if (tank === null) throw new Error("missing ru-t-72b3");

  await clickTiles(page, leopard.x, leopard.y);
  await expect
    .poll(() =>
      debugCall(
        page,
        (api, id: number) => api.selectedIds().includes(id),
        leopard.id,
      ),
    )
    .toBe(true);

  await clickTiles(page, tank.x, tank.y, "right");
  await expect
    .poll(() => entityCount(page, 0, leopardKind, FLAG_MOVING), {
      timeout: 2000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => entityCount(page, 1, tankKind), { timeout: 30_000 })
    .toBe(0);
  expect(await entityCount(page, 0, leopardKind)).toBeGreaterThan(0);
});

/** `MAX_DRAW_CALLS_SKIRMISH` (spec §3). */
const MAX_DRAW_CALLS_SKIRMISH = 8;

/** One rifleman block of AC-03-62; positions are cell centres. */
interface SpawnBlock {
  owner: number;
  typeId: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const DRAW_CALL_BLOCKS: readonly SpawnBlock[] = [
  { owner: 0, typeId: "ua-rifleman", x0: 20, x1: 34, y0: 20, y1: 29 },
  { owner: 1, typeId: "ru-rifleman", x0: 93, x1: 107, y0: 98, y1: 107 },
];

function blockSize(block: SpawnBlock): number {
  return (block.x1 - block.x0 + 1) * (block.y1 - block.y0 + 1);
}

/** Spawns one unit of `kind` at the centre of every cell of `block` (spec §5.16). */
function spawnBlock(
  page: Page,
  block: SpawnBlock,
  kind: number,
): Promise<void> {
  return debugCall(
    page,
    (api, args: SpawnRequest[]) => {
      for (const spawn of args) {
        api.command({
          kind: "debugSpawn",
          player: spawn.owner,
          typeIndex: spawn.kind,
          xRaw: spawn.xRaw,
          yRaw: spawn.yRaw,
        });
      }
    },
    spawnRequests(block, kind),
  );
}

interface SpawnRequest {
  owner: number;
  kind: number;
  xRaw: number;
  yRaw: number;
}

/** One `debugSpawn` per cell centre of `block`, already in fixed-point raw. */
function spawnRequests(block: SpawnBlock, kind: number): SpawnRequest[] {
  const requests: SpawnRequest[] = [];
  for (let x = block.x0; x <= block.x1; x++) {
    for (let y = block.y0; y <= block.y1; y++) {
      requests.push({
        owner: block.owner,
        kind,
        xRaw: Math.round((x + 0.5) * FX_ONE),
        yRaw: Math.round((y + 0.5) * FX_ONE),
      });
    }
  }
  return requests;
}

test("AC-03-62: renders a skirmish in at most 8 draw calls", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await bootDebug(page, "debug=1");

  for (const block of DRAW_CALL_BLOCKS) {
    const kind = await kindOf(page, block.typeId);
    await spawnBlock(page, block, kind);
    // Owner 0's block lies in explored terrain, so it is visible at once.
    if (block.owner === 0) {
      await expect
        .poll(() => entityCount(page, block.owner, kind), { timeout: 10_000 })
        .toBe(blockSize(block));
    }
  }

  await page.keyboard.press("F3");
  await expect.poll(() => debugCall(page, (api) => api.viewer())).toBe(255);
  // Owner 1's block is only in the snapshot while revealed.
  const enemy = DRAW_CALL_BLOCKS[1];
  if (enemy === undefined) throw new Error("missing enemy block");
  const enemyKind = await kindOf(page, enemy.typeId);
  await expect
    .poll(() => entityCount(page, enemy.owner, enemyKind), { timeout: 10_000 })
    .toBe(blockSize(enemy));

  // `drawCalls()` is `renderer.info.render.calls` of the last frame (spec §6.7).
  await expect
    .poll(() => debugCall(page, (api) => api.drawCalls()), { timeout: 10_000 })
    .toBeGreaterThan(0);
  const drawCalls = await debugCall(page, (api) => api.drawCalls());
  console.log(`AC-03-62 drawCalls=${drawCalls}`);
  expect(drawCalls).toBeGreaterThanOrEqual(1);
  expect(drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS_SKIRMISH);
});
