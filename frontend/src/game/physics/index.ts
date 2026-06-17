/**
 * Boat physics foundation. A fixed-timestep, force-based simulation:
 *
 *   PhysicsWorld  — the loop: sample environment → run forces → integrate → collide
 *   BoatState     — momentum-carrying state (position, velocity, heading, spin)
 *   Environment   — wind / current / wave fields sampled at the boat
 *   forces/       — one Force per element (sail, hull, steering, drift, wave, …)
 *   collision/    — bounds + obstacle resolution
 *   tuning.ts     — all feel constants, per game mode
 *
 * Extend by adding a Force (and maybe a Field) and registering it; nothing else
 * needs to change. See forces/Force.ts for the contract.
 */
export { PhysicsWorld } from "./PhysicsWorld";
export { BoatState } from "./BoatState";
export { Environment } from "./environment/Environment";
export { WindField } from "./environment/WindField";
export { CurrentField } from "./environment/CurrentField";
export { WaveField } from "./environment/WaveField";
export type { WaveSampler } from "./environment/WaveField";
export { CollisionWorld } from "./collision/CollisionWorld";
export type { CircleObstacle } from "./collision/CollisionWorld";
export { CASUAL_TUNING, SPEED_TUNING } from "./tuning";
export type { PhysicsTuning } from "./tuning";
export type { Force } from "./forces/Force";
export type { BoatInput, EnvSample, ForceAccumulator } from "./types";
