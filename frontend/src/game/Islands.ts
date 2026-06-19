import * as THREE from "three";

/** A landmass: centre + the land radius at the waterline (also its collision footprint). */
export interface IslandSpec {
  x: number;
  z: number;
  radius: number;
}

const SAND = 0xe6d2a0;
const GRASS = 0x5aa64b;
const FOLIAGE = 0x3f8a37;
const TRUNK = 0x7a5230;
const ROCK = 0x8a8f96;

/**
 * Decorative (and solid) islands for casual mode: a sandy beach rising out of
 * the water, a grassy cap, a little pine forest and a few rocks. Each island is
 * static — anchored to the seabed, not riding the swell — so it's built once and
 * never updated. The same island also becomes a circular collision obstacle so
 * you bump the beach instead of sailing through it.
 *
 * Positions are fixed (see CASUAL_ISLANDS in Game), so every client agrees on
 * where the land is; only the cosmetic scatter of trees/rocks is randomised.
 *
 * Add `group` to the scene and register `obstacles` with the collision world.
 */
export class Islands {
  readonly group = new THREE.Group();
  readonly obstacles: IslandSpec[] = [];

  constructor(specs: IslandSpec[]) {
    for (const s of specs) {
      this.group.add(this.build(s));
      // Collide a touch inside the visible waterline so the hull kisses the sand.
      this.obstacles.push({ x: s.x, z: s.z, radius: s.radius * 0.9 });
    }
  }

  private build(s: IslandSpec): THREE.Group {
    const R = s.radius;
    const isle = new THREE.Group();
    isle.position.set(s.x, 0, s.z);

    const sandMat = new THREE.MeshStandardMaterial({ color: SAND, roughness: 0.95 });
    const grassMat = new THREE.MeshStandardMaterial({ color: GRASS, roughness: 0.9 });

    // Beach: a truncated cone — wide below the water, a narrower plateau on top.
    const beach = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.82, R * 1.15, 18, 28),
      sandMat,
    );
    beach.position.y = -3; // plateau at ~+6, base ~-12 (submerged)
    isle.add(beach);

    // Grass cap on the plateau, topped with a soft dome so it isn't a flat mesa.
    const grassH = R * 0.22;
    const grass = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.46, R * 0.8, grassH, 28),
      grassMat,
    );
    grass.position.y = 6 + grassH / 2;
    isle.add(grass);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.46, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      grassMat,
    );
    dome.position.y = 6 + grassH;
    dome.scale.y = 0.5;
    isle.add(dome);

    const plateauY = 6 + grassH; // where the trees and rocks sit

    // A pale foam collar where the beach meets the water.
    const foam = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.96, 1.2 + R * 0.015, 8, 36),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.7,
        transparent: true,
        opacity: 0.5,
      }),
    );
    foam.rotation.x = Math.PI / 2;
    foam.position.y = 0.4;
    isle.add(foam);

    // Pines, denser on bigger islands. Keep them within the dome's footprint and
    // lift each onto the dome's surface at its radius, so none sink into the hill.
    const domeR = R * 0.46;
    const trees = Math.round(3 + R / 22);
    for (let i = 0; i < trees; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * domeR * 0.8; // even spread, stay on the dome
      const surfaceY = plateauY + 0.5 * Math.sqrt(domeR * domeR - rad * rad);
      const tree = makeTree(0.8 + Math.random() * 0.7);
      tree.position.set(Math.cos(ang) * rad, surfaceY - 0.4, Math.sin(ang) * rad);
      tree.rotation.y = Math.random() * Math.PI * 2;
      isle.add(tree);
    }

    // A few rocks nestled against the sloped sand just above the waterline.
    const rocks = Math.round(1 + R / 50);
    for (let i = 0; i < rocks; i++) {
      const ang = Math.random() * Math.PI * 2;
      const y = 1.5 + Math.random() * 3;
      const size = 1.5 + Math.random() * 2.5;
      const rad = beachRadiusAt(R, y) - size * 0.4; // sit on the beach surface
      const rock = makeRock(size);
      rock.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
      isle.add(rock);
    }

    isle.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    return isle;
  }
}

/** Radius of the beach cone's surface at height y — matches the beach cylinder
 *  (rTop R*0.82 at y=+6, rBottom R*1.15 at y=-12). */
function beachRadiusAt(R: number, y: number): number {
  const frac = THREE.MathUtils.clamp((y + 12) / 18, 0, 1);
  return R * 1.15 + (R * 0.82 - R * 1.15) * frac;
}

/** A simple pine: a trunk under three stacked foliage cones. */
function makeTree(scale: number): THREE.Group {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.0, 7, 6),
    new THREE.MeshStandardMaterial({ color: TRUNK, roughness: 0.9 }),
  );
  trunk.position.y = 3.5;
  tree.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({ color: FOLIAGE, roughness: 0.85 });
  const layers = [
    { y: 7, r: 5, h: 6 },
    { y: 10.5, r: 4, h: 5.5 },
    { y: 13.5, r: 2.7, h: 4.5 },
  ];
  for (const l of layers) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(l.r, l.h, 8), foliageMat);
    cone.position.y = l.y;
    tree.add(cone);
  }

  tree.scale.setScalar(scale);
  return tree;
}

/** A faceted boulder, squashed and tumbled a little for variety. */
function makeRock(size: number): THREE.Mesh {
  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(size, 0),
    new THREE.MeshStandardMaterial({ color: ROCK, roughness: 1, flatShading: true }),
  );
  rock.scale.set(1, 0.7 + Math.random() * 0.3, 1);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  return rock;
}
