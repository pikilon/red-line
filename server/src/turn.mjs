// Short-lived relay (TURN) credentials, the coturn "REST API" scheme: the
// username is the expiry time and the password its HMAC with the secret the
// relay shares with this server. Nothing secret reaches the game.
import { createHmac } from "node:crypto";

export const TURN_TTL_S = 6 * 60 * 60;

export function turnCredentials(secret, host, nowMs = Date.now()) {
  const username = `${Math.floor(nowMs / 1000) + TURN_TTL_S}:redline`;
  const credential = createHmac("sha1", secret)
    .update(username)
    .digest("base64");
  return {
    urls: [`turn:${host}:3479?transport=udp`, `turn:${host}:3479?transport=tcp`],
    username,
    credential,
  };
}
