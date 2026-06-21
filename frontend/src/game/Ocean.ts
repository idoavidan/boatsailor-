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
}
// One coherent wave set. Layers are kept nearly co-directional (tiny offsets,
// ~1–2°) so the crests run long and clean — a directional sea marching with the
// wind, not a busy cross-hatch. They follow deep-water dispersion (longer waves
// travel faster, c ∝ 1/√freq; see buildWaves), so the big surf wave leads and
// the small chop rides slower on top — natural, and the ripples no longer zip.
// The longest layer (first) sets the surf celerity and is the wave you surf
// downwind. Steepness (amp * freq) is what the slope force climbs; shortest
// λ ≈ 92 units (≈ 8 mesh quads) stays smooth on the mesh.
//
// Wavelengths are long and widely spaced: a crest still travels at the fixed
// surf celerity, so with ~2× the spacing far fewer crests sweep past per second
// — the sea reads calm and rolling, not a fast even corrugation.
// The two long layers carry the swell; the two short ones are kept light so
// they texture the faces without crinkling them into busy noise — clean,
// readable wavefronts.
const WAVE_LAYERS: WaveLayer[] = [
  { offset: -0.015, freq: 0.022, amp: 18.0 }, // λ≈286, steepness .396 — surf wave
  { offset: 0.02, freq: 0.033, amp: 9.6 }, //   λ≈190, steepness .317
  { offset: -0.03, freq: 0.048, amp: 3.2 }, //  λ≈131, steepness .154 — chop
  { offset: 0.035, freq: 0.068, amp: 1.2 }, //  λ≈92,  steepness .082 — chop
];

// Crest sharpness. The sine is reshaped into 2·gᵏ−1 with g = (sin+1)/2, which
// keeps the crest at +amp and the trough at −amp but flattens and broadens the
// troughs while narrowing the crests — open water between peaked waves, the
// "sine … gap … sine" look, instead of an even sinusoid. 1 = plain sine; 2–3
// peakier. Peak height per layer is still amp, so WAVE_MAX is unchanged.
const WAVE_PEAK = 2.0;

/** Peak possible crest height (all waves in phase) — used to place foam. */
const WAVE_MAX = WAVE_LAYERS.reduce((sum, w) => sum + w.amp, 0);

/** Rotate the (normalized) wind direction by an angular offset in the XZ plane. */
function rotateOffWind(windDir: THREE.Vector2, offset: number): THREE.Vector2 {
  const w = windDir.clone().normalize();
  const c = Math.cos(offset);
  const s = Math.sin(offset);
  return new THREE.Vector2(w.x * c - w.y * s, w.x * s + w.y * c);
}

/**
 * Build the wave set, rotating each layer off the wind direction. `celerity` is
 * the phase speed of the longest (first) layer — the surf wave; the rest follow
 * deep-water dispersion (c ∝ 1/√freq), so longer waves move faster and the small
 * chop rides slower on top rather than racing along with the big swell.
 */
function buildWaves(windDir: THREE.Vector2, celerity: number): WaveSpec[] {
  const freq0 = WAVE_LAYERS[0].freq;
  return WAVE_LAYERS.map((l) => {
    const c = celerity * Math.sqrt(freq0 / l.freq);
    return {
      dir: rotateOffWind(windDir, l.offset),
      freq: l.freq,
      amp: l.amp,
      speed: c * l.freq, // speed = celerity * freq
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
  /** The dominant (longest) wave, doubling as the surf reference. */
  private surfRef: WaveSpec;
  /** Travel direction of the surf reference wave (unit, XZ). */
  readonly swellDir: THREE.Vector2;
  /** Phase speed shared by the whole wave set, in world units/sec. */
  readonly swellCelerity: number;

  constructor(
    size: number,
    skyColor: THREE.Color,
    sunDir: THREE.Vector3,
    windDir: THREE.Vector2,
    waveCelerity: number,
  ) {
    // One coherent set marching with the wind at a single celerity, set a bit
    // above boat speed so the waves overtake you and can be surfed downwind.
    this.waves = buildWaves(windDir, waveCelerity);
    this.surfRef = this.waves[0]; // the longest layer is the wave you surf
    this.swellDir = this.surfRef.dir.clone();
    this.swellCelerity = waveCelerity;

    // Generate the shader's wave accumulation from the same spec the JS sampler
    // uses, so rendering and physics can never drift.
    const slopeDecl = this.waves.map((_, i) => `s${i}`).join(", ");
    const slopeSum = this.waves.map((_, i) => `s${i}`).join(" + ");
    const peak = glslFloat(WAVE_PEAK); // crest-sharpening exponent for the shader
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
        uFlatFace: { value: new THREE.Color(0x49c5d4) }, // flat water between waves — cyan
        uFaceTint: { value: 0.22 }, // 0 = off, ~0.4 = dramatic
        // Look-toward-the-sun crest glow + sky-gradient reflection + ripple
        // shimmer. Set any strength to 0 to switch that trick off.
        uSkyTop: { value: new THREE.Color(0x2a6cb0) }, // zenith tint for the reflected sky (matches the dome)
        uSSS: { value: new THREE.Color(0x35dcc0) }, // translucent crest glow colour
        uSSSStrength: { value: 0.6 }, // 0 = off, ~1 = vivid
        uDetail: { value: 0.06 }, // micro-ripple normal strength (sparkle detail)
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
          // Reshape sine -> flat troughs + sharp crests: g in [0,1] raised to a
          // power, remapped to [-amp, amp]. h = amp*(2*g^PEAK - 1).
          float g = sin(phase) * 0.5 + 0.5;
          // d/dphase of that height = amp*PEAK*g^(PEAK-1)*cos(phase)
          float dh = amp * ${peak} * pow(g, ${peak} - 1.0) * cos(phase);
          slope = dh * freq * dir;
          return amp * (2.0 * pow(g, ${peak}) - 1.0);
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
        uniform vec3 uFlatFace;
        uniform float uFaceTint;
        uniform vec3 uSkyTop;
        uniform vec3 uSSS;
        uniform float uSSSStrength;
        uniform float uDetail;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vWaveHeight;
        varying vec2 vSlope;

        // Cheap hash + value noise, used to break up the foam edge and dapple the
        // sun glitter so neither reads as a clean mathematical contour.
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                     mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
                     u.y);
        }

        void main() {
          vec2 q = vWorldPos.xz;
          vec3 viewDir = normalize(uCameraPos - vWorldPos);

          // Micro-ripple detail: fine crossed ripples perturb the LIGHTING normal
          // only — the geometry and the JS height sampler are untouched, so boats
          // still sit on the true surface. This dapples the big smooth faces and
          // gives the specular below something to sparkle off.
          vec2 micro = vec2(
            cos(q.x * 0.45 + uTime * 1.3) + 0.7 * cos(q.y * 0.62 - uTime * 1.7),
            cos(q.y * 0.41 - uTime * 1.1) + 0.7 * cos(q.x * 0.57 + uTime * 1.9));
          vec3 normal = normalize(vNormal + vec3(micro.x, 0.0, micro.y) * uDetail);

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
          // climb (adverse); > 0 is the back face you ride down (favorable); near
          // 0 is the broad flat water between the peaked crests, which gets its
          // own colour. Same test the wave slope force uses, so colors match the
          // physics. faceSharp = slope at which a face is fully tinted; smaller
          // = more water counts as "flat".
          float along = dot(vSlope, uWindDir);
          float faceSharp = 0.07;
          float back = smoothstep(0.0, faceSharp, along);
          float front = smoothstep(0.0, faceSharp, -along);
          vec3 faceCol = uFlatFace;
          faceCol = mix(faceCol, uBackFace, back);
          faceCol = mix(faceCol, uFrontFace, front);
          color = mix(color, faceCol, uFaceTint);

          // Subsurface glow: looking toward the sun, light scatters up through the
          // thin water at the crests — a warm teal-green translucency that's the
          // signature of good-looking water. Gated to crest tops (crestRise²) so
          // the troughs stay deep and the glow doesn't wash the whole sea out.
          float crestRise = clamp(vWaveHeight / uWaveMax, 0.0, 1.0);
          float backlit = pow(max(dot(-viewDir, uSunDir), 0.0), 2.0);
          color += uSSS * (crestRise * crestRise) * backlit * uSSSStrength;

          // Sky reflection: bounce the view off the surface and read the sky
          // gradient (lighter at the horizon, deeper overhead) rather than one
          // flat colour, so the sheen has depth. Grazing angles reflect most.
          float fres = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);
          vec3 refl = reflect(-viewDir, normal);
          vec3 skyRefl = mix(uSky * 1.08, uSkyTop, clamp(refl.y, 0.0, 1.0));
          color = mix(color, skyRefl, fres * 0.5);

          // Sun glitter: a tight specular highlight chopped into dancing points by
          // the noise mask, so the sun's path twinkles instead of smearing.
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 200.0);
          spec *= 0.5 + 0.9 * smoothstep(0.55, 0.85, vnoise(q * 0.7 + uTime * 0.4));
          color += spec * 0.5 * vec3(1.0, 0.98, 0.9);

          // Whitecaps on the very tops of the tallest crests, with a noise mask so
          // the foam edge is ragged and organic rather than a clean contour.
          float crestH = vWaveHeight +
            (sin(q.x * 0.25 + uTime * 2.0) + sin(q.y * 0.22 - uTime * 1.7)) * 0.08;
          float foam = smoothstep(uWaveMax * 0.82, uWaveMax * 0.96, crestH);
          foam *= 0.55 + 0.45 * vnoise(q * 0.2 - uTime * 0.06);
          color = mix(color, uFoam, foam * 0.9);

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
      const g = Math.sin(phase) * 0.5 + 0.5;
      h += w.amp * (2 * Math.pow(g, WAVE_PEAK) - 1);
      if (outSlope) {
        const dh =
          w.amp * WAVE_PEAK * Math.pow(g, WAVE_PEAK - 1) * Math.cos(phase);
        outSlope.x += dh * w.freq * w.dir.x;
        outSlope.y += dh * w.freq * w.dir.y;
      }
    }
    return h;
  }

  /**
   * Height + slope of the dominant surf wave alone, used by the surf force to
   * tell whether the boat is on its leading (downwind) face. Separate from
   * {@link sample} because the smaller layers add slope noise that would make
   * the on-the-face gate flicker.
   */
  sampleSwell(x: number, z: number, t: number, outSlope: THREE.Vector2): number {
    const w = this.surfRef;
    const phase = (w.dir.x * x + w.dir.y * z) * w.freq - t * w.speed;
    const g = Math.sin(phase) * 0.5 + 0.5;
    const dh = w.amp * WAVE_PEAK * Math.pow(g, WAVE_PEAK - 1) * Math.cos(phase);
    outSlope.set(dh * w.freq * w.dir.x, dh * w.freq * w.dir.y);
    return w.amp * (2 * Math.pow(g, WAVE_PEAK) - 1);
  }
}
