# 51 — Multiplayer by invite link

Status: approved (owner request 2026-11-16). Extends D-03 (see its 2026-11-16
amendment) and fills the "Networking/lockstep protocol" left out of spec 01.

## 1. Goal

Two people play one match, each in their own browser. One creates a room
and sends its invite link; the other opens it and the match starts. The
game traffic goes straight from browser to browser, so the project's server
carries almost nothing.

## 2. Connecting

### 2.1 Room and link

* Main menu → **Multiplayer** opens `?mode=multiplayer`: a new room with an
  8-character random code and its link `?mode=multiplayer&room=<code>`, a
  Copy button and "Waiting for your opponent…". The room exists only while
  that page is open.
* Opening the link shows "Connecting to your opponent…". The first guest to
  arrive takes the room.

### 2.2 Introduction (signalling)

* The two browsers find each other over a Supabase Realtime **broadcast**
  channel `redline-<code>` (the project already used for spec 47). Nothing
  is stored: no table, no function. The guest repeats `hello` every 2 s; the
  host answers with a WebRTC offer, the guest with its answer (whole SDP,
  addresses gathered first, up to 4 s). Then both close the socket.
* Public STUN servers (Google, Cloudflare) tell each browser its public
  address. There is no relay (TURN) yet.
* The guest gives up after 30 s with "Could not connect…".

### 2.3 Start

Once the data channel (reliable, ordered) is open the host sends
`{seed, mapId}` with a random seed and the default map; both start the same
match without reloading. The host plays player 0, the guest player 1. No AI,
debug off, speed 1.

## 3. Lockstep

Zero Hour precedent (`generals-precedent` note, `GameNetwork/Network.cpp:489`,
`ConnectionManager.cpp:1402-1420, 1552-1596`, `FrameData.cpp:107-112`,
`GameLogic.cpp:2540-2603`, `DisconnectManager.cpp:102-135`): an order given
on frame F runs on F + run-ahead; a frame runs only when every player's
command count for it arrived; a CRC is compared every 100 frames and a
mismatch only shows a message; a stalled game shows a wait screen after 5 s
and drops the player after 60 s.

### 3.1 Turns

* A turn is 3 ticks (200 ms). Orders given during turn N run at the start of
  turn N + 2 (400 ms run-ahead; Zero Hour's minimum is 10 frames ≈ 333 ms).
* Turns 0 and 1 carry no orders.

### 3.2 Messages

* When the worker begins turn N it posts `turnStarted`; the main thread then
  sends the orders queued since the previous turn as turn N + 2, to its own
  worker and to the peer — an empty list too, which plays the role of Zero
  Hour's command count.
* Orders from the peer always carry the peer's player; debug orders are
  dropped on both ends.

### 3.3 Gate

At a turn boundary the worker runs nothing until it holds both players'
lists for that turn, then applies player 0's orders, then player 1's, in the
order given, and steps on. Direct `command` messages and pauses are ignored
in a networked match.

### 3.4 Waiting and leaving

* Stalled 5 s: "Waiting for your opponent…". Stalled 60 s, a `bye` message
  (page closed) or a failed connection: "Your opponent left the match." with a
  Main menu button. The match stays frozen.

### 3.5 Desync check

Every 15 turns (3 s) each worker posts its state hash at the turn boundary,
before the turn's orders; the peers exchange them. A mismatch shows "The match
is no longer identical on both screens." once; the match goes on.

## 4. Client changes

* `client/src/net/`: `signal.ts` (Realtime socket), `peer.ts` (WebRTC),
  `lockstep.ts` (scheduling, hashes).
* `client/src/app/multiplayer.ts` (lobby), `netMatch.ts` (wraps the
  `SkirmishClient`, notices).
* The game menu of a networked match has no Save, Load, Switch side or
  Reveal; Restart goes back to the main menu.

## 5. Assumptions

* 1 vs 1, default map, host is player 0. Map and side choice come later.
* Fixed run-ahead; Zero Hour adapts it to latency every 500 ms (later).
* No TURN relay: a pair behind strict NATs (some mobile or corporate
  networks) cannot connect yet. The traffic is a few hundred bytes per
  second, so a relay would cost almost nothing if needed.
* A player who leaves does not destroy their army (Zero Hour self-destructs
  it); the match simply ends for the other.

## 6. Acceptance criteria

* **AC-51-01** A lockstep worker runs turns 0–1, then stops at the boundary
  of turn 2 and posts `waiting` until both players' turn-2 orders arrived.
* **AC-51-02** Turn orders run in player order then given order; direct
  `command` messages are ignored.
* **AC-51-03** Local orders queued before `turnStarted(N)` go to the worker
  and the peer as turn N + 2.
* **AC-51-04** Peer orders are rewritten to the peer's player; debug orders
  are dropped.
* **AC-51-05** Differing hashes for a turn report a desync once.
* **AC-51-06** The signal channel joins `realtime:redline-<code>` and relays
  `signal` broadcasts.
