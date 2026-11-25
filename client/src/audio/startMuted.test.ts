import { describe, expect, it } from "vitest";
import { startsMuted } from "./startMuted";

describe("startsMuted", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("mutes with ?mute=1", () => {
    expect(startsMuted(params("mute=1"), false)).toBe(true);
  });

  it("plays by default for a person", () => {
    expect(startsMuted(params(""), false)).toBe(false);
  });

  it("mutes by default under automation", () => {
    expect(startsMuted(params("load=economy"), true)).toBe(true);
  });

  it("lets automation opt back in with ?mute=0", () => {
    expect(startsMuted(params("mute=0"), true)).toBe(false);
  });
});
