import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * Water current carries the boat along with it. Modelled as drag toward the
 * local current velocity, so a crosscurrent sets you off your line and you have
 * to point upstream to hold a course. A no-op while `currentCoupling` is 0.
 */
export class DriftForce implements Force {
  readonly name = "drift";

  constructor(private t: PhysicsTuning) {}

  apply(
    boat: BoatState,
    env: EnvSample,
    _input: BoatInput,
    _dt: number,
    acc: ForceAccumulator,
  ): void {
    if (this.t.currentCoupling <= 0) return;
    acc.force.x += (env.current.x - boat.vel.x) * this.t.currentCoupling;
    acc.force.y += (env.current.y - boat.vel.y) * this.t.currentCoupling;
  }
}
