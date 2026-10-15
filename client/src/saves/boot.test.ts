import { describe, expect, it } from "vitest";
import { loadSource } from "./boot";

describe("boot", () => {
  it("AC-19-12: load source", () => {
    const examples = ["showcase", "armor-duel"];
    expect(loadSource("slot-1", examples)).toEqual({
      kind: "slot",
      id: "slot-1",
    });
    expect(loadSource("slot-10", examples)).toEqual({
      kind: "slot",
      id: "slot-10",
    });
    expect(loadSource("slot-0", examples)).toBeNull();
    expect(loadSource("slot-11", examples)).toBeNull();
    expect(loadSource("slot-x", examples)).toBeNull();
    expect(loadSource("showcase", examples)).toEqual({
      kind: "example",
      id: "showcase",
    });
    expect(loadSource("nope", examples)).toBeNull();
    expect(loadSource(null, examples)).toBeNull();
  });
});
