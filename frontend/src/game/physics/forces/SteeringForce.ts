import * as THREE from "three";
import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * The rudder, plus a touch of sailing character. Turning needs water flowing
 * over the blade, so rudder authority scales with speed — a dead-stopped boat
 * barely turns (and stalled head-to-wind you lose steerage). Yaw damping settles
 * the turn rate. On top, a gentle "weather helm" rounds the bow up toward the
 * wind, so holding a course takes a little active steering — it makes the boat
 * feel like it's sailing rather than driving.
 *
 * Sign note: the chase camera looks down +Z, so steering right (rudder > 0)
 * must *decrease* heading to curve the boat to the player's right.
 */
export class SteeringForce implements Force {
  readonly name = "steering";

  constructor(private t: PhysicsTuning) {}

  apply(
    boat: BoatState,
    env: EnvSample,
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

    // Weather helm: round the bow up toward where the wind comes from, so
    // holding a course needs a little correction.
    if (this.t.weatherHelm > 0 && env.windSpeed > 0) {
      const wdx = env.wind.x / env.windSpeed;
      const wdz = env.wind.y / env.windSpeed;
      const fx = Math.sin(boat.heading);
      const fz = Math.cos(boat.heading);
      // (forward × windDir).z — torque that turns the bow toward the wind's eye.
      const toWind = fx * wdz - fz * wdx;
      acc.torque += this.t.weatherHelm * toWind * flow;
    }
  }
}
