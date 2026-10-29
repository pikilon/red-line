import { describe, expect, it } from "vitest";

import { withFolded } from "./foldable";

describe("withFolded", () => {
  it("adds and removes ids without duplicates", () => {
    expect(withFolded([], "command", true)).toEqual(["command"]);
    expect(withFolded(["command"], "command", true)).toEqual(["command"]);
    expect(withFolded(["quick", "command"], "command", false)).toEqual([
      "quick",
    ]);
  });
});
