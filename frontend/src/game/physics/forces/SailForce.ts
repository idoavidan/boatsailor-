import * as THREE from "three";
import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * The engine of the boat: the sail turns wind into forward thrust, following a
 * simple sailing polar.
 *
 *   - Point within `noGoAngle` of straight upwind and the sail luffs — almost no
 *     drive (`sailFloor`), so you crawl. To make ground upwind you must tack
 *     (zig-zag across the wind).
 *   - Bear away onto a reach (~beam-on) and the sail fills for full power.
 *   - Running downwind also draws well.
 *
 * Thrust scales by throttle (how much sail is up) and the local wind strength,
 * so gusts and shifts change your speed.
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
    this.windDir.copy(env.wind).divideScalar(env.windSpeed); // blowing-toward

    // Apparent wind angle off the bow: 0 = pointing straight into the wind
    // (no-go), π = running dead downwind.
    const awa = Math.acos(THREE.MathUtils.clamp(-this.fwd.dot(this.windDir), -1, 1));
    const draw = THREE.MathUtils.lerp(
      this.t.sailFloor,
      1,
      THREE.MathUtils.smoothstep(awa, this.t.noGoAngle, this.t.noGoAngle + 0.5),
    );

    const thrust = this.t.sailPower * input.throttle * draw * env.windSpeed;
    acc.force.addScaledVector(this.fwd, thrust);
  }
}
