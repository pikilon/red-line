import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  RingGeometry,
} from "three";

/** How long a marker stays on the ground, in ms (spec 20 §4). */
export const ATTACK_MARKER_MS = 1300;
/** Markers kept at once; a later order recycles the oldest. */
export const ATTACK_MARKER_CAPACITY = 4;

export interface AttackMarkerTarget {
  /** Entity to follow, or null for a fixed point. */
  id: number | null;
  /** Tiles. */
  x: number;
  y: number;
  /** Ring radius in tiles. */
  radius: number;
}

export interface AttackMarker {
  readonly group: Group;
  /** Starts a pulsing red disc and ring on `target`. */
  show(target: AttackMarkerTarget, nowMs: number): void;
  /** Follows entity targets and expires old markers. */
  update(
    nowMs: number,
    positionOf: (id: number) => { x: number; y: number } | null,
  ): void;
  /** Live marker count (debug; spec 20 AC-20-05). */
  activeCount(): number;
  dispose(): void;
}

interface Slot {
  readonly group: Group;
  readonly disc: Mesh<CircleGeometry, MeshBasicMaterial>;
  readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  startMs: number;
  target: AttackMarkerTarget | null;
}

/**
 * A short, pulsing red disc and ring on the ground under an attack target or
 * point (spec 20 §4, owner request 2026-10-25). Client-only: it acknowledges
 * the order and never touches the simulation.
 */
export function createAttackMarker(): AttackMarker {
  const group = new Group();
  group.name = "attack-markers";
  const slots: Slot[] = [];

  for (let i = 0; i < ATTACK_MARKER_CAPACITY; i++) {
    const slotGroup = new Group();
    slotGroup.visible = false;
    const disc = new Mesh(
      new CircleGeometry(1, 40),
      new MeshBasicMaterial({
        color: 0xff1c1c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        side: DoubleSide,
        blending: NormalBlending,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    disc.renderOrder = 10;
    const ring = new Mesh(
      new RingGeometry(0.72, 1, 40),
      new MeshBasicMaterial({
        color: 0xff2020,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
        blending: NormalBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    slotGroup.add(disc, ring);
    group.add(slotGroup);
    slots.push({
      group: slotGroup,
      disc,
      ring,
      startMs: Number.NEGATIVE_INFINITY,
      target: null,
    });
  }

  function place(slot: Slot, target: AttackMarkerTarget): void {
    slot.group.position.set(target.x, 0, target.y);
    slot.group.scale.setScalar(target.radius);
  }

  function show(target: AttackMarkerTarget, nowMs: number): void {
    let slot = slots.find((candidate) => candidate.target === null);
    if (slot === undefined) {
      slot = slots.reduce((oldest, candidate) =>
        candidate.startMs < oldest.startMs ? candidate : oldest,
      );
    }
    slot.target = { ...target };
    slot.startMs = nowMs;
    slot.group.visible = true;
    place(slot, target);
    slot.disc.material.opacity = 0.35;
    slot.ring.material.opacity = 1;
  }

  function update(
    nowMs: number,
    positionOf: (id: number) => { x: number; y: number } | null,
  ): void {
    for (const slot of slots) {
      const target = slot.target;
      if (target === null) continue;
      // A click can land a few ms after the timestamp of the frame being
      // drawn; clamp it so the marker is not expired before it is seen.
      const age = Math.max(0, nowMs - slot.startMs);
      if (age >= ATTACK_MARKER_MS) {
        expire(slot);
        continue;
      }
      if (target.id !== null) {
        const position = positionOf(target.id);
        if (position === null) {
          expire(slot);
          continue;
        }
        slot.group.position.set(position.x, 0, position.y);
      }
      const t = age / ATTACK_MARKER_MS;
      // Three pulses fading out; the ring grows slightly as it blinks.
      const pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 6);
      const fade = 1 - t;
      slot.group.scale.setScalar(target.radius * (1 + 0.35 * t));
      slot.disc.material.opacity = 0.4 * fade * pulse;
      slot.ring.material.opacity = fade * pulse;
    }
  }

  function expire(slot: Slot): void {
    slot.target = null;
    slot.group.visible = false;
    slot.disc.material.opacity = 0;
    slot.ring.material.opacity = 0;
  }

  return {
    group,
    show,
    update,
    activeCount: () =>
      slots.reduce(
        (count, slot) => (slot.target === null ? count : count + 1),
        0,
      ),
    dispose: () => {
      group.remove(...group.children);
      for (const slot of slots) {
        slot.disc.geometry.dispose();
        slot.disc.material.dispose();
        slot.ring.geometry.dispose();
        slot.ring.material.dispose();
      }
    },
  };
}
