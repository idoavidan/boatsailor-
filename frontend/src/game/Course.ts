import * as THREE from "three";
import { Checkpoint, WORLD } from "../protocol";

/**
 * Renders the speed-mode race course: a start/finish line you cross plus one or
 * more turning buoys you round. Detects when the local boat reaches the mark it
 * is currently aiming for. Only used in speed mode.
 */
/** The start/finish line means something different depending on race progress,
 *  so it's recoloured: green before the start, white as a mid-race lap line,
 *  gold on the final (finish) crossing. */
export type LineRole = "start" | "lap" | "finish";
const LINE_COLORS: Record<LineRole, { color: number; emissive: number }> = {
  start: { color: 0x37d67a, emissive: 0x0e5a2e },
  lap: { color: 0xeef3f7, emissive: 0x33414d },
  finish: { color: 0xffd23f, emissive: 0x6b5200 },
};

export class Course {
  readonly group = new THREE.Group();
  private marks: THREE.Group[] = [];
  private lineMats: THREE.MeshStandardMaterial[] = [];
  private lineRole: LineRole | "" = "";

  get count(): number {
    return this.checkpoints.length;
  }

  constructor(private checkpoints: Checkpoint[]) {
    checkpoints.forEach((cp) => {
      const mark =
        cp.kind === "line" ? this.buildStartLine() : this.buildBuoy();
      mark.position.set(cp.x, 0, cp.z);
      mark.rotation.y = cp.angle;
      this.marks.push(mark);
      this.group.add(mark);
    });
  }

  /** Start/finish: two posts + a banner you sail between. */
  private buildStartLine(): THREE.Group {
    const gate = new THREE.Group();
    const half = WORLD.checkpointRadius;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff).multiplyScalar(0.2),
      roughness: 0.5,
    });

    for (const side of [-1, 1]) {
      const buoy = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 8, 12), mat);
      buoy.position.set(side * half, 2, 0);
      gate.add(buoy);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 14, 6),
        mat,
      );
      pole.position.set(side * half, 9, 0);
      gate.add(pole);
    }

    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0x000000),
      roughness: 0.7,
    });
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 3, 0.5),
      bannerMat,
    );
    banner.position.set(0, 15, 0);
    gate.add(banner);

    // Recoloured per race state by setLineRole().
    this.lineMats.push(mat, bannerMat);
    return gate;
  }

  /** Colour the start/finish line for its current role (see {@link LineRole}). */
  setLineRole(role: LineRole): void {
    if (role === this.lineRole) return;
    this.lineRole = role;
    const c = LINE_COLORS[role];
    for (const m of this.lineMats) {
      m.color.setHex(c.color);
      m.emissive.setHex(c.emissive);
    }
  }

  /** A single bright turning buoy meant to be rounded, not passed through. */
  private buildBuoy(): THREE.Group {
    const buoy = new THREE.Group();
    const color = 0xff7a18; // hi-vis orange rounding mark
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color).multiplyScalar(0.25),
      roughness: 0.5,
    });

    // Tapered float body sitting at the waterline.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, 10, 16), mat);
    body.position.y = 5;
    buoy.add(body);

    // Topmark so the buoy reads as a mark from a distance.
    const top = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), mat);
    top.position.y = 12;
    buoy.add(top);

    // A white skirt ring at the waterline to suggest "round me".
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5, 0.6, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.5;
    buoy.add(ring);

    return buoy;
  }

  /** Highlight the mark the player is heading for by making it glow — no size
   *  change (a growing mark reads as confusing). */
  highlightNext(index: number): void {
    this.marks.forEach((mark, i) => {
      const active = i === index;
      mark.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (mat && mat.emissive) {
          mat.emissiveIntensity = active ? 2.4 : 0.5;
        }
      });
    });
  }

  /** Dim the marks while the line is dormant (lobby); full bright once armed. */
  setActive(active: boolean): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (mat && "opacity" in mat) {
        mat.transparent = !active;
        mat.opacity = active ? 1 : 0.22;
      }
    });
  }

  /** Let the marks ride the swell so they bob with the boats. */
  floatOnWaves(heightAt: (x: number, z: number) => number): void {
    this.marks.forEach((mark, i) => {
      const cp = this.checkpoints[i];
      mark.position.y = heightAt(cp.x, cp.z);
    });
  }

  /**
   * Returns true if (x, z) is within the capture radius of the given mark.
   * Caller is responsible for only checking the mark it expects next.
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

  markKind(index: number): "line" | "buoy" {
    return this.checkpoints[index]?.kind ?? "buoy";
  }

  checkpoint(index: number): Checkpoint | undefined {
    return this.checkpoints[index];
  }
}
