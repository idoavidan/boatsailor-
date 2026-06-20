import * as THREE from "three";
import { Checkpoint, WORLD } from "../protocol";
import type { RippleSource } from "./Ripples";

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

/** How hard a buoy heels to the wave slope — pushed a touch past true so the
 *  small float visibly rocks rather than just bobbing flat on the swell. */
const BUOY_TILT = 1.6;
/** Fore/aft tilt of the start gate as the swell runs through it. */
const GATE_PITCH = 1.2;

/** Wave height + (optional) surface slope at a world point, sampled at the
 *  current time. Same field the boat physics rides, so marks sit on the water
 *  the player actually sees. */
type Sampler = (x: number, z: number, outSlope?: THREE.Vector2) => number;

export class Course {
  readonly group = new THREE.Group();
  private marks: THREE.Group[] = [];
  private lineMats: THREE.MeshStandardMaterial[] = [];
  private lineRole: LineRole | "" = "";
  private readonly half = WORLD.startLineHalf;
  private slope = new THREE.Vector2();

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
    const half = WORLD.startLineHalf;
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

  /**
   * Ride the swell so the marks float like real ground tackle, not flat decals.
   *  - A buoy bobs to the wave height under it and heels to the local slope, so
   *    it rocks on the crest it's sitting on.
   *  - The start/finish gate spans two bases ~2·half apart, so it can't sit flat
   *    on a moving surface: each base is sampled on its own, the gate floats at
   *    their mean height and rolls across the line by the exact angle that lands
   *    each post back on its base's wave height (so the span bridges the swell),
   *    plus a gentle fore/aft pitch as crests run through it.
   *
   * Visual only — the marks are kinematic. But the height/slope come from the
   * same wave field the boat physics integrates, so they never drift apart.
   */
  floatOnWaves(sample: Sampler): void {
    this.marks.forEach((mark, i) => {
      const cp = this.checkpoints[i];
      if (cp.kind === "line") this.floatGate(mark, cp, sample);
      else this.floatBuoy(mark, cp, sample);
    });
  }

  /** Where each stationary mark disturbs the water: one ripple per buoy, two
   *  per start/finish gate (it floats on two bases, so it foams at both). */
  rippleSources(): RippleSource[] {
    const out: RippleSource[] = [];
    for (const cp of this.checkpoints) {
      if (cp.kind === "buoy") {
        out.push({ x: cp.x, z: cp.z, radius: 5 });
      } else {
        const ox = this.half * Math.cos(cp.angle);
        const oz = -this.half * Math.sin(cp.angle);
        out.push({ x: cp.x + ox, z: cp.z + oz, radius: 3.2 });
        out.push({ x: cp.x - ox, z: cp.z - oz, radius: 3.2 });
      }
    }
    return out;
  }

  /** A single buoy: sit on the wave height, heel to the wave slope. */
  private floatBuoy(mark: THREE.Group, cp: Checkpoint, sample: Sampler): void {
    const s = this.slope;
    mark.position.y = sample(cp.x, cp.z, s);
    // Same heel convention as the hull: resolve the world slope into the mark's
    // along/across axes, pitch with the fore-aft component, roll with the side.
    const a = cp.angle;
    const fwd = s.x * Math.sin(a) + s.y * Math.cos(a);
    const side = s.x * Math.cos(a) - s.y * Math.sin(a);
    mark.rotation.set(-fwd * BUOY_TILT, a, side * BUOY_TILT, "YXZ");
  }

  /** The two-base start/finish gate — see {@link floatOnWaves}. */
  private floatGate(mark: THREE.Group, cp: Checkpoint, sample: Sampler): void {
    const a = cp.angle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // The line (base-to-base) axis is the gate's local +X, which maps to world
    // (ca, -sa); the posts sit half on each side of the centre.
    const ox = this.half * ca;
    const oz = -this.half * sa;
    const hR = sample(cp.x + ox, cp.z + oz); // +X base
    const hL = sample(cp.x - ox, cp.z - oz); // -X base
    sample(cp.x, cp.z, this.slope); // centre slope, for the fore/aft pitch

    mark.position.y = (hL + hR) * 0.5;
    // atan2(rise, run) over the full span tilts the gate so the +half / -half
    // posts land exactly on hR / hL — the rigid gate bridges the two crests.
    const roll = Math.atan2(hR - hL, this.half * 2);
    const fwd = this.slope.x * sa + this.slope.y * ca;
    mark.rotation.set(-fwd * GATE_PITCH, a, roll, "YXZ");
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
