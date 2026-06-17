import { BoatState } from "../BoatState";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";

/**
 * One contributor to a boat's motion. A force reads the boat state, the sampled
 * environment and the player input, and *adds* its linear force and yaw torque
 * into the accumulator — it never integrates or mutates the boat directly. That
 * keeps forces order-independent and trivially composable: adding wind, a
 * powerup boost, a collision impulse or an AI assist is just one more `Force`
 * registered with the world.
 */
export interface Force {
  /** Stable id, handy for debugging/toggling. */
  readonly name: string;
  apply(
    boat: BoatState,
    env: EnvSample,
    input: BoatInput,
    dt: number,
    acc: ForceAccumulator,
  ): void;
}
