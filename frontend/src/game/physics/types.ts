import * as THREE from "three";

/**
 * Shared physics types. Kept dependency-free so forces, fields and the world
 * can all import them without cycles.
 *
 * Convention: the simulation lives on the XZ plane. A `THREE.Vector2` always
 * means `(worldX, worldZ)` — i.e. `.x` is world X and `.y` is world Z. Heading
 * is yaw in radians with 0 = +Z, so the bow direction is `(sin h, cos h)`.
 */

/** Player input for one tick. */
export interface BoatInput {
  throttle: number; // 0..1 (sail trim / how much sail is up)
  brake: number; // 0..1
  rudder: number; // -1..1 (left..right)
}

/** A sample of the environment at one point in space and time. Reused per step. */
export interface EnvSample {
  wind: THREE.Vector2; // air velocity (direction * speed)
  windSpeed: number; // |wind|, cached for convenience
  current: THREE.Vector2; // water velocity
  waveHeight: number; // surface height at the point
  waveSlope: THREE.Vector2; // surface gradient (dh/dx, dh/dz)
}

/** Where forces deposit their contribution each substep. Cleared per substep. */
export interface ForceAccumulator {
  force: THREE.Vector2; // world-frame linear force
  torque: number; // yaw torque (+ increases heading)
}
