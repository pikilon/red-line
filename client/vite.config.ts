import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// The index (`zh-events.json`) still lives with the extracted originals.
const AUDIO_REF_DIR = fileURLToPath(
  new URL("../.local/audio-ref", import.meta.url),
);

// `node --run audio:pack` writes the WebM files the dev build plays (spec 25
// §4.2, §12). Audio is served only from here: `.local/audio-ref/` is input to
// the packer and is never served as audio, so the game exercises one format.
const AUDIO_REF_WEBM_DIR = fileURLToPath(
  new URL("../.local/audio-ref-webm", import.meta.url),
);

const MIME_BY_EXT: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".webm": "audio/webm",
};

/**
 * Dev-server-only middleware (`apply: 'serve'`) serving the parsed index from
 * `.local/audio-ref/` and every audio file from `.local/audio-ref-webm/`
 * (`specs/25-audio.md` §4.2). Never runs during production builds (`vite build`
 * / `deploy:pages`).
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
        const isIndex = cleanUrl.toLowerCase().endsWith(".json");
        const baseDir = isIndex ? AUDIO_REF_DIR : AUDIO_REF_WEBM_DIR;
        const relative = isIndex
          ? cleanUrl
          : cleanUrl.replace(/\.(wav|mp3)$/i, ".webm");
        const candidate = resolve(baseDir, relative);
        if (!candidate.startsWith(baseDir + sep)) {
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
