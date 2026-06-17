import * as THREE from "three";

/**
 * Builds a simple stylized sailboat (hull + deck + mast + sail + flag) from
 * primitives, tinted by the player's hull color. Returns a Group whose +Z is
 * "forward".
 *
 * The boat's *physics* lives in `physics/` — this file is purely the visual.
 */
export function createBoatMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.1,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x8d6748,
    roughness: 0.8,
  });
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });

  // Hull: a stretched, tapered box. ConeGeometry gives a pointed bow.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 11), hullMat);
  hull.position.y = 0.4;
  group.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 4), hullMat);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 0.4, 7);
  bow.scale.set(1, 0.4, 1);
  group.add(bow);

  // Deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 9), woodMat);
  deck.position.y = 1.2;
  group.add(deck);

  // Mast
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 12, 8),
    woodMat,
  );
  mast.position.set(0, 7, 0.5);
  group.add(mast);

  // Main sail: a triangle from mast top to the boom.
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 9);
  sailShape.lineTo(-5, 0);
  sailShape.lineTo(0, 0);
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat);
  // -PI/2 so the boom trails aft (toward -Z, the stern); the rig animates this
  // each frame to trim the sail to the wind.
  sail.rotation.y = -Math.PI / 2;
  sail.position.set(0, 1.8, 0.5);
  sail.name = "mainsail";
  group.add(sail);

  // Jib (front sail)
  const jibShape = new THREE.Shape();
  jibShape.moveTo(0, 0);
  jibShape.lineTo(0, 6);
  jibShape.lineTo(3.5, 0);
  jibShape.lineTo(0, 0);
  const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sailMat);
  jib.rotation.y = Math.PI / 2;
  jib.position.set(0, 1.6, 4.5);
  jib.name = "jib";
  group.add(jib);

  // Flag at the masthead, tinted to the hull color.
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 1),
    new THREE.MeshStandardMaterial({
      color,
      side: THREE.DoubleSide,
      roughness: 0.7,
    }),
  );
  flag.position.set(-1, 12.5, 0.5);
  group.add(flag);

  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return group;
}
