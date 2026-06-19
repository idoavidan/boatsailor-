import * as THREE from "three";
import { EnvSample } from "../types";
import { CurrentField } from "./CurrentField";
import { WaveField } from "./WaveField";
import { WindField } from "./WindField";

/** The surf swell: its (constant) travel velocity and a sampler for its slope. */
export interface SwellSource {
  vel: THREE.Vector2; // dir * celerity, world units/sec
  // Fills outSlope with the swell layer's gradient; returns its height.
  sampler: (x: number, z: number, t: number, outSlope: THREE.Vector2) => number;
}

/**
 * Aggregates the spatial/temporal fields (wind, current, waves) into one sample
 * at the boat's position each substep. Adding a new environmental input (tide,
 * no-go zones, storm cells, oil slicks…) means adding a field and wiring it in
 * here — forces then read it from {@link EnvSample}.
 */
export class Environment {
  // Reused so sampling allocates nothing in the hot loop.
  private readonly out: EnvSample = {
    wind: new THREE.Vector2(),
    windSpeed: 0,
    current: new THREE.Vector2(),
    waveHeight: 0,
    waveSlope: new THREE.Vector2(),
    swellVel: new THREE.Vector2(),
    swellSlope: new THREE.Vector2(),
  };

  constructor(
    readonly wind: WindField,
    readonly current: CurrentField,
    readonly waves: WaveField,
    readonly swell: SwellSource,
  ) {}

  /**
   * Sample every field at (x, z, t). The returned object is reused between
   * calls — copy out anything you need to keep.
   */
  sample(x: number, z: number, t: number): EnvSample {
    this.out.windSpeed = this.wind.sample(x, z, t, this.out.wind);
    this.current.sample(x, z, t, this.out.current);
    this.out.waveHeight = this.waves.sample(x, z, t, this.out.waveSlope);
    this.out.swellVel.copy(this.swell.vel);
    this.swell.sampler(x, z, t, this.out.swellSlope);
    return this.out;
  }
}
