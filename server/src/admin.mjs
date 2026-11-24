// Tester admin inside the container, called over SSH by scripts/testers.mjs:
//   node src/admin.mjs upsert <name> <sha256>   adds or re-invites
//   node src/admin.mjs list                     prints JSON rows
//   node src/admin.mjs revoke <name>            prints "removed" or "missing"
import { join } from "node:path";
import { cleanName, TesterStore } from "./testers.mjs";

const store = new TesterStore(join(process.env.DATA_DIR ?? "/data", "testers.json"));
const [command, ...args] = process.argv.slice(2);

if (command === "upsert") {
  const hash = String(args[1] ?? "");
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("bad hash");
  store.upsert(cleanName(args[0]), hash);
  console.log("ok");
} else if (command === "list") {
  console.log(
    JSON.stringify(store.all().map(({ name, added_at }) => ({ name, added_at }))),
  );
} else if (command === "revoke") {
  console.log(store.remove(cleanName(args[0])) ? "removed" : "missing");
} else {
  console.error("usage: admin.mjs upsert <name> <hash> | list | revoke <name>");
  process.exit(2);
}
