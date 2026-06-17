import * as THREE from "three";

/**
 * The wind across the arena: a base breeze plus slow large-scale shifts and
 * faster travelling gust cells, so the wind both varies from place to place and
 * changes over time. Sampling writes into a caller-provided vector to stay
 * allocation-free in the physics loop.
 *
 * This is intentionally simple (a sum of sines). Swap the body for noise, a
 * texture lookup, or server-broadcast wind later without changing callers.
 */
export class WindField {
  private baseAngle: number;

  constructor(
    baseDir: THREE.Vector2,
    private baseSpeed = 1,
  ) {
    this.baseAngle = Math.atan2(baseDir.x, baseDir.y);
  }

  /** Fill `out` with the air velocity at (x, z, t); returns its magnitude. */
  sample(x: number, z: number, t: number, out: THREE.Vector2): number {
    // Direction drifts slowly and differs across the map.
    const shift =
      0.25 * Math.sin(t * 0.05 + x * 0.0012) +
      0.15 * Math.sin(t * 0.13 + z * 0.0017);
    const angle = this.baseAngle + shift;

    // Strength: base modulated by travelling gust cells.
    const gust =
      0.2 * Math.sin(t * 0.6 + x * 0.004 + z * 0.003) +
      0.12 * Math.sin(t * 1.1 - x * 0.006);
    const speed = Math.max(0.2, this.baseSpeed * (1 + gust));

    out.set(Math.sin(angle) * speed, Math.cos(angle) * speed);
    return speed;
  }
}
