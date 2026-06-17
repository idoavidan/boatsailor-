import * as THREE from "three";

/**
 * Builds a simple stylized sailboat (hull + deck + mast + sail + flag) from
 * primitives, tinted by the player's hull color. Returns a Group whose +Z is
 * "forward".
 */
export function createBoatMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.1,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x8d6748,
    roughness: 0.8,
  });
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });

  // Hull: a stretched, tapered box. ConeGeometry gives a pointed bow.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 11), hullMat);
  hull.position.y = 0.4;
  group.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 4), hullMat);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 0.4, 7);
  bow.scale.set(1, 0.4, 1);
  group.add(bow);

  // Deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 9), woodMat);
  deck.position.y = 1.2;
  group.add(deck);

  // Mast
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 12, 8),
    woodMat,
  );
  mast.position.set(0, 7, 0.5);
  group.add(mast);

  // Main sail: a triangle from mast top to the boom.
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 9);
  sailShape.lineTo(-5, 0);
  sailShape.lineTo(0, 0);
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat);
  sail.rotation.y = Math.PI / 2;
  sail.position.set(0, 1.8, 0.5);
  group.add(sail);

  // Jib (front sail)
  const jibShape = new THREE.Shape();
  jibShape.moveTo(0, 0);
  jibShape.lineTo(0, 6);
  jibShape.lineTo(3.5, 0);
  jibShape.lineTo(0, 0);
  const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sailMat);
  jib.rotation.y = Math.PI / 2;
  jib.position.set(0, 1.6, 4.5);
  group.add(jib);

  // Flag at the masthead, tinted to the hull color.
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 1),
    new THREE.MeshStandardMaterial({
      color,
      side: THREE.DoubleSide,
      roughness: 0.7,
    }),
  );
  flag.position.set(-1, 12.5, 0.5);
  group.add(flag);

  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return group;
}

/**
 * Tunable arcade sailing physics for the local boat. Wind matters: sailing
 * with the wind is fast, sailing straight into it is slow (but never fully
 * stalled, so the boat stays controllable).
 */
export interface BoatTuning {
  maxSpeed: number;
  acceleration: number;
  braking: number;
  drag: number;
  turnRate: number; // radians/sec at full speed
  windInfluence: number; // 0 = wind ignored, 1 = wind dominates max speed
  minWindFactor: number; // speed multiplier when sailing into the wind
}

export const CASUAL_TUNING: BoatTuning = {
  maxSpeed: 70,
  acceleration: 22,
  braking: 45,
  drag: 8,
  turnRate: 1.5,
  windInfluence: 0.4,
  minWindFactor: 0.55,
};

export const SPEED_TUNING: BoatTuning = {
  maxSpeed: 110,
  acceleration: 34,
  braking: 60,
  drag: 6,
  turnRate: 1.9,
  windInfluence: 0.5,
  minWindFactor: 0.5,
};

export interface BoatInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  rudder: number; // -1..1 (left..right)
}

/**
 * Holds and integrates the local boat's kinematic state. Position is on the
 * XZ plane; heading is yaw in radians (0 = +Z).
 */
export class BoatBody {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;

  constructor(
    private tuning: BoatTuning,
    private windDir: THREE.Vector2,
  ) {}

  setWind(dir: THREE.Vector2): void {
    this.windDir.copy(dir).normalize();
  }

  /** Speed multiplier based on how aligned the heading is with the wind. */
  windFactor(): number {
    const forward = new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
    // dot = 1 sailing downwind, -1 sailing into the wind.
    const dot = forward.dot(this.windDir);
    const t = (dot + 1) / 2; // 0..1
    const base = THREE.MathUtils.lerp(this.tuning.minWindFactor, 1, t);
    return THREE.MathUtils.lerp(1, base, this.tuning.windInfluence);
  }

  update(input: BoatInput, dt: number, bounds: number): void {
    const t = this.tuning;
    const targetSpeed = input.throttle * t.maxSpeed * this.windFactor();

    if (input.brake > 0) {
      this.speed -= t.braking * input.brake * dt;
    } else if (this.speed < targetSpeed) {
      this.speed += t.acceleration * dt;
    } else {
      this.speed -= t.drag * dt;
    }
    this.speed = THREE.MathUtils.clamp(this.speed, 0, t.maxSpeed);

    // Turn rate scales with speed so a dead-stopped boat barely turns.
    const speedRatio = THREE.MathUtils.clamp(this.speed / t.maxSpeed, 0.1, 1);
    this.heading += input.rudder * t.turnRate * speedRatio * dt;

    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    // Soft world boundary: bounce gently off the edge of the arena.
    if (Math.abs(this.x) > bounds) {
      this.x = THREE.MathUtils.clamp(this.x, -bounds, bounds);
      this.speed *= 0.5;
    }
    if (Math.abs(this.z) > bounds) {
      this.z = THREE.MathUtils.clamp(this.z, -bounds, bounds);
      this.speed *= 0.5;
    }
  }
}
