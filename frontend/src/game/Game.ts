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
/** Lateral reach of the start/finish line — matches the visible gate posts. */
const START_LINE_HALF = WORLD.checkpointRadius;

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
  private markBeacon: THREE.Group | null = null;
  private beaconLabel: THREE.Sprite | null = null;
  private beaconText = "";
  private beaconDist = -1;
  private offscreenArrow: THREE.Group | null = null;
  private lobbyLabel: THREE.Sprite | null = null;
  private tmpProject = new THREE.Vector3();
  private expectedCheckpoint = 0;

  // Start-line crossing state (speed mode). `hasStarted` flips once the boat
  // makes a clean forward crossing after the gun; an over-early boat must dip
  // back and re-cross to set it.
  private hasStarted = false;
  private prevStartD = -1; // signed distance past the line last frame
  private startAhead = false; // currently on the course side of the line
  private startCrossed = 0; // this frame: +1 forward, -1 backward, 0 none
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
  private waveSlope = new THREE.Vector2();

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

      // Guidance: a labelled beacon that floats over the next mark, plus a
      // fallback arrow above the boat for when that mark is off-screen.
      this.markBeacon = makeMarkBeacon();
      this.beaconLabel = this.markBeacon.userData.label as THREE.Sprite;
      this.markBeacon.visible = false;
      this.scene.add(this.markBeacon);

      this.offscreenArrow = makeDirectionArrow();
      this.offscreenArrow.visible = false;
      this.scene.add(this.offscreenArrow);

      // A "waiting" sign shown over the boat while the room lobby fills.
      this.lobbyLabel = makeLobbyLabel();
      this.lobbyLabel.visible = false;
      this.scene.add(this.lobbyLabel);
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
    const phase = race.phase;

    if (phase === "waiting" && this.prevPhase !== "waiting") {
      // Room lobby: roam freely while the room fills. The start line is dormant
      // (dimmed) and isn't crossed yet.
      this.course?.setActive(false);
      this.resetStartLineState();
    }
    if (phase === "countdown" && this.prevPhase !== "countdown") {
      // The real pre-start: line everyone up on the grid and arm the line so
      // players can time their crossing with the gun.
      this.placeOnStartGrid();
      this.expectedCheckpoint = 0;
      this.course?.setActive(true);
      this.resetStartLineState();
    }
    if (phase === "racing" && this.prevPhase !== "racing") {
      this.expectedCheckpoint = 0;
      this.hasStarted = false;
    }

    // Boats stay controllable throughout (lobby and pre-start included).
    this.controls.setEnabled(true);

    this.prevPhase = phase;
  }

  /** Re-seed the start-line crossing tracker from the boat's current side. */
  private resetStartLineState(): void {
    this.hasStarted = false;
    this.startCrossed = 0;
    const cp = this.course?.checkpoint(0);
    if (!cp) {
      this.prevStartD = -1;
      this.startAhead = false;
      return;
    }
    const dx = this.body.x - cp.x;
    const dz = this.body.z - cp.z;
    this.prevStartD = dx * Math.sin(cp.angle) + dz * Math.cos(cp.angle);
    this.startAhead = this.prevStartD >= 0;
  }

  private placeOnStartGrid(): void {
    if (!this.course) return;
    const gate = this.course.checkpointPosition(0);
    const angle = this.startAngle();
    const forward = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    const lateral = new THREE.Vector2(Math.cos(angle), -Math.sin(angle));

    const row = Math.floor(this.slot / 4);
    const col = this.slot % 4;
    // Keep every grid slot clear of the start line's capture radius so no one
    // is credited the line the instant the race starts.
    const back = 44 + row * 16;
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

    // 2. Start line + checkpoints (speed mode)
    if (this.mode === "speed" && this.course) {
      const phase = this.race.phase;
      if (phase === "countdown" || phase === "racing") {
        this.updateStartLineState();
      }
      if (phase === "racing") this.checkCheckpoints();
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
      // Ride the same wave surface as the local boat.
      r.group.position.y = this.ocean.sample(
        r.group.position.x,
        r.group.position.z,
        time,
      );
    }

    // 5. Camera, ocean, course markers, HUD
    this.updateCamera(dt);
    this.ocean.update(time, this.camera.position);
    if (this.mode === "speed" && this.course) {
      this.course.floatOnWaves((x, z) => this.ocean.sample(x, z, time));
      this.updateMarkIndicators(time);
    }
    this.updateHud(now);

    this.renderer.render(this.scene, this.camera);
  }

  private applyLocalBoatTransform(
    input: { rudder: number },
    time: number,
  ): void {
    // Sit on the actual water surface (not a fixed fake bob) and tilt to follow
    // the wave slope, so the boat always rides the crest it's over.
    const height = this.ocean.sample(
      this.body.x,
      this.body.z,
      time,
      this.waveSlope,
    );
    this.boat.position.set(this.body.x, height, this.body.z);

    const h = this.body.heading;
    const fwdSlope = this.waveSlope.x * Math.sin(h) + this.waveSlope.y * Math.cos(h);
    const rightSlope = this.waveSlope.x * Math.cos(h) - this.waveSlope.y * Math.sin(h);
    // Roll banks into the turn (same sign as the corrected rudder->heading);
    // pitch/roll from the slope make the hull conform to the wave it's on.
    const turnRoll = input.rudder * 0.25 * (this.body.speed > 5 ? 1 : 0);
    this.boat.rotation.set(-fwdSlope, h, rightSlope + turnRoll, "YXZ");
  }

  /** Track which side of the start line the boat is on and detect crossings. */
  private updateStartLineState(): void {
    const cp = this.course?.checkpoint(0);
    if (!cp) return;
    const dx = this.body.x - cp.x;
    const dz = this.body.z - cp.z;
    const sin = Math.sin(cp.angle);
    const cos = Math.cos(cp.angle);
    const d = dx * sin + dz * cos; // signed distance past the line (+ = course side)
    const lateral = dx * cos - dz * sin; // position along the line
    this.startCrossed = 0;
    if (Math.abs(lateral) <= START_LINE_HALF) {
      if (this.prevStartD < 0 && d >= 0) this.startCrossed = 1; // forward
      else if (this.prevStartD >= 0 && d < 0) this.startCrossed = -1; // backward
    }
    this.startAhead = d >= 0;
    this.prevStartD = d;
  }

  private checkCheckpoints(): void {
    if (!this.course) return;
    const idx = this.expectedCheckpoint;

    let passed: boolean;
    if (this.course.markKind(idx) === "buoy") {
      // Round the buoy: get within its radius.
      passed = this.course.isWithin(idx, this.body.x, this.body.z);
    } else if (!this.hasStarted) {
      // Starting requires a clean forward crossing, so a boat that's over the
      // line early must dip back and re-cross to get going.
      passed = this.startCrossed === 1;
      if (passed) this.hasStarted = true;
    } else {
      // Lap / finish: crossing the line in either direction counts.
      passed = this.startCrossed !== 0;
    }

    if (passed) {
      this.net.send({ type: "checkpoint", index: idx });
      this.expectedCheckpoint = (idx + 1) % this.course.count;
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

  /**
   * Guide the player to the next mark: float a labelled beacon over it while it
   * is on screen, and fall back to an arrow above the boat (pointing the way)
   * when it is not.
   */
  private updateMarkIndicators(time: number): void {
    if (!this.course || !this.markBeacon || !this.offscreenArrow) return;
    const phase = this.race.phase;

    // Lobby: hover a "waiting" sign over the boat; no start-line guidance yet.
    if (this.lobbyLabel) {
      const inLobby = phase === "waiting";
      this.lobbyLabel.visible = inLobby;
      if (inLobby) {
        this.lobbyLabel.position.set(
          this.body.x,
          this.boat.position.y + 20 + Math.sin(time * 2) * 0.5,
          this.body.z,
        );
      }
    }

    const show = phase === "racing" || phase === "countdown";
    if (!show) {
      this.markBeacon.visible = false;
      this.offscreenArrow.visible = false;
      return;
    }

    const target = this.course.checkpointPosition(this.expectedCheckpoint);
    const markY = this.ocean.sample(target.x, target.z, time);

    // Is the mark on screen this frame? Project a point just above it to NDC.
    this.camera.updateMatrixWorld();
    const ndc = this.tmpProject
      .set(target.x, markY + 18, target.z)
      .project(this.camera);
    const onScreen =
      ndc.z < 1 && Math.abs(ndc.x) <= 0.95 && Math.abs(ndc.y) <= 0.95;

    this.markBeacon.visible = onScreen;
    this.offscreenArrow.visible = !onScreen;

    if (onScreen) {
      this.markBeacon.position.set(
        target.x,
        markY + 24 + Math.sin(time * 3) * 0.6,
        target.z,
      );
      // Counter-scale by distance so the label keeps a constant on-screen size,
      // readable even from across the course.
      const camDist = this.camera.position.distanceTo(this.markBeacon.position);
      this.markBeacon.scale.setScalar(
        THREE.MathUtils.clamp(camDist / 140, 0.5, 10),
      );
      // Instruction + live distance to the mark (rounded so the texture is only
      // rebuilt when it visibly changes).
      const meters =
        Math.round(
          Math.hypot(target.x - this.body.x, target.z - this.body.z) / 5,
        ) * 5;
      const text = this.markInstruction();
      if (text !== this.beaconText || meters !== this.beaconDist) {
        this.setBeaconLabel(text, meters);
        this.beaconText = text;
        this.beaconDist = meters;
      }
    } else {
      const dx = target.x - this.body.x;
      const dz = target.z - this.body.z;
      this.offscreenArrow.rotation.y = Math.atan2(dx, dz);
      this.offscreenArrow.position.set(
        this.body.x,
        this.boat.position.y + 16 + Math.sin(time * 3) * 0.6,
        this.body.z,
      );
    }
  }

  /** Instruction shown on the next mark's beacon. */
  private markInstruction(): string {
    if (this.course?.markKind(this.expectedCheckpoint) === "buoy") {
      return "GO AROUND";
    }
    // The start/finish line: you cross it, you don't round it.
    if (this.race.phase === "countdown") {
      return this.startAhead ? "GET BEHIND THE LINE" : "CROSS AT THE GUN";
    }
    if (!this.hasStarted) {
      return this.startAhead ? "OVER EARLY — GO BACK" : "CROSS THE START LINE";
    }
    const me = this.race.standings.find((s) => s.id === this.localId);
    const lap = me?.lap ?? 0;
    return lap >= this.race.totalLaps ? "CROSS THE FINISH LINE" : "CROSS THE LINE";
  }

  private setBeaconLabel(text: string, meters: number): void {
    if (!this.beaconLabel) return;
    const mat = this.beaconLabel.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = makeLabelTexture(text, meters);
    mat.needsUpdate = true;
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

/** A downward arrow + instruction label that hovers over the active mark. */
function makeMarkBeacon(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd54a,
    emissive: 0x6b4e00,
    emissiveIntensity: 1,
    roughness: 0.4,
  });

  const arrow = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 4), mat);
  arrow.rotation.x = Math.PI; // point straight down at the mark
  group.add(arrow);

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeLabelTexture("", 0),
      transparent: true,
      depthTest: false,
    }),
  );
  label.position.y = 11;
  label.scale.set(45, 14, 1);
  group.add(label);

  group.userData.label = label;
  return group;
}

/**
 * Render an instruction (and optional distance) to a canvas texture for a
 * billboard sprite. Pass `meters < 0` for a single centered line.
 */
function makeLabelTexture(
  text: string,
  meters: number,
  accent = "#ffe27a",
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 200;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  roundRect(ctx, 8, 24, 624, 152, 20);
  ctx.fill();

  // Instruction line, shrunk until it fits the plate.
  let size = 58;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  while (ctx.measureText(text).width > 580 && size > 24) {
    size -= 2;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
  }
  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 320, meters >= 0 ? 80 : 100);

  // Distance line underneath (omitted when meters < 0).
  if (meters >= 0) {
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.fillStyle = "#cfe8ff";
    ctx.fillText(`${meters} m`, 320, 140);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** A billboard sign hovering over the boat while the room lobby fills. */
function makeLobbyLabel(): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeLabelTexture("WAITING FOR THE GUN", -1, "#bfe3ff"),
      transparent: true,
      depthTest: false,
    }),
  );
  sprite.scale.set(52, 16, 1);
  return sprite;
}

/** A chunky arrow (shaft + head) pointing along +Z, used to flag the next mark. */
function makeDirectionArrow(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd54a,
    emissive: 0x6b4e00,
    emissiveIntensity: 1,
    roughness: 0.4,
  });

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 4), mat);
  group.add(shaft);

  const head = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4, 4), mat);
  head.rotation.x = Math.PI / 2; // cone defaults to +Y; aim it down +Z
  head.position.z = 3.5;
  group.add(head);

  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return group;
}

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
