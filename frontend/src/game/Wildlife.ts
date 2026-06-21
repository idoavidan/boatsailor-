import * as THREE from "three";

/**
 * Ambient sea life: pods of leaping dolphins, schools of fish skipping at the
 * surface, and drifting jellyfish. Purely decorative and client-local (like the
 * wind streaks) — never collides, never synced between players.
 *
 * Everything tiles a column of side {@link FIELD} around the boat, wrapping in
 * X/Z so wildlife is always nearby however far you sail. Because the ocean mesh
 * is opaque, anything fully underwater is occluded — so the creatures live at or
 * above the waterline: dolphins porpoise in arcs, fish hop out in little skips,
 * and jellyfish float translucent on the swell.
 *
 * Add `group` to the scene; call `update()` each frame with the focus point (the
 * boat), the time, the frame dt, and a height sampler `(x, z) => waterHeight`.
 */

const FIELD = 1400; // wildlife tiles a FIELD×FIELD column around the boat
const HALF = FIELD / 2;

const DOLPHIN_PODS = 3;
const DOLPHIN_PER_POD = 3;
const FISH_SCHOOLS = 5;
const FISH_PER_SCHOOL = 16;
const JELLYFISH = 8;

type Sampler = (x: number, z: number) => number;

interface DolphinMember {
  obj: THREE.Group;
  ahead: number; // fore/aft offset within the pod (world units)
  lateral: number; // side offset within the pod
  phase: number; // offset into its personal leap cycle (0..1)
  period: number; // seconds per leap cycle
  leapH: number; // arc height above the water
}

interface Pod {
  x: number;
  z: number;
  heading: number; // travel bearing (dir = sin,cos), boat convention
  turn: number; // slow heading drift, rad/s
  speed: number;
  members: DolphinMember[];
}

interface School {
  x: number;
  z: number;
  heading: number;
  turn: number;
  speed: number;
}

interface Fish {
  school: number;
  ox: number; // offset within the school blob (world axes)
  oz: number;
  phase: number;
  period: number;
  hopH: number;
  size: number;
}

interface Jelly {
  obj: THREE.Group;
  bell: THREE.Mesh;
  x: number;
  z: number;
  vx: number; // slow surface drift
  vz: number;
  phase: number;
  pulse: number; // bell-contraction rate, rad/s
  bob: number; // vertical bob rate, rad/s
}

export class Wildlife {
  readonly group = new THREE.Group();

  private pods: Pod[] = [];
  private schools: School[] = [];
  private fish: Fish[] = [];
  private fishMesh: THREE.InstancedMesh;
  private jellies: Jelly[] = [];
  private dummy = new THREE.Object3D();

  constructor() {
    // --- Dolphins: pods that cruise the sea, each member porpoising on its own
    //     phase so they leap in a rolling sequence. ---
    for (let p = 0; p < DOLPHIN_PODS; p++) {
      const pod: Pod = {
        x: rand(-HALF, HALF),
        z: rand(-HALF, HALF),
        heading: Math.random() * Math.PI * 2,
        turn: rand(-0.04, 0.04),
        speed: rand(14, 22),
        members: [],
      };
      for (let m = 0; m < DOLPHIN_PER_POD; m++) {
        const obj = makeDolphin();
        this.group.add(obj);
        pod.members.push({
          obj,
          ahead: (m - (DOLPHIN_PER_POD - 1) / 2) * 7 + rand(-2, 2),
          lateral: rand(-5, 5),
          phase: Math.random(),
          period: rand(2.6, 3.8),
          leapH: rand(6, 9),
        });
      }
      this.pods.push(pod);
    }

    // --- Fish: schools of little bodies that skip out of the water. One
    //     InstancedMesh for the lot, hidden underwater by zeroing the scale. ---
    const fishGeo = new THREE.OctahedronGeometry(0.7, 0);
    fishGeo.scale(0.5, 0.5, 1.7); // a slim diamond body, nose toward +Z
    const fishMat = new THREE.MeshStandardMaterial({
      color: 0xbfe9f2,
      emissive: 0x2a6b7a,
      emissiveIntensity: 0.25,
      roughness: 0.45,
      metalness: 0.2,
      flatShading: true,
    });
    this.fishMesh = new THREE.InstancedMesh(
      fishGeo,
      fishMat,
      FISH_SCHOOLS * FISH_PER_SCHOOL,
    );
    this.fishMesh.frustumCulled = false; // instances roam; don't cull the batch
    this.group.add(this.fishMesh);

    for (let s = 0; s < FISH_SCHOOLS; s++) {
      this.schools.push({
        x: rand(-HALF, HALF),
        z: rand(-HALF, HALF),
        heading: Math.random() * Math.PI * 2,
        turn: rand(-0.3, 0.3),
        speed: rand(4, 9),
      });
      for (let i = 0; i < FISH_PER_SCHOOL; i++) {
        this.fish.push({
          school: s,
          ox: rand(-7, 7),
          oz: rand(-7, 7),
          phase: Math.random(),
          period: rand(1.4, 2.6),
          hopH: rand(1.6, 3.4),
          size: rand(0.8, 1.4),
        });
      }
    }

    // --- Jellyfish: translucent bells drifting and pulsing on the swell. ---
    for (let j = 0; j < JELLYFISH; j++) {
      const { obj, bell } = makeJelly();
      this.group.add(obj);
      this.jellies.push({
        obj,
        bell,
        x: rand(-HALF, HALF),
        z: rand(-HALF, HALF),
        vx: rand(-2, 2),
        vz: rand(-2, 2),
        phase: Math.random() * Math.PI * 2,
        pulse: rand(1.1, 1.8),
        bob: rand(0.5, 1.0),
      });
    }
  }

  update(
    focusX: number,
    focusZ: number,
    time: number,
    dt: number,
    sample: Sampler,
  ): void {
    this.updateDolphins(focusX, focusZ, time, dt, sample);
    this.updateFish(focusX, focusZ, time, dt, sample);
    this.updateJellies(focusX, focusZ, time, dt, sample);
  }

  private updateDolphins(
    focusX: number,
    focusZ: number,
    time: number,
    dt: number,
    sample: Sampler,
  ): void {
    const AIR = 0.45; // fraction of the cycle spent airborne (the rest is underwater)
    for (const pod of this.pods) {
      pod.heading += pod.turn * dt;
      const dx = Math.sin(pod.heading);
      const dz = Math.cos(pod.heading);
      pod.x = focusX + wrap(pod.x + dx * pod.speed * dt - focusX);
      pod.z = focusZ + wrap(pod.z + dz * pod.speed * dt - focusZ);
      const px = Math.cos(pod.heading); // pod's lateral (right) axis
      const pz = -Math.sin(pod.heading);

      for (const m of pod.members) {
        const wx = pod.x + dx * m.ahead + px * m.lateral;
        const wz = pod.z + dz * m.ahead + pz * m.lateral;
        const u = mod1(time / m.period + m.phase);
        if (u >= AIR) {
          m.obj.visible = false; // diving — let the water hide it
          continue;
        }
        const s = u / AIR; // 0..1 across the leap
        const hop = Math.sin(Math.PI * s); // 0 → 1 → 0
        const surf = sample(wx, wz);
        m.obj.visible = true;
        // -1 so it breaks the surface at the ends of the arc rather than floating.
        m.obj.position.set(wx, surf + m.leapH * hop - 1, wz);
        const pitch = Math.cos(Math.PI * s) * 1.1; // nose up out, level at apex, down in
        m.obj.rotation.set(pitch, pod.heading, 0, "YXZ");
      }
    }
  }

  private updateFish(
    focusX: number,
    focusZ: number,
    time: number,
    dt: number,
    sample: Sampler,
  ): void {
    // Drift + gently steer each school blob.
    for (const sc of this.schools) {
      sc.heading += sc.turn * dt;
      sc.x = focusX + wrap(sc.x + Math.sin(sc.heading) * sc.speed * dt - focusX);
      sc.z = focusZ + wrap(sc.z + Math.cos(sc.heading) * sc.speed * dt - focusZ);
    }

    const AIR = 0.3; // fish are out of the water only briefly
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      const sc = this.schools[f.school];
      const wx = sc.x + f.ox;
      const wz = sc.z + f.oz;
      const u = mod1(time / f.period + f.phase);
      if (u >= AIR) {
        this.dummy.scale.setScalar(0); // submerged — zero-scale hides the instance
      } else {
        const s = u / AIR;
        const hop = Math.sin(Math.PI * s);
        const surf = sample(wx, wz);
        const yaw = sc.heading + Math.sin(time * 8 + f.phase * 10) * 0.3; // tail wiggle
        const pitch = Math.cos(Math.PI * s) * 1.2;
        this.dummy.position.set(wx, surf + f.hopH * hop - 0.3, wz);
        this.dummy.rotation.set(pitch, yaw, 0, "YXZ");
        this.dummy.scale.setScalar(f.size);
      }
      this.dummy.updateMatrix();
      this.fishMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;
  }

  private updateJellies(
    focusX: number,
    focusZ: number,
    time: number,
    dt: number,
    sample: Sampler,
  ): void {
    for (const j of this.jellies) {
      j.x = focusX + wrap(j.x + j.vx * dt - focusX);
      j.z = focusZ + wrap(j.z + j.vz * dt - focusZ);
      const surf = sample(j.x, j.z);
      // Float the bell at the surface, bobbing gently on the swell.
      j.obj.position.set(
        j.x,
        surf + 0.4 + Math.sin(time * j.bob + j.phase) * 0.6,
        j.z,
      );
      j.obj.rotation.y += dt * 0.1;
      // Pulse: squash wide as it relaxes, stretch tall as it contracts.
      const p = Math.sin(time * j.pulse + j.phase);
      j.bell.scale.set(1 - 0.12 * p, 1 + 0.18 * p, 1 - 0.12 * p);
    }
  }
}

/** A stylised dolphin facing +Z: body, pale belly, snout, fins and a fluke. */
function makeDolphin(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({
    color: 0x5d7d92,
    roughness: 0.55,
    metalness: 0.05,
  });
  const bellyMat = new THREE.MeshStandardMaterial({
    color: 0xcddee6,
    roughness: 0.6,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 18, 14), skin);
  body.scale.set(0.7, 0.82, 2.5);
  g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), bellyMat);
  belly.scale.set(0.6, 0.5, 2.3);
  belly.position.y = -0.5;
  g.add(belly);

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.8, 14), skin);
  snout.rotation.x = Math.PI / 2; // point the cone toward +Z
  snout.position.set(0, -0.15, 3.6);
  g.add(snout);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 4), skin);
  dorsal.scale.set(0.16, 1, 0.7);
  dorsal.position.set(0, 1.25, -0.2);
  dorsal.rotation.x = -0.5; // rake it back
  g.add(dorsal);

  for (const sx of [-1, 1]) {
    const pec = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 4), skin);
    pec.scale.set(0.14, 1, 0.5);
    pec.position.set(sx * 0.95, -0.3, 1.3);
    pec.rotation.set(0.3, 0, sx * 1.1);
    g.add(pec);
  }

  const fluke = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.1, 4), skin);
  fluke.scale.set(1, 0.12, 0.7);
  fluke.rotation.x = -Math.PI / 2; // lay the fan flat, trailing aft
  fluke.position.set(0, 0, -3.7);
  g.add(fluke);

  g.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return g;
}

/** A translucent jellyfish: a glowing bell, a frilled rim, and trailing tentacles. */
function makeJelly(): { obj: THREE.Group; bell: THREE.Mesh } {
  const obj = new THREE.Group();
  const tint = 0xff9ed6;
  const bellMat = new THREE.MeshStandardMaterial({
    color: tint,
    emissive: 0xff5fb0,
    emissiveIntensity: 0.35,
    roughness: 0.4,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Dome a little past a hemisphere so it reads as a bell.
  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(3, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    bellMat,
  );
  obj.add(bell);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.4, 8, 24), bellMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.1;
  obj.add(rim);

  const tentMat = new THREE.MeshStandardMaterial({
    color: tint,
    emissive: 0xff5fb0,
    emissiveIntensity: 0.25,
    roughness: 0.5,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tent = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.04, 5, 5),
      tentMat,
    );
    tent.position.set(Math.cos(a) * 1.8, -2.4, Math.sin(a) * 1.8);
    tent.rotation.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
    obj.add(tent);
  }

  obj.renderOrder = 2; // blend over the water surface
  obj.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return { obj, bell };
}

/** Wrap a delta into [-HALF, HALF) so wildlife tiles around the focus point. */
function wrap(d: number): number {
  return d - FIELD * Math.round(d / FIELD);
}

/** Fractional part in [0, 1), for cycling animation phases. */
function mod1(x: number): number {
  return x - Math.floor(x);
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
