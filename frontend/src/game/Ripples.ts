import * as THREE from "three";

/** A point on the water that a stationary floating object disturbs: the foam
 *  spreads radially out to `radius + REACH`. */
export interface RippleSource {
  x: number;
  z: number;
  radius: number; // waterline footprint radius of the object
}

const SEG = 36; // radial segments per ripple disc
const REACH = 10; // how far past the footprint the foam rings spread

/**
 * Concentric foam rings around stationary floating marks (buoys, gate bases) —
 * the disturbance a bobbing object leaves when it isn't moving anywhere. Each
 * source gets a flat disc whose vertices ride the swell (height sampled on the
 * CPU each frame, like the boat wake) so the foam sits on the visible water; a
 * small self-contained shader paints a bright collar hugging the object plus
 * rings expanding outward and fading. Radially symmetric — the no-current case
 * (with a current these would stream downstream instead).
 *
 * Sources are fixed at construction (marks don't translate), so only the
 * vertex heights are rewritten per frame. Add `mesh` to the scene; call
 * `update()` every frame.
 */
export class Ripples {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  private positions: Float32Array;
  private baseXZ: Float32Array; // fixed world (x, z) per vertex; y rides the swell
  private material: THREE.ShaderMaterial;

  constructor(sources: RippleSource[]) {
    const vps = SEG + 1; // a centre vertex + one fan rim per source
    const count = sources.length * vps;
    this.positions = new Float32Array(count * 3);
    this.baseXZ = new Float32Array(count * 2);
    const aR = new Float32Array(count); // 0 at centre, 1 at the rim
    const aFoot = new Float32Array(count); // footprint as a fraction of the reach
    const aPhase = new Float32Array(count); // per-source ring phase offset
    const index: number[] = [];

    sources.forEach((src, s) => {
      const reach = src.radius + REACH;
      const foot = src.radius / reach;
      const phase = s * 1.7;
      const base = s * vps;

      this.setXZ(base, src.x, src.z); // centre
      aR[base] = 0;
      aFoot[base] = foot;
      aPhase[base] = phase;

      for (let k = 0; k < SEG; k++) {
        const i = base + 1 + k;
        const ang = (k / SEG) * Math.PI * 2;
        this.setXZ(i, src.x + Math.cos(ang) * reach, src.z + Math.sin(ang) * reach);
        aR[i] = 1;
        aFoot[i] = foot;
        aPhase[i] = phase;
      }

      for (let k = 0; k < SEG; k++) {
        const a = base + 1 + k;
        const b = base + 1 + ((k + 1) % SEG);
        index.push(base, a, b);
      }
    });

    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute("aR", new THREE.BufferAttribute(aR, 1));
    this.geometry.setAttribute("aFoot", new THREE.BufferAttribute(aFoot, 1));
    this.geometry.setAttribute("aPhase", new THREE.BufferAttribute(aPhase, 1));
    this.geometry.setIndex(index);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // A flat decal on the water: the fan winds front-face-down, and it's seen
      // from above, so render both sides rather than culling it away.
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xeaf6ff) },
      },
      vertexShader: /* glsl */ `
        attribute float aR;
        attribute float aFoot;
        attribute float aPhase;
        varying float vR;
        varying float vFoot;
        varying float vPhase;
        void main() {
          vR = aR;
          vFoot = aFoot;
          vPhase = aPhase;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying float vR;
        varying float vFoot;
        varying float vPhase;
        void main() {
          // Bright foam collar hugging the object's waterline.
          float collar = exp(-pow((vR - vFoot) / 0.10, 2.0));
          // Rings expanding outward from the footprint, fading toward the rim.
          float beyond = clamp((vR - vFoot) / (1.0 - vFoot), 0.0, 1.0);
          float rings = sin(beyond * 16.0 - uTime * 2.4 + vPhase);
          float ripple = smoothstep(0.4, 0.95, rings)
            * (1.0 - beyond) * smoothstep(0.0, 0.12, beyond);
          float a = max(collar * 0.85, ripple * 0.55);
          a *= 1.0 - smoothstep(0.82, 1.0, vR); // fade the disc edge to nothing
          if (a <= 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // draw over the water, with the boat wake
  }

  private setXZ(i: number, x: number, z: number): void {
    this.positions[i * 3] = x;
    this.positions[i * 3 + 2] = z;
    this.baseXZ[i * 2] = x;
    this.baseXZ[i * 2 + 1] = z;
  }

  /** Ride the swell + advance the ripple animation. */
  update(time: number, heightAt: (x: number, z: number) => number): void {
    const n = this.positions.length / 3;
    for (let i = 0; i < n; i++) {
      const x = this.baseXZ[i * 2];
      const z = this.baseXZ[i * 2 + 1];
      this.positions[i * 3 + 1] = heightAt(x, z) + 0.25;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.material.uniforms.uTime.value = time;
  }
}
