import * as THREE from "three";
import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * The engine of the boat: the sail turns wind into forward thrust. Thrust is
 * strongest sailing with the wind and weakest (but never zero) sailing into it,
 * scaled by throttle (how much sail is up) and the *local* wind strength — so
 * gusts and wind shifts directly change your speed.
 *
 * This mirrors the old `windFactor` curve, re-expressed as a force so it feeds
 * momentum instead of setting speed directly. A fuller model would use apparent
 * wind and a real lift/drag polar; this keeps it arcade and predictable.
 */
export class SailForce implements Force {
  readonly name = "sail";
  private fwd = new THREE.Vector2();
  private windDir = new THREE.Vector2();

  constructor(private t: PhysicsTuning) {}

  apply(
    boat: BoatState,
    env: EnvSample,
    input: BoatInput,
    _dt: number,
    acc: ForceAccumulator,
  ): void {
    if (input.throttle <= 0 || env.windSpeed <= 0) return;

    this.fwd.set(Math.sin(boat.heading), Math.cos(boat.heading));
    this.windDir.copy(env.wind).divideScalar(env.windSpeed); // normalized

    const dot = this.fwd.dot(this.windDir); // 1 downwind, -1 into the wind
    const align = THREE.MathUtils.lerp(this.t.minWindFactor, 1, (dot + 1) / 2);
    const eff = THREE.MathUtils.lerp(1, align, this.t.windInfluence);

    const thrust = this.t.sailPower * input.throttle * eff * env.windSpeed;
    acc.force.addScaledVector(this.fwd, thrust);
  }
}
