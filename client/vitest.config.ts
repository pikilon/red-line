import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sim": fileURLToPath(new URL("../crates/sim/pkg", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
