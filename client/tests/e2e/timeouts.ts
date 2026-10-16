/**
 * CI runners render with software WebGL and run several workers on few cores,
 * so the same test takes several times longer there (issue #291). Every e2e
 * wait scales by `SLOW`: 3 on CI (GitHub Actions sets `CI=true`), 1 locally.
 * Only waiting changes; no assertion does.
 */
export const SLOW = process.env.CI ? 3 : 1;

/** `value` milliseconds, scaled for CI. */
export function ms(value: number): number {
  return value * SLOW;
}
