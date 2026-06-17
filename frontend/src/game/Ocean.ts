import * as THREE from "three";

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
          vec2 s1, s2, s3, s4;
          float h = 0.0;
          h += wave(p, normalize(vec2( 1.0,  0.3)), 0.012, 1.6, 1.1, s1);
          h += wave(p, normalize(vec2(-0.6,  1.0)), 0.020, 0.9, 1.4, s2);
          h += wave(p, normalize(vec2( 0.4, -0.9)), 0.035, 0.4, 1.9, s3);
          h += wave(p, normalize(vec2( 1.0,  1.0)), 0.060, 0.2, 2.4, s4);
          world.y += h;

          vec2 slope = s1 + s2 + s3 + s4;
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
}
