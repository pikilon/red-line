import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: { target: "es2023" },
  resolve: {
    alias: {
      "@sim": fileURLToPath(new URL("../crates/sim/pkg", import.meta.url)),
      "@data": fileURLToPath(new URL("../data/generated", import.meta.url)),
    },
  },
  worker: { format: "es" },
  server: { fs: { allow: [".."] } },
});
