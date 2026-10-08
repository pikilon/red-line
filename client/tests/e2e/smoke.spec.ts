import { expect, test } from "@playwright/test";

test("AC-00-01: renders an empty isometric scene canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Modern Conquest: Red Line");
  const canvas = page.locator("#app canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
});
