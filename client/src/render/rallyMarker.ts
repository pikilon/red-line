import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from "three";
import { groundY } from "./elevation";

export interface RallyMarkerTarget {
  /** Tiles. */
  x: number;
  y: number;
  /** Controlling player's colour. */
  color: number;
}

export interface RallyMarker {
  readonly group: Group;
  /** Shows the persistent point, or hides it when the producer is deselected. */
  show(target: RallyMarkerTarget | null): void;
  activeCount(): number;
  dispose(): void;
}

/** The selected producer's rally flag (Zero Hour precedent, spec 33). */
export function createRallyMarker(): RallyMarker {
  const group = new Group();
  group.name = "rally-point-marker";
  group.visible = false;
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: DoubleSide,
  });
  const ring = new Mesh(new RingGeometry(0.55, 0.75, 32), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.renderOrder = 10;
  const pole = new Mesh(new CylinderGeometry(0.035, 0.035, 1.4, 6), material);
  pole.position.y = 0.7;
  pole.renderOrder = 10;
  const flag = new Mesh(new BoxGeometry(0.65, 0.35, 0.03), material);
  flag.position.set(0.325, 1.15, 0);
  flag.renderOrder = 10;
  group.add(ring, pole, flag);
  let active = false;

  return {
    group,
    show(target) {
      active = target !== null;
      group.visible = active;
      if (target === null) return;
      group.position.set(target.x, groundY(target.x, target.y), target.y);
      material.color.setHex(target.color);
    },
    activeCount: () => (active ? 1 : 0),
    dispose() {
      group.remove(...group.children);
      ring.geometry.dispose();
      pole.geometry.dispose();
      flag.geometry.dispose();
      material.dispose();
    },
  };
}
