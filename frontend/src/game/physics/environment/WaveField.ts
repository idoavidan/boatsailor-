import * as THREE from "three";

/**
 * Surface height + slope at a point. Backed by whatever renders the water (the
 * Ocean shader's CPU-side `sample`), so the physics rides exactly the surface
 * the player sees. Decoupled via a function so the physics never imports the
 * renderer.
 */
export type WaveSampler = (
  x: number,
  z: number,
  t: number,
  outSlope?: THREE.Vector2,
) => number;

export class WaveField {
  constructor(private sampler: WaveSampler) {}

  /** Returns the height at (x, z, t); fills `outSlope` with (dh/dx, dh/dz). */
  sample(x: number, z: number, t: number, outSlope: THREE.Vector2): number {
    return this.sampler(x, z, t, outSlope);
  }
}
