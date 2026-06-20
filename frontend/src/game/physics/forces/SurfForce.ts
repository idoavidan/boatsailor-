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
  /** Catch window: you must already be moving along the swell at least
   *  CATCH_LO·celerity to start picking it up, fully by CATCH_HI·celerity. */
  private static readonly CATCH_LO = 0.45;
  private static readonly CATCH_HI = 0.7;
  /** Surf drives you to at most this fraction of the wave's own speed, never
   *  matching it — so the crest keeps inching ahead, slides under you, and the
   *  ride always ends. (Raise toward 1 for longer rides, lower for shorter.) */
  private static readonly SPEED_CAP = 0.92;
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

    // You have to already be carrying speed along the swell to get picked up —
    // like paddling up to wave speed. Below CATCH_LO·celerity it won't catch at
    // all, so you can't surf from a near-standstill or while crossing the wave.
    // This is the "needs speed *and* the right direction" gate.
    const along = boat.vel.x * dirX + boat.vel.y * dirY;
    const catchGate = THREE.MathUtils.smoothstep(
      along,
      SurfForce.CATCH_LO * celerity,
      SurfForce.CATCH_HI * celerity,
    );
    if (catchGate <= 0) return;

    // On the face, pointed downwind, and up to speed = riding a wave (even once
    // the pull below has faded). This is the surf signal the HUD/wake read.
    boat.surf = faceGate * headGate * catchGate;

    // Pull up toward a target just *under* the wave speed, never matching it, so
    // the wave keeps overtaking you: the crest slides forward, passes under the
    // hull onto the back face, and the ride ends — no surfing one swell forever
    // (and some waves you'll simply miss).
    const target = SurfForce.SPEED_CAP * celerity;
    const deficit = target - along;
    if (deficit <= 0) return;

    const f =
      this.t.surfCoupling * faceGate * headGate * catchGate * deficit;
    acc.force.x += f * dirX;
    acc.force.y += f * dirY;
  }
}
