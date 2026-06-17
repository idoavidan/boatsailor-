import { BoatState } from "../BoatState";
import { PhysicsTuning } from "../tuning";
import { BoatInput, EnvSample, ForceAccumulator } from "../types";
import { Force } from "./Force";

/**
 * Wave faces tilt the boat and gravity tugs it down the slope, so it gets
 * nudged off steep crests and surfs slightly down the back of swells. Subtle by
 * design — raise `wavePush` in the tuning to make sea state matter more. The
 * visual pitch/roll of riding the wave is handled separately in the renderer;
 * this is only the in-plane shove.
 */
export class WaveForce implements Force {
  readonly name = "wave";

  constructor(private t: PhysicsTuning) {}

  apply(
    _boat: BoatState,
    env: EnvSample,
    _input: BoatInput,
    _dt: number,
    acc: ForceAccumulator,
  ): void {
    if (this.t.wavePush <= 0) return;
    // slope = (dh/dx, dh/dz); downhill is the negative gradient.
    acc.force.x += -env.waveSlope.x * this.t.wavePush;
    acc.force.y += -env.waveSlope.y * this.t.wavePush;
  }
}
