import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDistinctKinds,
  checkTexture,
  channelVariance,
  colorDistance,
  decodePng,
  encodePng,
  makeSeamless,
  meanColor,
  seamMaxDiff,
} from "./check-texture.mjs";

const W = 8;
const H = 8;

/** An opaque WxH image filled with one colour. */
function solid(r, g, b) {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

const SPEC = { width: W, height: H, palette: { base: [10, 20, 30] } };

test("AC-texture-01: meanColor averages the RGB channels", () => {
  assert.deepEqual(meanColor(solid(10, 20, 30), W, H), { r: 10, g: 20, b: 30 });
});

test("AC-texture-02: seamMaxDiff is zero for a uniform image", () => {
  assert.deepEqual(seamMaxDiff(solid(100, 100, 100), W, H), {
    horizontal: 0,
    vertical: 0,
  });
});

test("AC-texture-03: seamMaxDiff catches a left/right edge break only", () => {
  const rgba = solid(100, 100, 100);
  for (let y = 0; y < H; y++) {
    const o = (y * W + W - 1) * 4;
    rgba[o] = 255;
    rgba[o + 1] = 0;
    rgba[o + 2] = 0;
  }
  const seam = seamMaxDiff(rgba, W, H);
  assert.ok(seam.horizontal > 150);
  assert.equal(seam.vertical, 0);
});

test("AC-texture-04: checkTexture accepts a uniform image matching its palette", () => {
  const spec = { ...SPEC, minVariance: 0 };
  assert.deepEqual(checkTexture(solid(10, 20, 30), W, H, spec), {
    valid: true,
    reasons: [],
  });
});

test("AC-texture-05: checkTexture rejects a wrong mean colour and flatness", () => {
  const result = checkTexture(solid(200, 20, 30), W, H, SPEC);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes("mean r")));
  assert.ok(result.reasons.some((r) => r.includes("flat")));
});

test("AC-texture-06: checkTexture rejects a seam break", () => {
  const rgba = solid(10, 20, 30);
  for (let y = 0; y < H; y++) {
    const o = (y * W + W - 1) * 4;
    rgba[o] = 255;
  }
  const result = checkTexture(rgba, W, H, { ...SPEC, minVariance: 0 });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes("seamless")));
});

test("AC-texture-07: checkTexture rejects a wrong size", () => {
  const result = checkTexture(solid(10, 20, 30), W, H, {
    ...SPEC,
    width: 16,
    height: 16,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes("size")));
});

test("AC-texture-08: channelVariance is zero for a uniform image", () => {
  assert.deepEqual(channelVariance(solid(7, 8, 9), W, H), { r: 0, g: 0, b: 0 });
});

test("AC-texture-09: encodePng then decodePng round-trips an RGBA image", () => {
  const rgba = solid(12, 34, 56);
  const decoded = decodePng(encodePng(rgba, W, H));
  assert.equal(decoded.width, W);
  assert.equal(decoded.height, H);
  assert.deepEqual(Array.from(decoded.rgba.subarray(0, 4)), [12, 34, 56, 255]);
  assert.equal(decoded.rgba.length, W * H * 4);
});

test("AC-texture-10: makeSeamless zeroes both seams without mutating the input", () => {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = Math.floor(i / W);
    rgba[i * 4] = x < W / 2 ? 10 : 200;
    rgba[i * 4 + 1] = y < H / 2 ? 20 : 40;
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = 255;
  }
  const before = seamMaxDiff(rgba, W, H);
  assert.ok(before.horizontal > 100);
  assert.ok(before.vertical > 0);
  const out = makeSeamless(rgba, W, H, 4);
  assert.deepEqual(seamMaxDiff(out, W, H), { horizontal: 0, vertical: 0 });
  assert.equal(rgba[0], 10); // input left untouched
  assert.equal(out.length, W * H * 4);
});

test("AC-texture-11: colorDistance measures Euclidean RGB distance", () => {
  assert.equal(colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 }), 5);
});

test("AC-texture-12: checkDistinctKinds flags only too-similar adjacent kinds", () => {
  const means = {
    grass: { r: 63, g: 107, b: 42 },
    forest: { r: 60, g: 104, b: 40 },
    water: { r: 42, g: 90, b: 138 },
  };
  const kinds = {
    grass: { neighbors: [{ kind: "forest" }, { kind: "water" }] },
    forest: { neighbors: [{ kind: "grass" }] },
    water: { neighbors: [{ kind: "grass" }] },
  };
  const reasons = checkDistinctKinds(means, kinds, 40);
  assert.equal(reasons.length, 1);
  assert.ok(reasons[0].includes("grass") && reasons[0].includes("forest"));
});
