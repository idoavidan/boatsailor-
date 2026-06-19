import * as THREE from "three";
import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * Downwind surfing. A swell travelling faster than the boat overtakes it; while
 * the boat sits on the swell's leading (downwind) face, the wave does work on it
 * and hands over momentum, accelerating it toward the wave's own speed. That is
 * surfing — modelled here as a force that pulls the boat's along-swell speed up
 * toward the swell celerity, rather than resolving the full pressure field.
 *
 * It's self-limiting and not an arbitrary boost: the pull is proportional to how
 * much *slower* than the wave you are, so it fades to nothing as you match the
 * swell and never pushes you past it. To ride, you must be on the leading face
 * and pointed downwind — so the emergent play is to bear away onto the face and
 * angle along it to stretch the ride, exactly like the real thing.
 */
export class SurfForce implements Force {
  readonly name = "surf";
  /** Softness of the "on the leading face" gate, in swell-slope units. */
  private static readonly FACE_WIDTH = 0.02;
  private fwd = new THREE.Vector2();

  constructor(private t: PhysicsTuning) {}

  apply(
    boat: BoatState,
    env: EnvSample,
    _input: BoatInput,
    _dt: number,
    acc: ForceAccumulator,
  ): void {
    boat.surf = 0; // refreshed every substep; the renderer reads this telemetry
    if (this.t.surfCoupling <= 0) return;

    // Swell travel direction + speed (celerity).
    const celerity = env.swellVel.length();
    if (celerity < 1e-3) return;
    const dirX = env.swellVel.x / celerity;
    const dirY = env.swellVel.y / celerity;

    // Leading face? The swell surface falls away downwind when slope·dir < 0, so
    // sliding down it carries you with the wave. Gate smoothly on -(slope·dir).
    const slopeAlong = env.swellSlope.x * dirX + env.swellSlope.y * dirY;
    const faceGate = THREE.MathUtils.smoothstep(
      -slopeAlong,
      0,
      SurfForce.FACE_WIDTH,
    );
    if (faceGate <= 0) return;

    // Pointed downwind enough to catch it (1 = bow dead downwind, 0 = across).
    this.fwd.set(Math.sin(boat.heading), Math.cos(boat.heading));
    const headGate = THREE.MathUtils.smoothstep(
      this.fwd.x * dirX + this.fwd.y * dirY,
      0,
      0.5,
    );
    if (headGate <= 0) return;

    // On the face and pointed downwind = riding a wave (even once matched, when
    // the pull below has faded). This is the surf signal the HUD/wake read.
    boat.surf = faceGate * headGate;

    // How much slower than the wave you are, along its travel direction. The
    // wave only adds energy while you trail it — once you match it the pull is
    // gone, so it can't drive you past the swell speed.
    const along = boat.vel.x * dirX + boat.vel.y * dirY;
    const deficit = celerity - along;
    if (deficit <= 0) return;

    const f = this.t.surfCoupling * faceGate * headGate * deficit;
    acc.force.x += f * dirX;
    acc.force.y += f * dirY;
  }
}
