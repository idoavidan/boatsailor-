import * as THREE from "three";
import { BoatState } from "./BoatState";
import { CollisionWorld } from "./collision/CollisionWorld";
import { Environment } from "./environment/Environment";
import { DriftForce } from "./forces/DriftForce";
import { Force } from "./forces/Force";
import { HullForce } from "./forces/HullForce";
import { SailForce } from "./forces/SailForce";
import { SteeringForce } from "./forces/SteeringForce";
import { WaveForce } from "./forces/WaveForce";
import { PhysicsTuning } from "./tuning";
import { BoatInput, ForceAccumulator } from "./types";

/** Physics substep length. Fixed and small for a stable, framerate-independent
 *  sim (the render loop can run at any rate). */
const FIXED_DT = 1 / 120;
/** Cap on substeps per frame, so a long stall (tab in background) can't trigger
 *  a "spiral of death" trying to catch up. */
const MAX_SUBSTEPS = 8;

/**
 * Fixed-timestep boat simulation and the heart of the foundation.
 *
 * Each substep: sample the {@link Environment} at the boat → let every
 * registered {@link Force} deposit a contribution → integrate (semi-implicit
 * Euler) → resolve collisions. To add an element you write a Force (and maybe a
 * Field) and register it — the loop, integrator and the rest of the game don't
 * change. This separation also makes the sim portable to the server later for
 * authoritative physics / reconciliation.
 */
export class PhysicsWorld {
  readonly boat = new BoatState();
  private forces: Force[];
  private acc: ForceAccumulator = { force: new THREE.Vector2(), torque: 0 };
  private leftover = 0;

  constructor(
    private tuning: PhysicsTuning,
    readonly environment: Environment,
    readonly collision: CollisionWorld,
  ) {
    // Order is irrelevant (forces only accumulate), but read top-to-bottom it's
    // engine → resistance → steering → environment.
    this.forces = [
      new SailForce(tuning),
      new HullForce(tuning),
      new SteeringForce(tuning),
      new DriftForce(tuning),
      new WaveForce(tuning),
    ];
  }

  /** Register an extra force at runtime (powerups, collision impulses, AI…). */
  addForce(force: Force): void {
    this.forces.push(force);
  }

  /** Advance the sim by `dt` seconds of real time; `t` is elapsed seconds (for
   *  the time-varying fields). */
  step(input: BoatInput, dt: number, t: number): void {
    this.leftover += dt;
    let n = 0;
    while (this.leftover >= FIXED_DT && n < MAX_SUBSTEPS) {
      this.substep(input, FIXED_DT, t);
      this.leftover -= FIXED_DT;
      n++;
    }
    if (n === MAX_SUBSTEPS) this.leftover = 0; // drop the backlog after a stall
  }

  private substep(input: BoatInput, h: number, t: number): void {
    const env = this.environment.sample(this.boat.x, this.boat.z, t);

    this.acc.force.set(0, 0);
    this.acc.torque = 0;
    for (const f of this.forces) f.apply(this.boat, env, input, h, this.acc);

    // Semi-implicit Euler: update velocities first, then positions.
    this.boat.vel.addScaledVector(this.acc.force, h / this.tuning.mass);
    this.boat.angVel += (this.acc.torque / this.tuning.inertia) * h;

    // Hard safety cap so a gust or a bug can never run the boat away.
    const cap = this.tuning.maxSpeed * 1.3;
    if (this.boat.vel.length() > cap) this.boat.vel.setLength(cap);

    this.boat.heading += this.boat.angVel * h;
    this.boat.pos.addScaledVector(this.boat.vel, h);

    this.collision.resolve(this.boat);
  }
}
