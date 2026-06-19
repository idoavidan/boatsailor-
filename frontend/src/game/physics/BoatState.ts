import * as THREE from "three";

/**
 * The dynamic state of one vessel on the XZ plane. Unlike the old kinematic
 * model (which set speed directly), this carries real linear and angular
 * momentum — velocity and yaw rate persist between frames, so the boat coasts,
 * drifts, and resists sudden changes. Forces in `forces/` are the only things
 * that change it (via the integrator in PhysicsWorld).
 */
export class BoatState {
  /** Position on the plane: (.x = world X, .y = world Z). */
  readonly pos = new THREE.Vector2();
  /** World-frame velocity: (.x = vX, .y = vZ). */
  readonly vel = new THREE.Vector2();
  /** Yaw in radians, 0 = +Z. */
  heading = 0;
  /** Yaw rate in rad/s. */
  angVel = 0;
  /** Telemetry (written by SurfForce, read by the renderer): how strongly the
   *  boat is riding a wave right now, 0 = not surfing … 1 = fully on the face. */
  surf = 0;

  get x(): number {
    return this.pos.x;
  }
  get z(): number {
    return this.pos.y;
  }

  /** Ground speed (magnitude of velocity). */
  get speed(): number {
    return this.vel.length();
  }

  /** Signed speed along the bow — how fast the boat is actually moving ahead. */
  get forwardSpeed(): number {
    return (
      this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading)
    );
  }

  /** Teleport to a pose and kill all motion (start grid, respawn). */
  setPose(x: number, z: number, heading: number): void {
    this.pos.set(x, z);
    this.heading = heading;
    this.vel.set(0, 0);
    this.angVel = 0;
    this.surf = 0;
  }
}
