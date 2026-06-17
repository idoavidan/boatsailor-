import * as THREE from "three";
import { Network } from "../net/Network";
import {
  GameMode,
  PlayerSnapshot,
  RaceState,
  ServerMessage,
  WORLD,
} from "../protocol";
import { HUD } from "../ui/HUD";
import {
  BoatBody,
  CASUAL_TUNING,
  SPEED_TUNING,
  createBoatMesh,
} from "./Boat";
import { Controls } from "./Controls";
import { Course } from "./Course";
import { Ocean } from "./Ocean";

const SKY_COLOR = new THREE.Color(0x9fd5ee);
const SUN_DIR = new THREE.Vector3(0.4, 0.85, 0.25).normalize();
/** Fixed wind for the whole arena. TODO: have the server broadcast wind. */
const WIND_DIR = new THREE.Vector2(0.7, 0.7).normalize();
const SEND_RATE = WORLD.tickRate; // outgoing state messages per second

interface RemoteBoat {
  group: THREE.Group;
  target: { x: number; z: number; heading: number; speed: number };
  renderHeading: number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private ocean: Ocean;
  private controls: Controls;

  private localId = "";
  private slot = 0;
  private mode: GameMode;
  private body: BoatBody;
  private boat: THREE.Group;

  private remotes = new Map<string, RemoteBoat>();

  private course: Course | null = null;
  private expectedCheckpoint = 0;
  private race: RaceState = {
    phase: "free",
    totalLaps: WORLD.totalLaps,
    countdown: 0,
    startedAt: null,
    standings: [],
  };
  private prevPhase = "free";

  private hud = new HUD();
  private sendAccumulator = 0;

  constructor(
    private net: Network,
    canvas: HTMLCanvasElement,
    welcome: Extract<ServerMessage, { type: "welcome" }>,
  ) {
    this.mode = welcome.mode;
    this.localId = welcome.id;
    this.slot = welcome.slot;

    // --- Renderer / camera ---
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.5,
      6000,
    );
    this.camera.position.set(0, 40, -60);

    // --- World ---
    this.scene.background = SKY_COLOR.clone();
    this.scene.fog = new THREE.Fog(SKY_COLOR.getHex(), 600, 2400);
    this.scene.add(this.makeSky());

    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x335577, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
    sun.position.copy(SUN_DIR).multiplyScalar(500);
    this.scene.add(sun);

    this.ocean = new Ocean(WORLD.bounds * 6, SKY_COLOR, SUN_DIR);
    this.scene.add(this.ocean.mesh);

    // --- Local boat ---
    this.body = new BoatBody(
      this.mode === "speed" ? SPEED_TUNING : CASUAL_TUNING,
      WIND_DIR.clone(),
    );
    this.boat = createBoatMesh(welcome.color);
    this.scene.add(this.boat);

    // --- Course (speed mode only) ---
    if (this.mode === "speed") {
      this.course = new Course(welcome.course);
      this.scene.add(this.course.group);
    }

    // --- Controls / HUD ---
    this.controls = new Controls(window);
    this.hud.show(this.mode);

    // Seed existing players and race state.
    for (const p of welcome.players) this.addRemote(p);
    this.applyRace(welcome.race);

    this.net.onMessage((m) => this.onMessage(m));
    window.addEventListener("resize", () => this.onResize());
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // -------------------------------------------------------------------------
  // Networking
  // -------------------------------------------------------------------------

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "playerJoined":
        if (msg.player.id !== this.localId) this.addRemote(msg.player);
        break;
      case "playerLeft":
        this.removeRemote(msg.id);
        break;
      case "snapshot":
        for (const p of msg.players) {
          if (p.id === this.localId) continue;
          this.updateRemote(p);
        }
        break;
      case "race":
        this.applyRace(msg.race);
        break;
    }
  }

  private addRemote(p: PlayerSnapshot): void {
    if (this.remotes.has(p.id)) return;
    const group = createBoatMesh(p.color);
    group.position.set(p.x, 0, p.z);
    group.add(makeLabel(p.name));
    this.scene.add(group);
    this.remotes.set(p.id, {
      group,
      target: { x: p.x, z: p.z, heading: p.heading, speed: p.speed },
      renderHeading: p.heading,
    });
  }

  private updateRemote(p: PlayerSnapshot): void {
    const remote = this.remotes.get(p.id);
    if (!remote) {
      this.addRemote(p);
      return;
    }
    remote.target.x = p.x;
    remote.target.z = p.z;
    remote.target.heading = p.heading;
    remote.target.speed = p.speed;
  }

  private removeRemote(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.scene.remove(remote.group);
    disposeGroup(remote.group);
    this.remotes.delete(id);
  }

  private applyRace(race: RaceState): void {
    this.race = race;

    // On each fresh countdown, line up on the start grid and lock controls.
    if (race.phase === "countdown" && this.prevPhase !== "countdown") {
      this.placeOnStartGrid();
      this.expectedCheckpoint = 0;
    }
    if (race.phase === "racing" && this.prevPhase !== "racing") {
      this.expectedCheckpoint = 0;
    }

    const locked = race.phase === "countdown" || race.phase === "waiting";
    this.controls.setEnabled(!locked);

    this.prevPhase = race.phase;
  }

  private placeOnStartGrid(): void {
    if (!this.course) return;
    const gate = this.course.checkpointPosition(0);
    const angle = this.startAngle();
    const forward = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    const lateral = new THREE.Vector2(Math.cos(angle), -Math.sin(angle));

    const row = Math.floor(this.slot / 4);
    const col = this.slot % 4;
    const back = 24 + row * 16;
    const side = (col - 1.5) * 14;

    this.body.x = gate.x - forward.x * back + lateral.x * side;
    this.body.z = gate.z - forward.y * back + lateral.y * side;
    this.body.heading = angle;
    this.body.speed = 0;
    this.snapCamera();
  }

  /** Direction of travel through the start/finish gate (gate 0 -> gate 1). */
  private startAngle(): number {
    if (!this.course) return 0;
    const a = this.course.checkpointPosition(0);
    const b = this.course.checkpointPosition(1);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    const now = Date.now();

    // 1. Local boat physics
    const input = this.controls.sample();
    this.body.update(input, dt, WORLD.bounds);
    this.applyLocalBoatTransform(input, time);

    // 2. Checkpoints (speed mode)
    if (this.mode === "speed" && this.race.phase === "racing") {
      this.checkCheckpoints();
    }

    // 3. Send state to server at a fixed rate
    this.sendAccumulator += dt;
    if (this.sendAccumulator >= 1 / SEND_RATE) {
      this.sendAccumulator = 0;
      this.net.send({
        type: "state",
        x: this.body.x,
        z: this.body.z,
        heading: this.body.heading,
        speed: this.body.speed,
      });
    }

    // 4. Interpolate remote boats
    const k = 1 - Math.exp(-dt * 10);
    for (const r of this.remotes.values()) {
      r.group.position.x += (r.target.x - r.group.position.x) * k;
      r.group.position.z += (r.target.z - r.group.position.z) * k;
      r.renderHeading = angleLerp(r.renderHeading, r.target.heading, k);
      r.group.rotation.y = r.renderHeading;
      r.group.position.y = Math.sin(time * 1.5 + r.group.position.x) * 0.6;
    }

    // 5. Camera, ocean, HUD
    this.updateCamera(dt);
    this.ocean.update(time, this.camera.position);
    this.updateHud(now);

    this.renderer.render(this.scene, this.camera);
  }

  private applyLocalBoatTransform(
    input: { rudder: number },
    time: number,
  ): void {
    this.boat.position.set(
      this.body.x,
      Math.sin(time * 1.6) * 0.5,
      this.body.z,
    );
    this.boat.rotation.y = this.body.heading;
    // Roll into turns, pitch slightly with the waves.
    this.boat.rotation.z = -input.rudder * 0.25 * (this.body.speed > 5 ? 1 : 0);
    this.boat.rotation.x = Math.sin(time * 1.2) * 0.03;
  }

  private checkCheckpoints(): void {
    if (!this.course) return;
    if (
      this.course.isWithin(this.expectedCheckpoint, this.body.x, this.body.z)
    ) {
      this.net.send({ type: "checkpoint", index: this.expectedCheckpoint });
      this.expectedCheckpoint =
        (this.expectedCheckpoint + 1) % this.course.count;
    }
    this.course.highlightNext(this.expectedCheckpoint);
  }

  private updateCamera(dt: number): void {
    const forward = new THREE.Vector3(
      Math.sin(this.body.heading),
      0,
      Math.cos(this.body.heading),
    );
    const desired = new THREE.Vector3(this.body.x, 0, this.body.z)
      .addScaledVector(forward, -70)
      .add(new THREE.Vector3(0, 38, 0));

    const k = 1 - Math.exp(-dt * 4);
    this.camera.position.lerp(desired, k);
    this.camera.lookAt(
      this.body.x + forward.x * 30,
      6,
      this.body.z + forward.z * 30,
    );
  }

  private snapCamera(): void {
    const forward = new THREE.Vector3(
      Math.sin(this.body.heading),
      0,
      Math.cos(this.body.heading),
    );
    this.camera.position.set(
      this.body.x - forward.x * 70,
      38,
      this.body.z - forward.z * 70,
    );
    this.camera.lookAt(this.body.x, 6, this.body.z);
  }

  private updateHud(now: number): void {
    const tuning = this.mode === "speed" ? SPEED_TUNING : CASUAL_TUNING;
    this.hud.setSpeed(this.body.speed, tuning.maxSpeed);
    this.hud.setPlayers(this.remotes.size + 1);

    // Wind arrow points to wind direction relative to the boat heading.
    const windAngle = Math.atan2(WIND_DIR.x, WIND_DIR.y) - this.body.heading;
    this.hud.setWind(windAngle);

    this.hud.setRace(this.race, this.localId, now);
  }

  private makeSky(): THREE.Mesh {
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

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angleLerp(from: number, to: number, t: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  roundRect(ctx, 8, 12, 240, 40, 12);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 16), 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.position.set(0, 18, 0);
  sprite.scale.set(20, 5, 1);
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
