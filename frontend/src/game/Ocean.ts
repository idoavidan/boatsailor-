import * as THREE from "three";

interface WaveSpec {
  dir: THREE.Vector2; // normalized travel direction in the XZ plane
  freq: number;
  amp: number;
  speed: number;
}

/**
 * Wave layers as small angular offsets (radians) from the wind direction. The
 * swell travels broadly *with* the wind; the slightly different angles +
 * wavelengths interfere so each crest runs long then ends (finite wavefronts,
 * not infinite parallel lines). Widen the offsets for shorter crests.
 */
interface WaveLayer {
  offset: number; // angle off the wind direction
  freq: number;
  amp: number;
  speed: number;
}
// Steepness (amp * freq) is what the physics climbs — the slope force scales
// with it — so these are tuned steeper than a purely cosmetic sea would be,
// while keeping the total height (~5.5) and the shortest wavelength (~42 units,
// ≈ 4 mesh quads) so boats don't bob wildly and the surface stays smooth, not
// faceted. Wavelengths (2π / freq) run ~114 → ~42 units, a few boat lengths, so
// upwind you cross a face every couple of seconds — the slalom rhythm.
const WAVE_LAYERS: WaveLayer[] = [
  { offset: -0.01, freq: 0.055, amp: 2.6, speed: 1.6 }, // λ≈114, steepness .143
  { offset: -0.16, freq: 0.08, amp: 1.5, speed: 1.9 }, //  λ≈79,  steepness .120
  { offset: 0.15, freq: 0.11, amp: 0.9, speed: 2.1 }, //   λ≈57,  steepness .099
  { offset: 0.04, freq: 0.15, amp: 0.5, speed: 2.5 }, //   λ≈42,  steepness .075
];

/** Peak possible crest height (all waves in phase) — used to place foam. */
const WAVE_MAX = WAVE_LAYERS.reduce((sum, w) => sum + w.amp, 0);

/** Build the concrete wave set, rotating each layer off the wind direction. */
function buildWaves(windDir: THREE.Vector2): WaveSpec[] {
  const w = windDir.clone().normalize();
  return WAVE_LAYERS.map((l) => {
    const c = Math.cos(l.offset);
    const s = Math.sin(l.offset);
    return {
      dir: new THREE.Vector2(w.x * c - w.y * s, w.x * s + w.y * c),
      freq: l.freq,
      amp: l.amp,
      speed: l.speed,
    };
  });
}

/** Format a JS number as a GLSL float literal (always has a decimal point). */
function glslFloat(n: number): string {
  const s = String(n);
  return /[.e]/.test(s) ? s : s + ".0";
}

/**
 * A large animated ocean plane. Self-contained GLSL (no texture assets):
 * height is a sum of directional sine waves, normals are derived analytically
 * for lighting, and the surface fades to the sky color in the distance so the
 * plane edge is never visible.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private waves: WaveSpec[];

  constructor(
    size: number,
    skyColor: THREE.Color,
    sunDir: THREE.Vector3,
    windDir: THREE.Vector2,
  ) {
    // Waves travel with the wind so the swell and the sailing line up.
    this.waves = buildWaves(windDir);

    // Generate the shader's wave accumulation from the same spec the JS sampler
    // uses, so rendering and physics can never drift.
    const slopeDecl = this.waves.map((_, i) => `s${i}`).join(", ");
    const slopeSum = this.waves.map((_, i) => `s${i}`).join(" + ");
    const waveCalls = this.waves
      .map(
        (w, i) =>
          `h += wave(p, vec2(${glslFloat(w.dir.x)}, ${glslFloat(w.dir.y)}), ` +
          `${glslFloat(w.freq)}, ${glslFloat(w.amp)}, ${glslFloat(w.speed)}, s${i});`,
      )
      .join("\n          ");

    // High tessellation so the short, steep swells stay smooth, not faceted.
    const geometry = new THREE.PlaneGeometry(size, size, 512, 512);
    geometry.rotateX(-Math.PI / 2); // lie flat in the XZ plane

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uSunDir: { value: sunDir.clone().normalize() },
        // Pastel-teal arcade palette: clean turquoise gradient, soft foam.
        uDeep: { value: new THREE.Color(0x2785a0) },
        uShallow: { value: new THREE.Color(0x8fe3e6) },
        uSky: { value: skyColor.clone() },
        uFoam: { value: new THREE.Color(0xf2ffff) },
        uWaveMax: { value: WAVE_MAX },
        uFogNear: { value: size * 0.12 },
        uFogFar: { value: size * 0.5 },
        // Wind direction (XZ) + the two face tints, so the front face you climb
        // into upwind reads differently from the back face you ride down.
        uWindDir: { value: new THREE.Vector2(windDir.x, windDir.y).normalize() },
        uFrontFace: { value: new THREE.Color(0x1f6f9e) }, // front (climb) — deeper azure
        uBackFace: { value: new THREE.Color(0x74e6b0) }, // back (descend) — bright mint
        uFaceTint: { value: 0.22 }, // 0 = off, ~0.4 = dramatic
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;
        varying vec2 vSlope;

        // One directional wave + its contribution to the surface slope.
        float wave(vec2 p, vec2 dir, float freq, float amp, float speed, out vec2 slope) {
          // minus uTime so crests travel toward +dir (with the wind), not against it
          float phase = dot(dir, p) * freq - uTime * speed;
          slope = amp * freq * dir * cos(phase);
          return amp * sin(phase);
        }

        void main() {
          // Sample waves from world XZ so the pattern stays anchored even as
          // the mesh is recentered under the camera each frame.
          vec4 world = modelMatrix * vec4(position, 1.0);
          vec2 p = world.xz;
          vec2 ${slopeDecl};
          float h = 0.0;
          ${waveCalls}
          world.y += h;

          vec2 slope = ${slopeSum};
          vSlope = slope; // pass the true gradient to the fragment for face tinting
          // Exaggerate the slope for the lighting normal ONLY (geometry + the JS
          // sampler keep the true height, so boats still sit right) so the wave
          // faces read as steep, sharply-lit lines.
          vNormal = normalize(vec3(-slope.x * 1.6, 1.0, -slope.y * 1.6));

          vWaveHeight = h;
          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCameraPos;
        uniform vec3 uSunDir;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSky;
        uniform vec3 uFoam;
        uniform float uWaveMax;
        uniform float uFogNear;
        uniform float uFogFar;
        uniform vec2 uWindDir;
        uniform vec3 uFrontFace;
        uniform vec3 uBackFace;
        uniform float uFaceTint;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;
        varying vec2 vSlope;

        void main() {
          vec2 q = vWorldPos.xz;
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(uCameraPos - vWorldPos);

          // Smooth height gradient: deep troughs, bright crests. The directional
          // swell makes this read as travelling wavefront lines.
          float hNorm = smoothstep(
            0.12, 0.95, clamp(vWaveHeight / uWaveMax * 0.5 + 0.5, 0.0, 1.0));
          vec3 water = mix(uDeep, uShallow, hNorm);

          // Gentle directional shading — wave faces catch the light but never go
          // black (lots of ambient), so it stays clean and arcade.
          float diff = dot(normal, uSunDir) * 0.32 + 0.72;
          vec3 color = water * diff;

          // Tint by which way the face leans relative to the wind. slope·windDir
          // < 0 means the surface rises as you head upwind — the front face you
          // climb (adverse); > 0 is the back face you ride down (favorable).
          // Same test the wave slope force uses, so the colors match the physics.
          float faceBlend = smoothstep(-0.05, 0.05, dot(vSlope, uWindDir));
          color = mix(color, mix(uFrontFace, uBackFace, faceBlend), uFaceTint);

          // Sky reflection at grazing angles for a shiny water sheen.
          float fres = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);
          color = mix(color, uSky * 1.08, fres * 0.45);

          // Tight sun sparkle — small glints rather than broad white smears.
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 200.0);
          color += spec * 0.5 * vec3(1.0, 0.98, 0.9);

          // Rare, crisp whitecaps only on the very tops of the tallest crests.
          float crestH = vWaveHeight +
            (sin(q.x * 0.25 + uTime * 2.0) + sin(q.y * 0.22 - uTime * 1.7)) * 0.18;
          float foam = smoothstep(uWaveMax * 0.82, uWaveMax * 0.96, crestH);
          color = mix(color, uFoam, foam * 0.85);

          // Distance haze toward the horizon.
          float dist = length(uCameraPos - vWorldPos);
          float fog = smoothstep(uFogNear, uFogFar, dist);
          color = mix(color, uSky, fog);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  update(time: number, cameraPos: THREE.Vector3): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uCameraPos.value.copy(cameraPos);
    // Keep the ocean centered under the camera so it appears infinite.
    this.mesh.position.x = cameraPos.x;
    this.mesh.position.z = cameraPos.z;
  }

  /**
   * World-space surface height at (x, z) for the given time — the exact value
   * the vertex shader renders, so floating objects sit on the visible water.
   * If `outSlope` is provided it's filled with the surface gradient
   * (∂h/∂x, ∂h/∂z), useful for tilting an object to follow the wave.
   */
  sample(x: number, z: number, time: number, outSlope?: THREE.Vector2): number {
    let h = 0;
    if (outSlope) outSlope.set(0, 0);
    for (const w of this.waves) {
      const phase = (w.dir.x * x + w.dir.y * z) * w.freq - time * w.speed;
      h += w.amp * Math.sin(phase);
      if (outSlope) {
        const c = w.amp * w.freq * Math.cos(phase);
        outSlope.x += c * w.dir.x;
        outSlope.y += c * w.dir.y;
      }
    }
    return h;
  }
}
