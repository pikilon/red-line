import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const AUDIO_REF_DIR = fileURLToPath(
  new URL("../.local/audio-ref", import.meta.url),
);

// `node --run audio:pack` writes the same reference files as Opus/WebM at the
// shipping bitrates (spec 25 §12). The dev middleware prefers those files so
// the game exercises the shipping format; `.local/audio-ref/` remains the
// fallback and the only source the extractor writes to.
const AUDIO_REF_WEBM_DIR = fileURLToPath(
  new URL("../.local/audio-ref-webm", import.meta.url),
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
        const original = resolve(AUDIO_REF_DIR, cleanUrl);
        if (
          !original.startsWith(AUDIO_REF_DIR + sep) &&
          original !== AUDIO_REF_DIR
        ) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        let candidate = original;
        if (/\.(wav|mp3)$/i.test(cleanUrl)) {
          const webm = resolve(
            AUDIO_REF_WEBM_DIR,
            cleanUrl.replace(/\.(wav|mp3)$/i, ".webm"),
          );
          if (
            webm.startsWith(AUDIO_REF_WEBM_DIR + sep) &&
            existsSync(webm) &&
            statSync(webm).isFile()
          ) {
            candidate = webm;
          }
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
