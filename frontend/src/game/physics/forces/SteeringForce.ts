import * as THREE from "three";
import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * The rudder. Turning needs water flowing over the blade, so authority scales
 * with speed — a dead-stopped boat barely turns. Yaw damping settles the turn
 * rate so it doesn't oscillate or spin forever.
 *
 * Sign note: the chase camera looks down +Z, so steering right (rudder > 0)
 * must *decrease* heading to curve the boat to the player's right.
 */
export class SteeringForce implements Force {
  readonly name = "steering";

  constructor(private t: PhysicsTuning) {}

  apply(
    boat: BoatState,
    _env: EnvSample,
    input: BoatInput,
    _dt: number,
    acc: ForceAccumulator,
  ): void {
    const flow = THREE.MathUtils.clamp(
      Math.abs(boat.forwardSpeed) / this.t.steerSpeedRef,
      0.05,
      1,
    );
    acc.torque += -input.rudder * this.t.turnTorque * flow;
    acc.torque += -this.t.yawDamping * boat.angVel;
  }
}
