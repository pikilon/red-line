// Multiplayer introductions (specs/51-multiplayer.md §2): every text frame a
// socket sends is relayed to the other sockets in the same room. Nothing is
// stored and nothing is read; a room disappears with its last socket.
export const MAX_PER_ROOM = 8;
export const MAX_FRAME = 64 * 1024;
const ROOM = /^[A-Za-z0-9_-]{1,64}$/;

export function validRoom(room) {
  return typeof room === "string" && ROOM.test(room);
}

export class Rooms {
  #rooms = new Map();

  /** Adds `peer` ({ send(text) }) to `room`; false when the room is full. */
  join(room, peer) {
    let peers = this.#rooms.get(room);
    if (peers === undefined) {
      peers = new Set();
      this.#rooms.set(room, peers);
    }
    if (peers.size >= MAX_PER_ROOM) return false;
    peers.add(peer);
    return true;
  }

  leave(room, peer) {
    const peers = this.#rooms.get(room);
    if (peers === undefined) return;
    peers.delete(peer);
    if (peers.size === 0) this.#rooms.delete(room);
  }

  relay(room, from, text) {
    if (text.length > MAX_FRAME) return;
    for (const peer of this.#rooms.get(room) ?? []) {
      if (peer !== from) peer.send(text);
    }
  }

  get size() {
    return this.#rooms.size;
  }
}
