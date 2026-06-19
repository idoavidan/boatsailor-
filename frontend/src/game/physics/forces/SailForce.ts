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
 *
 * Crucially the polar is read off the *apparent* wind (true wind minus the
 * boat's own motion), not the true wind. As the boat accelerates, the apparent
 * wind swings forward toward the bow and the angle off the bow shrinks — so a
 * fast boat must bear away to keep the sail drawing, while a slow boat has slack
 * to point higher. That single feedback is what makes working the waves pay off:
 * climbing a face you slow down → apparent wind frees → you can head up and
 * cross it short; over the top you accelerate → apparent wind heads you → you
 * bear away. The slalom emerges from the physics, with no scripted boost.
 */
export class SailForce implements Force {
  readonly name = "sail";
  private fwd = new THREE.Vector2();
  private windDir = new THREE.Vector2();
  private appWind = new THREE.Vector2();

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
    this.windDir.copy(env.wind).divideScalar(env.windSpeed); // true wind, blowing-toward

    // Apparent wind = true wind velocity minus the boat's velocity. `windRefSpeed`
    // puts the wind on the boat's velocity scale (env.windSpeed is only a ~1.0
    // strength multiplier, not a world-space speed), so the subtraction is
    // meaningful. At rest this reduces to the true wind; the faster you go, the
    // more it swings toward the bow.
    this.appWind
      .copy(this.windDir)
      .multiplyScalar(this.t.windRefSpeed)
      .sub(boat.vel);
    const appSpeed = this.appWind.length();
    if (appSpeed < 1e-4) return;
    const appDirX = this.appWind.x / appSpeed;
    const appDirY = this.appWind.y / appSpeed;

    // Apparent wind angle off the bow: 0 = pointing straight into the apparent
    // wind (no-go), π = running dead downwind.
    const awa = Math.acos(
      THREE.MathUtils.clamp(-(this.fwd.x * appDirX + this.fwd.y * appDirY), -1, 1),
    );
    const draw = THREE.MathUtils.lerp(
      this.t.sailFloor,
      1,
      THREE.MathUtils.smoothstep(awa, this.t.noGoAngle, this.t.noGoAngle + 0.5),
    );

    // The polar (angle) comes from the apparent wind, but the *power* still
    // tracks the true wind strength. Feeding apparent speed in here would let
    // thrust grow with boat speed and run away, since appSpeed rises with vel.
    const thrust = this.t.sailPower * input.throttle * draw * env.windSpeed;
    acc.force.addScaledVector(this.fwd, thrust);
  }
}
