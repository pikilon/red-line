import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyBranch } from "./status.mjs";

test("protected branches are kept", () => {
  assert.equal(classifyBranch("main", []), "kept");
  assert.equal(classifyBranch("archive/first-attempt", []), "kept");
});

test("an open PR wins over a merged one", () => {
  const prs = [{ state: "MERGED" }, { state: "OPEN" }];
  assert.equal(classifyBranch("feat", prs), "open");
});

test("merged PR means the branch is stale", () => {
  assert.equal(classifyBranch("feat", [{ state: "MERGED" }]), "merged");
});

test("no PR means orphan", () => {
  assert.equal(classifyBranch("feat", []), "orphan");
  assert.equal(classifyBranch("feat", [{ state: "CLOSED" }]), "orphan");
});
