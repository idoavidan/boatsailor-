import * as THREE from "three";
import { Checkpoint, WORLD } from "../protocol";

/**
 * Renders the race course as a series of gates (two buoys + a banner) and
 * detects when the local boat passes the gate it is currently aiming for.
 * Only used in speed mode.
 */
export class Course {
  readonly group = new THREE.Group();
  private gates: THREE.Group[] = [];

  get count(): number {
    return this.checkpoints.length;
  }

  constructor(private checkpoints: Checkpoint[]) {
    checkpoints.forEach((cp, i) => {
      const gate = this.buildGate(cp, i === 0);
      gate.position.set(cp.x, 0, cp.z);
      gate.rotation.y = cp.angle;
      this.gates.push(gate);
      this.group.add(gate);
    });
  }

  private buildGate(_cp: Checkpoint, isStart: boolean): THREE.Group {
    const gate = new THREE.Group();
    const buoyColor = isStart ? 0xffffff : 0xff3b30;
    const half = WORLD.checkpointRadius;

    const buoyGeo = new THREE.CylinderGeometry(2, 3, 8, 12);
    const buoyMat = new THREE.MeshStandardMaterial({
      color: buoyColor,
      emissive: new THREE.Color(buoyColor).multiplyScalar(0.2),
      roughness: 0.5,
    });

    for (const side of [-1, 1]) {
      const buoy = new THREE.Mesh(buoyGeo, buoyMat);
      buoy.position.set(side * half, 2, 0);
      gate.add(buoy);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 14, 6),
        buoyMat,
      );
      pole.position.set(side * half, 9, 0);
      gate.add(pole);
    }

    // Banner across the top.
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 3, 0.5),
      new THREE.MeshStandardMaterial({
        color: isStart ? 0x222222 : buoyColor,
        roughness: 0.7,
      }),
    );
    banner.position.set(0, 15, 0);
    gate.add(banner);

    return gate;
  }

  /** Highlight the gate the player is currently heading for. */
  highlightNext(index: number): void {
    this.gates.forEach((gate, i) => {
      const active = i === index;
      gate.scale.setScalar(active ? 1.06 : 1);
      gate.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (mat && mat.emissive) {
          mat.emissiveIntensity = active ? 1.5 : 1;
        }
      });
    });
  }

  /**
   * Returns true if (x, z) is within the capture radius of the given gate.
   * Caller is responsible for only checking the gate it expects next.
   */
  isWithin(index: number, x: number, z: number): boolean {
    const cp = this.checkpoints[index];
    if (!cp) return false;
    const dx = x - cp.x;
    const dz = z - cp.z;
    return dx * dx + dz * dz <= WORLD.checkpointRadius * WORLD.checkpointRadius;
  }

  checkpointPosition(index: number): THREE.Vector3 {
    const cp = this.checkpoints[index];
    return new THREE.Vector3(cp?.x ?? 0, 0, cp?.z ?? 0);
  }
}
