import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const AUDIO_REF_DIR = fileURLToPath(
  new URL("../.local/audio-ref", import.meta.url),
);

const MIME_BY_EXT: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
};

/**
 * Dev-server-only middleware (`apply: 'serve'`) serving `/audio-ref/*` from `.local/audio-ref/`
 * (`specs/25-audio.md` §4.2). Never runs during production builds (`vite build` / `deploy:pages`).
 */
function zhAudioRefServePlugin(): Plugin {
  return {
    name: "redline-zh-audio-ref",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/audio-ref", (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }
        const cleanUrl = decodeURIComponent(
          req.url.split("?")[0] ?? "",
        ).replace(/^\/+/, "");
        const candidate = resolve(AUDIO_REF_DIR, cleanUrl);
        if (
          !candidate.startsWith(AUDIO_REF_DIR + sep) &&
          candidate !== AUDIO_REF_DIR
        ) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (!existsSync(candidate) || !statSync(candidate).isFile()) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const ext = extname(candidate).toLowerCase();
        res.setHeader(
          "Content-Type",
          MIME_BY_EXT[ext] ?? "application/octet-stream",
        );
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(candidate).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [zhAudioRefServePlugin()],
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
