import * as THREE from "three";

/**
 * Builds a stylized — but properly hull-shaped — sailboat from primitives,
 * tinted by the player's hull colour. Returns a Group whose +Z is "forward".
 *
 * Named sub-objects the Game drives each frame:
 *   "mainsail" — main + boom; swung as one to trim to the wind (rotation.y).
 *   "jib"      — the foresail; trimmed alongside the main.
 *   "crew"     — the sailor; slid to the windward rail to balance the heel.
 *
 * Layout is verified by verify-boat.ts — keep the deck/rail/rig clear of each
 * other and the boom above the crew's head.
 *
 * The boat's *physics* lives in `physics/`; this file is purely the visual. The
 * one exception is the "crew" node, which the Game hikes out against the boom as
 * part of the heel/weight model (see Game.updateCrew).
 */
export function createBoatMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.12,
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x9c7a55,
    roughness: 0.85,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xeef3f6,
    roughness: 0.6,
  });
  const sparMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2c6,
    roughness: 0.5,
    metalness: 0.25,
  });
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xf6f6f4,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });

  // --- Hull: a real boat plan (pointed bow → beamy midships → narrow transom)
  //     extruded into a rounded, bevelled body. The bevel adds ~0.5 all round,
  //     so the finished hull is ≈ x±3.25, z[-7, 9.8], y[-1.7, 1.7]. ---
  const B = 2.7; // half-beam amidships (pre-bevel)
  const Lb = 9; // length forward of midships (to the bow)
  const Ls = 6.5; // length aft of midships (to the transom)
  const plan = new THREE.Shape();
  plan.moveTo(0, Lb); // bow tip
  plan.bezierCurveTo(B * 1.05, Lb * 0.45, B, Lb * 0.18, B, 0); // starboard bow → max beam
  plan.bezierCurveTo(B, -Ls * 0.5, B * 0.72, -Ls * 0.9, B * 0.5, -Ls); // → transom corner
  plan.lineTo(-B * 0.5, -Ls); // transom
  plan.bezierCurveTo(-B * 0.72, -Ls * 0.9, -B, -Ls * 0.5, -B, 0); // port quarter → max beam
  plan.bezierCurveTo(-B, Lb * 0.18, -B * 1.05, Lb * 0.45, 0, Lb); // → bow tip

  const hullGeo = new THREE.ExtrudeGeometry(plan, {
    depth: 2.3, // hull depth (extruded downward once rotated)
    bevelEnabled: true,
    bevelThickness: 0.55,
    bevelSize: 0.55,
    bevelSegments: 3,
    steps: 1,
  });
  // Shape plane (x = beam, y = length) → deck plane; extrude (+z) → downward.
  // rotateX(+90°) keeps the bow at +Z (verified against the deck/rail).
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.translate(0, 1.15, 0); // freeboard above the water, keel below it
  hullGeo.computeVertexNormals();
  group.add(new THREE.Mesh(hullGeo, hullMat));

  // Pale gunwale/toe-rail capping the sheer. Scaled proud of the bevelled hull
  // so it actually rings the deck edge instead of sinking into it.
  const rail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(plan, { depth: 0.34, bevelEnabled: false, steps: 1 }),
    trimMat,
  );
  rail.rotation.x = Math.PI / 2;
  rail.scale.set(1.18, 1.18, 1); // grow beam + length (NOT thickness)
  rail.position.y = 1.5;
  group.add(rail);

  // Wooden deck, a thin slab inset just inside the rail. Built as an extrude
  // (not a flat ShapeGeometry) so the bow points forward with upward normals.
  const deck = new THREE.Mesh(
    new THREE.ExtrudeGeometry(plan, { depth: 0.12, bevelEnabled: false, steps: 1 }),
    deckMat,
  );
  deck.rotation.x = Math.PI / 2;
  deck.scale.set(0.9, 0.9, 1);
  deck.position.y = 1.52;
  group.add(deck);

  // Shallow cockpit the crew sits in, plus a small companionway bump at its
  // forward end (clear of the mast ahead and the crew behind).
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 3.6), deckMat);
  cockpit.position.set(0, 1.35, -2.6);
  group.add(cockpit);
  const companionway = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.6), trimMat);
  companionway.position.set(0, 1.85, -0.7);
  group.add(companionway);

  // --- Rig (much bigger sail than before; boom raised to clear the crew). ---
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.22, 23, 10),
    sparMat,
  );
  mast.position.set(0, 11.5, 1.0);
  group.add(mast);

  // Mainsail + boom as one swinging unit, named so the Game can trim it. The
  // sail is a tall triangle from near the masthead down to the boom; the boom is
  // the spar along its foot. rotation.y is overwritten each frame to ease it to
  // leeward. Boom height 4.5 sits well above the crew's head (~3.6).
  const BOOM_Y = 4.5;
  const LUFF = 17; // sail height up the mast
  const FOOT = 9.5; // sail length along the boom
  const main = new THREE.Group();
  main.name = "mainsail";
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0); // tack (at the mast, boom height)
  sailShape.lineTo(0, LUFF); // up the luff
  sailShape.lineTo(-FOOT, 0); // out to the clew (aft)
  sailShape.lineTo(0, 0);
  main.add(new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat));
  const boom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, FOOT + 0.2, 8),
    sparMat,
  );
  boom.rotation.z = Math.PI / 2; // lay it along the foot (local X)
  boom.position.x = -(FOOT + 0.2) / 2;
  main.add(boom);
  // -PI/2 so the boom trails aft (toward -Z); the Game re-eases this each frame.
  main.rotation.y = -Math.PI / 2;
  main.position.set(0, BOOM_Y, 1.0);
  group.add(main);

  // Jib (foresail), forward of the mast over the foredeck; bigger to match.
  const jibShape = new THREE.Shape();
  jibShape.moveTo(0, 0);
  jibShape.lineTo(0, 13); // luff
  jibShape.lineTo(5.5, 0); // foot to the clew
  jibShape.lineTo(0, 0);
  const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sailMat);
  jib.rotation.y = Math.PI / 2;
  jib.position.set(0, 1.8, 7.2);
  jib.name = "jib";
  group.add(jib);

  // Burgee on a short pivot at the masthead, tinted to the hull colour. The
  // cloth is hoisted at the pole and flies out along +X; the Game yaws this
  // pivot each frame so it streams downwind (see Game.updateFlags).
  const flag = new THREE.Group();
  flag.name = "flag";
  flag.position.set(0, 22, 1.0);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.1),
    new THREE.MeshStandardMaterial({
      color,
      side: THREE.DoubleSide,
      roughness: 0.7,
    }),
  );
  cloth.position.x = 1.3; // hoist at the pole, fly out downwind
  flag.add(cloth);
  group.add(flag);

  // --- Crew: a small sailor in the cockpit. Origin at the seat so the Game can
  //     slide them to the rail (position.x) and hike the torso out (rotation.z). ---
  group.add(makeSailor());

  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return group;
}

/** A compact figure: legs, life-vested torso, head and arms. Its origin sits at
 *  the seat in the cockpit so leaning about it reads as hiking out. */
function makeSailor(): THREE.Group {
  const crew = new THREE.Group();
  crew.name = "crew";

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe7b48b,
    roughness: 0.8,
  });
  const vestMat = new THREE.MeshStandardMaterial({
    color: 0xff7a33,
    roughness: 0.7,
  });
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x2b4a6b,
    roughness: 0.85,
  });

  // Thighs reaching forward/inboard (knees up, sitting on the rail).
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.36, 1.6), legMat);
  legs.position.set(0, 0.32, 0.65);
  crew.add(legs);

  // Torso, leaning back a touch.
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.4, 1.15, 10),
    vestMat,
  );
  torso.position.set(0, 1.05, 0.12);
  torso.rotation.x = 0.18;
  crew.add(torso);

  // Arms along the sides.
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.95, 0.2), skinMat);
    arm.position.set(sx * 0.46, 1.05, 0.16);
    crew.add(arm);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), skinMat);
  head.position.set(0, 1.85, 0.06);
  crew.add(head);

  // Seat in the cockpit, on the centreline by default (remote boats leave it
  // here; the local Game slides it to the windward rail).
  crew.position.set(0, 1.4, -2.7);
  return crew;
}
