import * as THREE from "three";
import { createBoatMesh } from "./src/game/Boat";

const boat = createBoatMesh(0x3366cc);
boat.updateMatrixWorld(true);

const f = (n: number) => n.toFixed(2).padStart(7);
const line = (label: string, b: THREE.Box3) =>
  console.log(
    `${label.padEnd(24)} x[${f(b.min.x)},${f(b.max.x)}]  y[${f(b.min.y)},${f(b.max.y)}]  z[${f(b.min.z)},${f(b.max.z)}]`,
  );
const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

console.log("=== Per-part world bounding boxes (boat local frame; +Z=bow, +Y=up) ===");
boat.children.forEach((c, i) => {
  const geo = (c as THREE.Mesh).geometry;
  const label = c.name || `${geo?.type ?? c.type}#${i}`;
  line(label, box(c));
});

const main = boat.getObjectByName("mainsail")!;
const boom = main.children.find(
  (o) => (o as THREE.Mesh).geometry?.type === "CylinderGeometry",
);
if (boom) line("  └ boom (in mainsail)", box(boom));
const crew = boat.getObjectByName("crew");
if (crew) line("crew", box(crew));

// --- Orientation check: is each hull-like piece's bow (max z) actually the
// narrow/pointed end? (A flipped piece points its transom forward.) ---
function profile(mesh: THREE.Mesh, name: string) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const pts: { x: number; z: number }[] = [];
  let zmin = Infinity,
    zmax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    pts.push({ x: v.x, z: v.z });
    zmin = Math.min(zmin, v.z);
    zmax = Math.max(zmax, v.z);
  }
  const span = zmax - zmin || 1;
  const w = (arr: { x: number }[]) =>
    arr.length ? Math.max(...arr.map((p) => Math.abs(p.x))) : 0;
  const fwd = w(pts.filter((p) => p.z > zmax - 0.15 * span));
  const aft = w(pts.filter((p) => p.z < zmin + 0.15 * span));
  console.log(
    `${name.padEnd(24)} half-beam at BOW(maxZ)=${fwd.toFixed(2)}  at STERN(minZ)=${aft.toFixed(2)}  ${fwd < aft ? "→ bow pointed ✓" : "→ BOW IS BLUNT ✗ (flipped?)"}`,
  );
}
console.log("\n=== Bow/stern profile (bow should be the narrow end) ===");
boat.children.forEach((c) => {
  const m = c as THREE.Mesh;
  if (m.geometry?.type === "ExtrudeGeometry" || m.geometry?.type === "ShapeGeometry")
    profile(m, m.name || m.geometry.type);
});

// --- Clearance checks ---
console.log("\n=== Clearances (gap > 0 = no overlap) ===");
const clear = (a: string, oa: THREE.Object3D, b: string, ob: THREE.Object3D) => {
  const ba = box(oa),
    bb = box(ob);
  // vertical gap if their x/z footprints overlap
  const xover = ba.min.x <= bb.max.x && bb.min.x <= ba.max.x;
  const zover = ba.min.z <= bb.max.z && bb.min.z <= ba.max.z;
  const ygap = Math.max(bb.min.y - ba.max.y, ba.min.y - bb.max.y);
  console.log(
    `${a} vs ${b}: x/z footprints overlap=${xover && zover}; vertical gap=${ygap.toFixed(2)}`,
  );
};
if (boom && crew) clear("boom", boom, "crew", crew);
