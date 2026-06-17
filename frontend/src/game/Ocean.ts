import * as THREE from "three";

interface WaveSpec {
  dir: THREE.Vector2; // normalized travel direction in the XZ plane
  freq: number;
  amp: number;
  speed: number;
}

/**
 * The directional waves summed to form the surface. This single spec drives
 * both the GLSL vertex shader (rendering) and {@link Ocean.sample} (so boats
 * ride the exact same surface the player sees — no drift between the two).
 */
const WAVES: WaveSpec[] = [
  { dir: new THREE.Vector2(1.0, 0.3).normalize(), freq: 0.012, amp: 1.6, speed: 1.1 },
  { dir: new THREE.Vector2(-0.6, 1.0).normalize(), freq: 0.02, amp: 0.9, speed: 1.4 },
  { dir: new THREE.Vector2(0.4, -0.9).normalize(), freq: 0.035, amp: 0.4, speed: 1.9 },
  { dir: new THREE.Vector2(1.0, 1.0).normalize(), freq: 0.06, amp: 0.2, speed: 2.4 },
];

/** Format a JS number as a GLSL float literal (always has a decimal point). */
function glslFloat(n: number): string {
  const s = String(n);
  return /[.e]/.test(s) ? s : s + ".0";
}

// Generate the shader's wave accumulation from WAVES so it can never drift
// from the JS sampler below.
const WAVE_SLOPES = WAVES.map((_, i) => `s${i}`).join(", ");
const WAVE_SUM = WAVES.map((_, i) => `s${i}`).join(" + ");
const WAVE_CALLS = WAVES.map(
  (w, i) =>
    `h += wave(p, vec2(${glslFloat(w.dir.x)}, ${glslFloat(w.dir.y)}), ` +
    `${glslFloat(w.freq)}, ${glslFloat(w.amp)}, ${glslFloat(w.speed)}, s${i});`,
).join("\n          ");

/**
 * A large animated ocean plane. Self-contained GLSL (no texture assets):
 * height is a sum of directional sine waves, normals are derived analytically
 * for lighting, and the surface fades to the sky color in the distance so the
 * plane edge is never visible.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(size: number, skyColor: THREE.Color, sunDir: THREE.Vector3) {
    const geometry = new THREE.PlaneGeometry(size, size, 180, 180);
    geometry.rotateX(-Math.PI / 2); // lie flat in the XZ plane

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uSunDir: { value: sunDir.clone().normalize() },
        uDeep: { value: new THREE.Color(0x0a3d62) },
        uShallow: { value: new THREE.Color(0x2e86de) },
        uSky: { value: skyColor.clone() },
        uFogNear: { value: size * 0.12 },
        uFogFar: { value: size * 0.5 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        // One directional wave + its contribution to the surface slope.
        float wave(vec2 p, vec2 dir, float freq, float amp, float speed, out vec2 slope) {
          float phase = dot(dir, p) * freq + uTime * speed;
          slope = amp * freq * dir * cos(phase);
          return amp * sin(phase);
        }

        void main() {
          // Sample waves from world XZ so the pattern stays anchored even as
          // the mesh is recentered under the camera each frame.
          vec4 world = modelMatrix * vec4(position, 1.0);
          vec2 p = world.xz;
          vec2 ${WAVE_SLOPES};
          float h = 0.0;
          ${WAVE_CALLS}
          world.y += h;

          vec2 slope = ${WAVE_SUM};
          vNormal = normalize(vec3(-slope.x, 1.0, -slope.y));

          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCameraPos;
        uniform vec3 uSunDir;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSky;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(uCameraPos - vWorldPos);

          // Base water color, lighter on wave crests.
          float facing = clamp(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
          vec3 water = mix(uDeep, uShallow, pow(facing, 4.0));

          // Diffuse + sun specular glint.
          float diff = clamp(dot(normal, uSunDir) * 0.5 + 0.6, 0.0, 1.0);
          vec3 halfDir = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 120.0);

          // Fresnel: reflect the sky at grazing angles.
          float fres = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
          vec3 color = mix(water * diff, uSky, fres * 0.6);
          color += spec * vec3(1.0, 0.97, 0.85);

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
    for (const w of WAVES) {
      const phase = (w.dir.x * x + w.dir.y * z) * w.freq + time * w.speed;
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
