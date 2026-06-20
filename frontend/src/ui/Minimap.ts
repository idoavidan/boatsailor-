import { WORLD } from "../protocol";

/**
 * A small tactical radar drawn on a 2D canvas, oriented "leg-up": the mark you
 * are heading for sits at the top, the mark you came from at the bottom, and
 * everything rotates with the current leg so up is always "toward the next
 * mark". On a beat it overlays the no-go-zone laylines fanning down from the
 * next mark — the dashed lines you sail out to before you tack — plus every
 * other boat as a coloured arrow.
 *
 * Speed mode only (it needs a course). Pure canvas, redrawn each frame by the
 * Game; no allocations beyond a couple of locals.
 */

/** A boat plotted on the map: world position, heading, hull colour. */
export interface MinimapBoat {
  x: number;
  z: number;
  heading: number;
  color: number;
}

/** A course mark plotted on the map. `angle` orients a line mark's gate. */
export interface MinimapMark {
  x: number;
  z: number;
  kind: "line" | "buoy";
  angle: number;
}

export interface MinimapView {
  boat: MinimapBoat; // the local boat
  others: MinimapBoat[];
  next: MinimapMark; // top of the map
  prev: MinimapMark; // bottom of the map
  /** Air velocity (the direction the wind blows TOWARD) at the boat. */
  wind: { x: number; z: number };
  noGoAngle: number; // radians; half-width of the no-go zone
  isBeat: boolean; // draw the laylines only when the next mark is upwind
}

/** Drawing size in CSS pixels (the canvas is square). */
const SIZE = 200;
/** How far the marks sit from the centre, as a fraction of the radius. */
const MARK_SPAN = 0.62;
/**
 * Handedness of the map's left/right axis. The map is a bird's-eye view with
 * the leg pointing up; -1 puts the boat's starboard side on the right, matching
 * the chase camera (the +1 convention read mirrored against the 3D view).
 */
const STARBOARD_SIGN = -1;

export class Minimap {
  private canvas = byId("minimap") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;

  constructor() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.ctx.scale(dpr, dpr);
  }

  show(): void {
    this.canvas.classList.remove("hidden");
  }

  hide(): void {
    this.canvas.classList.add("hidden");
  }

  update(v: MinimapView): void {
    const ctx = this.ctx;
    const R = SIZE / 2;
    const cx = R;
    const cy = R;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // --- Leg frame: prev mark -> next mark defines "up". ------------------
    let ux = v.next.x - v.prev.x;
    let uz = v.next.z - v.prev.z;
    const legLen = Math.hypot(ux, uz) || 1;
    ux /= legLen;
    uz /= legLen;
    const midX = (v.prev.x + v.next.x) / 2;
    const midZ = (v.prev.z + v.next.z) / 2;
    const scale = (2 * MARK_SPAN * R) / legLen;

    // World (x, z) -> canvas (px, py), with the leg pointing straight up.
    const project = (x: number, z: number): [number, number] => {
      const dx = x - midX;
      const dz = z - midZ;
      const along = dx * ux + dz * uz; // + = toward the next mark
      const cross = (dx * uz - dz * ux) * STARBOARD_SIGN; // + = starboard
      return [cx + cross * scale, cy - along * scale];
    };

    // --- Disc background (everything inside is clipped to it). ------------
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(10, 28, 38, 0.62)";
    ctx.fill();
    ctx.clip();

    // --- No-go laylines from the next mark (only on a beat). --------------
    // The laylines fan DOWNWIND from the mark at ±noGoAngle off dead-downwind:
    // a close-hauled boat that reaches one can tack and just fetch the mark.
    if (v.isBeat) {
      const wl = Math.hypot(v.wind.x, v.wind.z) || 1;
      const dwx = v.wind.x / wl; // downwind unit (wind blows toward)
      const dwz = v.wind.z / wl;
      const a = v.noGoAngle;
      const far = legLen * 1.8;
      const [p1x, p1z] = rotate(dwx, dwz, a);
      const [p2x, p2z] = rotate(dwx, dwz, -a);
      const apex = project(v.next.x, v.next.z);
      const e1 = project(v.next.x + p1x * far, v.next.z + p1z * far);
      const e2 = project(v.next.x + p2x * far, v.next.z + p2z * far);

      ctx.beginPath();
      ctx.moveTo(apex[0], apex[1]);
      ctx.lineTo(e1[0], e1[1]);
      ctx.lineTo(e2[0], e2[1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(226, 85, 85, 0.14)";
      ctx.fill();

      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 120, 120, 0.95)";
      ctx.beginPath();
      ctx.moveTo(apex[0], apex[1]);
      ctx.lineTo(e1[0], e1[1]);
      ctx.moveTo(apex[0], apex[1]);
      ctx.lineTo(e2[0], e2[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- Rhumb line (straight prev -> next). -----------------------------
    const a0 = project(v.prev.x, v.prev.z);
    const a1 = project(v.next.x, v.next.z);
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.moveTo(a0[0], a0[1]);
    ctx.lineTo(a1[0], a1[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Marks: previous (dim, bottom) then next (bright, top). -----------
    this.drawMark(project, v.prev, false);
    this.drawMark(project, v.next, true);

    // --- Boats: others first, local on top. ------------------------------
    for (const o of v.others) this.drawBoat(project, ux, uz, o, false);
    this.drawBoat(project, ux, uz, v.boat, true);

    // --- Wind origin marker on the rim. ----------------------------------
    this.drawWind(cx, cy, R, ux, uz, v.wind);

    ctx.restore();

    // --- Rim + distance readout (outside the clip). ----------------------
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.stroke();

    const meters = Math.round(
      Math.hypot(v.next.x - v.boat.x, v.next.z - v.boat.z) / 5,
    );
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255, 226, 122, 0.95)";
    ctx.fillText(`▲ ${meters} m`, cx, 8);
  }

  /** A mark: an orange disc for a buoy, a coloured gate bar for a line. */
  private drawMark(
    project: (x: number, z: number) => [number, number],
    mk: MinimapMark,
    bright: boolean,
  ): void {
    const ctx = this.ctx;
    const [sx, sy] = project(mk.x, mk.z);

    if (mk.kind === "buoy") {
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = bright ? "#ff7a18" : "rgba(255, 122, 24, 0.5)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.stroke();
    } else {
      // Gate bar spanning the line's lateral axis (perpendicular to its angle).
      const lx = Math.cos(mk.angle);
      const lz = -Math.sin(mk.angle);
      const half = WORLD.startLineHalf;
      const g1 = project(mk.x + lx * half, mk.z + lz * half);
      const g2 = project(mk.x - lx * half, mk.z - lz * half);
      ctx.lineWidth = 3;
      ctx.strokeStyle = bright ? "#37d67a" : "rgba(238, 243, 247, 0.55)";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(g1[0], g1[1]);
      ctx.lineTo(g2[0], g2[1]);
      ctx.stroke();
      ctx.lineCap = "butt";
    }

    if (bright) {
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255, 210, 74, 0.9)";
      ctx.stroke();
    }
  }

  /** A boat arrow, pointing the way it's heading within the leg frame. */
  private drawBoat(
    project: (x: number, z: number) => [number, number],
    ux: number,
    uz: number,
    b: MinimapBoat,
    local: boolean,
  ): void {
    const ctx = this.ctx;
    const R = SIZE / 2;
    let [sx, sy] = project(b.x, b.z);
    [sx, sy] = clampToDisc(sx, sy, R, local ? 8 : 6);

    // Heading expressed in the leg frame: 0 = straight up the leg.
    const fx = Math.sin(b.heading);
    const fz = Math.cos(b.heading);
    const fAlong = fx * ux + fz * uz;
    const fCross = (fx * uz - fz * ux) * STARBOARD_SIGN;
    const ang = Math.atan2(fCross, fAlong);

    const s = local ? 7 : 5;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(-s * 0.72, s * 0.8);
    ctx.lineTo(s * 0.72, s * 0.8);
    ctx.closePath();
    ctx.fillStyle = hex(b.color);
    ctx.fill();
    ctx.lineWidth = local ? 2 : 1;
    ctx.strokeStyle = local ? "#ffffff" : "rgba(255, 255, 255, 0.7)";
    ctx.stroke();
    ctx.restore();
  }

  /** A small chevron on the rim showing where the wind blows FROM. */
  private drawWind(
    cx: number,
    cy: number,
    R: number,
    ux: number,
    uz: number,
    wind: { x: number; z: number },
  ): void {
    const wl = Math.hypot(wind.x, wind.z) || 1;
    // Upwind (where the wind comes from), in the leg frame.
    const fromX = -wind.x / wl;
    const fromZ = -wind.z / wl;
    const along = fromX * ux + fromZ * uz;
    const cross = (fromX * uz - fromZ * ux) * STARBOARD_SIGN;
    const ang = Math.atan2(cross, along); // 0 = top of the map
    const dirX = Math.sin(ang);
    const dirY = -Math.cos(ang);
    const px = cx + dirX * (R - 13);
    const py = cy + dirY * (R - 13);

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang); // arrow points inward, the way the wind blows
    ctx.fillStyle = "rgba(180, 220, 255, 0.95)";
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(-4, -3);
    ctx.lineTo(4, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Rotate a 2D vector (x, z) by `a` radians. */
function rotate(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}

/** Keep a point within the disc, pulling it to the rim if it falls outside. */
function clampToDisc(
  px: number,
  py: number,
  R: number,
  margin: number,
): [number, number] {
  const cx = R;
  const cy = R;
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  const lim = R - margin;
  if (d <= lim || d === 0) return [px, py];
  return [cx + (dx / d) * lim, cy + (dy / d) * lim];
}

function hex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}
