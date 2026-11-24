/** The game's backend on the owner's VPS (docs/decisions.md D-03): tester
 *  reports (spec 47), multiplayer introductions and relay credentials
 *  (spec 51 §2). */
export const SERVER_URL: string = "https://red-line-server.pikilon.com";

/** Public STUN servers: they only tell a browser its public address. */
const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];
const TURN_FETCH_MS = 3000;

let cached: Promise<RTCIceServer[]> | null = null;

/** STUN plus short-lived relay (TURN) credentials for players whose networks
 *  block a direct link. Without the backend, STUN alone. */
export function iceServers(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<RTCIceServer[]> {
  if (cached !== null) return cached;
  cached = (async () => {
    try {
      const response = await fetcher(`${SERVER_URL}/turn`, {
        signal: AbortSignal.timeout(TURN_FETCH_MS),
      });
      const relays = (await response.json()) as RTCIceServer[];
      return Array.isArray(relays)
        ? [...STUN_SERVERS, ...relays]
        : STUN_SERVERS;
    } catch {
      cached = null;
      return STUN_SERVERS;
    }
  })();
  return cached;
}
