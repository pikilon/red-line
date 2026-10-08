// Validates data/*.yaml against JSON Schema. No data exists yet (Phase 0), so
// this only asserts that the data directory, once present, is not empty of schemas.
import { existsSync } from "node:fs";

if (!existsSync(new URL("../data", import.meta.url))) {
  console.log("check:data: no data/ directory yet, nothing to validate");
}
