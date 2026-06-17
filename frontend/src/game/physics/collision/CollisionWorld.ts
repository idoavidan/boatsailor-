import * as THREE from "three";
import { BoatState } from "../BoatState";

export interface CircleObstacle {
  x: number;
  z: number;
  radius: number;
}

/**
 * Positional collision resolution on the XZ plane, run after integration each
 * substep. Handles the soft arena boundary and static circular obstacles
 * (buoys, rocks): it pushes the boat out of any overlap and removes the
 * velocity component heading into the obstacle, with a little restitution so
 * hits feel bouncy rather than sticky.
 *
 * Boat-vs-boat (dynamic) collision is the natural next step: pass the other
 * hulls in as moving circles and resolve each pair here with a shared impulse.
 * Kept out for now because remote boats are interpolated, not simulated.
 */
export class CollisionWorld {
  readonly obstacles: CircleObstacle[] = [];
  private normal = new THREE.Vector2();

  constructor(
    private bounds: number,
    private boatRadius: number,
    private restitution = 0.3,
  ) {}

  addObstacle(o: CircleObstacle): void {
    this.obstacles.push(o);
  }

  resolve(boat: BoatState): void {
    // Static circular obstacles.
    for (const o of this.obstacles) {
      this.normal.set(boat.pos.x - o.x, boat.pos.y - o.z);
      const dist = this.normal.length();
      const minDist = o.radius + this.boatRadius;
      if (dist > 1e-4 && dist < minDist) {
        this.normal.divideScalar(dist); // unit push-out direction
        boat.pos.addScaledVector(this.normal, minDist - dist);
        const intoObstacle = boat.vel.dot(this.normal);
        if (intoObstacle < 0) {
          boat.vel.addScaledVector(this.normal, -intoObstacle * (1 + this.restitution));
        }
      }
    }

    // Soft arena boundary: clamp position and reflect the outward velocity.
    const b = this.bounds;
    if (boat.pos.x > b || boat.pos.x < -b) {
      boat.pos.x = THREE.MathUtils.clamp(boat.pos.x, -b, b);
      boat.vel.x *= -this.restitution;
    }
    if (boat.pos.y > b || boat.pos.y < -b) {
      boat.pos.y = THREE.MathUtils.clamp(boat.pos.y, -b, b);
      boat.vel.y *= -this.restitution;
    }
  }
}
