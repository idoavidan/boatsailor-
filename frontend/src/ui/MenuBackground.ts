import * as THREE from "three";
import { createBoatMesh } from "../game/Boat";
import { Ocean } from "../game/Ocean";
import { Wildlife } from "../game/Wildlife";
import { PLAYER_COLORS } from "../protocol";

const SKY_COLOR = new THREE.Color(0x9fd5ee);
const SUN_DIR = new THREE.Vector3(0.4, 0.85, 0.25).normalize();
const WIND_DIR = new THREE.Vector2(0.7, 0.7).normalize();
/** Phase speed of the menu swell — matches casual mode (maxSpeed 40 × 1.1). */
const WAVE_CELERITY = 44;

/**
 * The slowly-revolving ocean shown behind the start menu, so the lobby looks
 * like the game itself: a real sailboat bobbing on the same live wave shader
 * while the camera orbits around it. Self-contained (its own renderer + loop);
 * the Menu starts it on construction and stops it the moment a game begins.
 */
export class MenuBackground {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private ocean: Ocean;
  private boat: THREE.Group;
  private wildlife: Wildlife;
  private running = false;
  private t = 0; // own elapsed clock (Clock.elapsedTime only ticks via getDelta)
  private resizeHandler = () => this.onResize();
  private waveSlope = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.5,
      6000,
    );

    this.scene.background = SKY_COLOR.clone();
    this.scene.fog = new THREE.Fog(SKY_COLOR.getHex(), 600, 2400);
    this.scene.add(makeSky());

    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x335577, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
    sun.position.copy(SUN_DIR).multiplyScalar(500);
    this.scene.add(sun);

    this.ocean = new Ocean(900 * 6, SKY_COLOR, SUN_DIR, WIND_DIR, WAVE_CELERITY);
    this.scene.add(this.ocean.mesh);

    // A hero boat in a friendly blue, sitting near the origin while the camera
    // wheels around it. Trim its sails to a pleasant reach and leave them there.
    this.boat = createBoatMesh(PLAYER_COLORS[1]);
    const main = this.boat.getObjectByName("mainsail");
    const jib = this.boat.getObjectByName("jib");
    if (main) main.rotation.y = -Math.PI / 2 + 0.7;
    if (jib) jib.rotation.y = Math.PI / 2 + 0.56;
    this.scene.add(this.boat);

    // Same ambient sea life the game shows, so the lobby feels alive.
    this.wildlife = new Wildlife();
    this.scene.add(this.wildlife.group);

    window.addEventListener("resize", this.resizeHandler);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Pause the loop (and free the GPU) when the menu is dismissed for a game. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private frame(): void {
    // Clock.elapsedTime only advances when getDelta() is called, so drive our
    // own clock off the frame delta (and reuse dt for the wildlife animation).
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;
    const t = this.t;

    // Boat hovers at the origin, riding the swell and gently yawing so the rig
    // turns through the light.
    const heading = Math.sin(t * 0.08) * 0.5;
    const height = this.ocean.sample(0, 0, t, this.waveSlope);
    this.boat.position.set(0, height, 0);
    const fwd =
      this.waveSlope.x * Math.sin(heading) + this.waveSlope.y * Math.cos(heading);
    const right =
      this.waveSlope.x * Math.cos(heading) - this.waveSlope.y * Math.sin(heading);
    this.boat.rotation.set(-fwd, heading, right - 0.12, "YXZ");

    // Camera orbits the boat, so the whole sea wheels past behind it.
    const orbit = t * 0.06;
    const radius = 88;
    this.camera.position.set(
      Math.sin(orbit) * radius,
      34 + Math.sin(t * 0.2) * 2,
      Math.cos(orbit) * radius,
    );
    this.camera.lookAt(0, 7, 0);

    this.ocean.update(t, this.camera.position);
    this.wildlife.update(0, 0, t, dt, (x, z) => this.ocean.sample(x, z, t));
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

/** A simple vertical sky gradient dome (mirrors the in-game sky). */
function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(4000, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color(0x2a6cb0) },
      uBottom: { value: SKY_COLOR.clone() },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      varying float vY;
      void main() {
        float t = clamp(vY * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
