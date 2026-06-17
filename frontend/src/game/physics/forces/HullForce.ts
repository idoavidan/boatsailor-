import * as THREE from "three";
import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * Water resistance on the hull, and the single biggest source of "feel".
 * Anisotropic: low drag along the bow (you glide and carry momentum) but high
 * drag sideways, because the keel resists slipping — so the boat tracks its
 * heading and only skids when shoved hard (tight turns, collisions). Braking
 * adds forward drag.
 */
export class HullForce implements Force {
  readonly name = "hull";
  private fwd = new THREE.Vector2();
  private right = new THREE.Vector2();

  constructor(private t: PhysicsTuning) {}

  apply(
    boat: BoatState,
    _env: EnvSample,
    input: BoatInput,
    _dt: number,
    acc: ForceAccumulator,
  ): void {
    const h = boat.heading;
    this.fwd.set(Math.sin(h), Math.cos(h));
    this.right.set(Math.cos(h), -Math.sin(h));

    const vF = boat.vel.dot(this.fwd);
    const vR = boat.vel.dot(this.right);

    const fwdDrag =
      this.t.forwardDrag + this.t.brakeDrag * Math.max(0, input.brake);
    acc.force.addScaledVector(this.fwd, -fwdDrag * vF);
    acc.force.addScaledVector(this.right, -this.t.lateralDrag * vR);
  }
}
