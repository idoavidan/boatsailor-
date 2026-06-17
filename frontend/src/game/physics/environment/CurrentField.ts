import * as THREE from "three";

/**
 * A gentle water current that varies slowly over the map. Defaults to zero
 * strength (no current) so it's a no-op until a map turns it on; raise
 * `baseSpeed` and the boat starts getting set off its line by the flow.
 */
export class CurrentField {
  private baseAngle: number;

  constructor(
    baseDir = new THREE.Vector2(1, 0),
    private baseSpeed = 0,
  ) {
    this.baseAngle = Math.atan2(baseDir.x, baseDir.y);
  }

  /** Fill `out` with the water velocity at (x, z, t). */
  sample(x: number, z: number, t: number, out: THREE.Vector2): void {
    if (this.baseSpeed === 0) {
      out.set(0, 0);
      return;
    }
    const swirl = 0.4 * Math.sin(t * 0.04 + x * 0.001 - z * 0.001);
    const angle = this.baseAngle + swirl;
    const speed = this.baseSpeed * (1 + 0.3 * Math.sin(t * 0.07 + z * 0.0009));
    out.set(Math.sin(angle) * speed, Math.cos(angle) * speed);
  }
}
