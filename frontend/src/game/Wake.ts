import * as THREE from "three";

const MAX_POINTS = 48; // trail length cap
const LIFETIME = 1.5; // seconds a trail point lingers
const MIN_STEP = 2.2; // world distance between emitted points
const MIN_SPEED = 4; // don't emit a wake when basically stopped

interface TrailPoint {
  x: number;
  z: number;
  life: number; // 1 (fresh) -> 0 (gone)
  width: number;
}

/**
 * A foam wake trailing behind the boat: a tapering, fading ribbon of recent
 * stern positions that rides the swell. Pure visual — world-space geometry
 * rebuilt each frame, no physics. Add `wake.mesh` to the scene and call
 * `update()` every frame; call `reset()` on teleport so it doesn't streak.
 */
export class Wake {
  readonly mesh: THREE.Mesh;
  private points: TrailPoint[] = [];
  private positions: Float32Array;
  private alphas: Float32Array;
  private geometry: THREE.BufferGeometry;
  private lastX = 0;
  private lastZ = 0;
  private seeded = false;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_POINTS * 2 * 3);
    this.alphas = new Float32Array(MAX_POINTS * 2);
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(this.alphas, 1),
    );

    // Two triangles per segment between consecutive trail points.
    const index: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    this.geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // The ribbon lies flat and winds front-face-down, but it's viewed from
      // above — render both sides so it isn't culled away.
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xeaf6ff) } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.002) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // draw over the water
  }

  /** Clear the trail (e.g. after a teleport to the start grid). */
  reset(): void {
    this.points.length = 0;
    this.seeded = false;
    this.geometry.setDrawRange(0, 0);
  }

  /** Free GPU resources (call when the owning boat leaves). */
  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  update(
    x: number,
    z: number,
    heading: number,
    speed: number,
    dt: number,
    heightAt: (x: number, z: number) => number,
  ): void {
    // Age out old points.
    for (const p of this.points) p.life -= dt / LIFETIME;
    while (this.points.length && this.points[0].life <= 0) this.points.shift();

    // Emit from the stern when moving far enough.
    const sx = x - Math.sin(heading) * 5.5;
    const sz = z - Math.cos(heading) * 5.5;
    if (!this.seeded) {
      this.lastX = sx;
      this.lastZ = sz;
      this.seeded = true;
    }
    const moved = Math.hypot(sx - this.lastX, sz - this.lastZ);
    if (speed > MIN_SPEED && moved >= MIN_STEP && this.points.length < MAX_POINTS) {
      this.points.push({
        x: sx,
        z: sz,
        life: 1,
        width: 2.4 + Math.min(speed, 110) * 0.05,
      });
      this.lastX = sx;
      this.lastZ = sz;
    }

    this.rebuild(heightAt);
  }

  private rebuild(heightAt: (x: number, z: number) => number): void {
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const prev = this.points[Math.max(0, i - 1)];
      const next = this.points[Math.min(n - 1, i + 1)];

      // Tangent along the trail, then the perpendicular (ribbon width axis).
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const px = -tz;
      const pz = tx;

      // Spread wider toward the tail for a V; sit just above the water surface.
      const spread = p.width * (1 + (1 - p.life) * 1.6);
      const y = heightAt(p.x, p.z) + 0.15;
      const a = p.life * 0.6;

      const o = i * 2;
      this.positions[o * 3] = p.x + px * spread;
      this.positions[o * 3 + 1] = y;
      this.positions[o * 3 + 2] = p.z + pz * spread;
      this.positions[(o + 1) * 3] = p.x - px * spread;
      this.positions[(o + 1) * 3 + 1] = y;
      this.positions[(o + 1) * 3 + 2] = p.z - pz * spread;
      this.alphas[o] = a;
      this.alphas[o + 1] = a;
    }

    this.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
