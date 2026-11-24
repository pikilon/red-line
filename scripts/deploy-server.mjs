// Deploys server/ to the owner's VPS as the Docker Compose project
// `red-line` (/docker/red-line). Needs SSH access as root with this
// machine's key. The relay secret is created on the VPS the first time and
// never leaves it; GITHUB_TOKEN is added there by the owner.
//
//   node --run deploy:server
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VPS = "root@69.62.106.16";
export const REMOTE_DIR = "/docker/red-line";
const HEALTH = "https://red-line-server.pikilon.com/health";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed`);
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
run("ssh", [VPS, `mkdir -p ${REMOTE_DIR}`]);
run("rsync", [
  "-a",
  "--delete",
  "--exclude=node_modules",
  "--exclude=.env",
  "--exclude=*.test.mjs",
  `${join(root, "server")}/`,
  `${VPS}:${REMOTE_DIR}/`,
]);
run("ssh", [
  VPS,
  [
    `cd ${REMOTE_DIR}`,
    "touch .env && chmod 600 .env",
    "grep -q '^TURN_SECRET=' .env || echo \"TURN_SECRET=$(openssl rand -hex 32)\" >> .env",
    "grep -q '^GITHUB_TOKEN=' .env || echo 'GITHUB_TOKEN=' >> .env",
    "docker compose up -d --build --remove-orphans",
  ].join(" && "),
]);
for (let attempt = 0; attempt < 30; attempt += 1) {
  const ok = await fetch(HEALTH)
    .then((response) => response.ok)
    .catch(() => false);
  if (ok) {
    console.log(`deploy:server: healthy at ${HEALTH}`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.error(`deploy:server: ${HEALTH} did not answer`);
process.exit(1);
