import * as THREE from "three";

const STREAKS = 560; // how many curvy strokes drift through the air
const SEG = 9; // spine segments per stroke (SEG+1 points)
const FIELD = 1000; // the strokes tile a FIELD×FIELD column around the boat
const HALF = FIELD / 2;
// World drift speed per unit of wind strength. The breeze blows over the ground
// faster than the boat can sail (top speed ~110), so streaks always overtake
// you — sail dead downwind and they barely crawl past; beat upwind and they
// stream at you.
const SPEED_SCALE = 150;

// --- Shared curl field --------------------------------------------------------
// The bend of every streak is read from ONE smooth field defined in world space,
// so two streaks that cross the same place bend the same way (only their start
// position / length / altitude differ). `u` is the downwind coordinate — the
// "plane" a streak crosses — and drives the curl; `p` (cross-wind) adds gentle
// large-scale variation so it isn't a perfectly rigid corrugation.
const AMP = 10; // lateral curl amplitude (world units)
const VAMP = 4.5; // vertical waver amplitude
const WAVE = 35; // undulation wavelength along the wind (smaller = curlier)
const CROSS_VARY = 0.004; // how fast the curl phase shifts across the wind
// The field itself slides downwind at a fraction of the wind, so the curl gently
// flows along each streak as it drifts through, rather than shimmering past.
const FIELD_FLOW_FRAC = 0.55;

// --- Gust field ---------------------------------------------------------------
// A second, larger-scale field that pulses across space and time and multiplies
// each streak's alpha. Whole patches of streaks fade out and swim back in like
// gusts crossing the water — coherent (neighbours fade together), never a global
// blink. Two layered waves keep it from being a regular on/off grid.
const GUST_RATE = 0.6; // how fast patches pulse (rad/s)
const GUST_LOW = 0.4; // gustiness below this is fully gone
const GUST_HIGH = 0.72; // and at/above this it's full strength
const GUST_U1 = 85; // patch wavelengths, layer 1 (downwind / cross-wind)
const GUST_P1 = 70;
const GUST_U2 = 115; // patch wavelengths, layer 2
const GUST_P2 = 55;

/** One streak: just a start position + size. The *shape* comes from the field. */
interface Streak {
  x: number; // centre, world X
  z: number; // centre, world Z
  alt: number; // altitude above the mean water (spreads them through the air)
  len: number; // length along the wind
  bright: number; // peak alpha (kept faint — these are "shy")
}

// Reused per stroke so the update loop allocates nothing.
const spX = new Float32Array(SEG + 1);
const spY = new Float32Array(SEG + 1);
const spZ = new Float32Array(SEG + 1);
const spA = new Float32Array(SEG + 1);

/**
 * Faint white wind streaks: a field of short curvy lines spread through the air
 * at many altitudes that drift downwind and gently flow, so you can read where —
 * and how hard — the breeze is going. Purely decorative.
 *
 * The curl of every streak is sampled from a single world-space flow field (see
 * the constants above), giving the lines local uniformity: different streaks
 * crossing the same plane curve the same, even though each starts somewhere else
 * with its own length and altitude. The field tiles a column around the boat
 * (wrapping in X/Z so it never empties) and fades out toward the column edge so
 * the wrap never pops. Drift direction *and* speed come from the live wind, so
 * the field reorients on a shift and quickens in a gust.
 *
 * Add `mesh` to the scene; call `update()` every frame with the focus point (the
 * boat) and the wind vector sampled there.
 */
export class WindStreaks {
  readonly mesh: THREE.LineSegments;
  private geometry = new THREE.BufferGeometry();
  private positions: Float32Array;
  private alphas: Float32Array;
  private streaks: Streak[] = [];
  private fallback: THREE.Vector2; // wind direction to use in a dead calm
  private advect = 0; // how far the curl field has slid downwind
  private t = 0; // elapsed time, drives the gust-field pulse

  constructor(windDir: THREE.Vector2) {
    this.fallback = windDir.clone().normalize();

    const verts = STREAKS * SEG * 2; // 2 endpoints per segment
    this.positions = new Float32Array(verts * 3);
    this.alphas = new Float32Array(verts);
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(this.alphas, 1),
    );

    for (let i = 0; i < STREAKS; i++) {
      this.streaks.push({
        x: (Math.random() - 0.5) * FIELD,
        z: (Math.random() - 0.5) * FIELD,
        // Biased toward lower altitudes (more streaks skim the water), thinning
        // out higher up so the whole airspace is lightly filled.
        alt: 3 + Math.pow(Math.random(), 1.6) * 70,
        len: 45 + Math.random() * 70,
        bright: 0.32 + Math.random() * 0.3,
      });
    }

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0xffffff) } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.003) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }
      `,
    });

    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // over the water, under the boat wake/ripples
  }

  /**
   * Drift the streaks along the live wind and bend them by the shared field,
   * keeping the column centred on (focusX, focusZ). `windX/windZ` is the air
   * velocity (blows toward) — its direction steers the streaks and its magnitude
   * sets the drift speed.
   */
  update(
    focusX: number,
    focusZ: number,
    windX: number,
    windZ: number,
    dt: number,
  ): void {
    const ws = Math.hypot(windX, windZ);
    // Wind unit (blows toward) + its perpendicular (the curl axis).
    const wx = ws > 1e-4 ? windX / ws : this.fallback.x;
    const wz = ws > 1e-4 ? windZ / ws : this.fallback.y;
    const px = -wz;
    const pz = wx;
    const drift = Math.max(ws, 0.25) * SPEED_SCALE;
    // Slide the curl field downwind (kept bounded to the sine's period).
    this.advect =
      (this.advect + drift * FIELD_FLOW_FRAC * dt) % (WAVE * Math.PI * 2);
    this.t = (this.t + dt) % (Math.PI * 2e4); // bounded; only feeds sines
    let v = 0;

    for (const s of this.streaks) {
      // Drift the whole stroke downwind at the wind's speed.
      s.x += wx * drift * dt;
      s.z += wz * drift * dt;
      // Wrap into the column around the focus (toroidal, so it never empties).
      s.x = focusX + wrap(s.x - focusX);
      s.z = focusZ + wrap(s.z - focusZ);

      // Fade toward the column edge so the wrap seam is invisible.
      const dist = Math.hypot(s.x - focusX, s.z - focusZ);
      const edge = 1 - smoothstep(HALF * 0.55, HALF * 0.97, dist);

      // World coordinates of the stroke's centre, split into downwind (u) and
      // cross-wind (p) axes. `p` is constant along the stroke (its spine runs
      // downwind), so the curl is driven by `u`, which advances point to point.
      const uCentre = s.x * wx + s.z * wz;
      const pCoord = s.x * px + s.z * pz;
      const crossPhase = pCoord * CROSS_VARY;

      // Gust patch alpha for the whole stroke: two layered waves pulsing in
      // space + time, so lines vanish and return together in patches.
      const g1 =
        0.5 + 0.5 * Math.sin(uCentre / GUST_U1 + pCoord / GUST_P1 + this.t * GUST_RATE);
      const g2 =
        0.5 +
        0.5 *
          Math.sin(uCentre / GUST_U2 - pCoord / GUST_P2 + this.t * GUST_RATE * 0.7 + 1.3);
      const gust = smoothstep(GUST_LOW, GUST_HIGH, g1 * 0.6 + g2 * 0.4);
      const strokeAlpha = edge * s.bright * gust;

      for (let k = 0; k <= SEG; k++) {
        const along = (k / SEG - 0.5) * s.len;
        // Phase from the shared field: same plane (u) ⇒ same bend, for every
        // stroke. Cross-wind term varies it slowly across the breeze.
        const phase = (uCentre + along - this.advect) / WAVE + crossPhase;
        const lat = AMP * Math.sin(phase);
        spX[k] = s.x + wx * along + px * lat;
        spZ[k] = s.z + wz * along + pz * lat;
        // Vertical waver from the same field so the stroke curves in 3D too.
        spY[k] = s.alt + VAMP * Math.sin(phase * 1.3 + 2.1);
        // Taper to nothing at both ends so each stroke reads as a soft dash.
        spA[k] = Math.sin((k / SEG) * Math.PI) * strokeAlpha;
      }

      // Emit one line segment between each pair of spine points.
      for (let k = 0; k < SEG; k++) {
        v = this.writeVert(v, spX[k], spY[k], spZ[k], spA[k]);
        v = this.writeVert(v, spX[k + 1], spY[k + 1], spZ[k + 1], spA[k + 1]);
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  private writeVert(v: number, x: number, y: number, z: number, a: number): number {
    this.positions[v * 3] = x;
    this.positions[v * 3 + 1] = y;
    this.positions[v * 3 + 2] = z;
    this.alphas[v] = a;
    return v + 1;
  }
}

/** Wrap a delta into [-HALF, HALF) so the field tiles around the focus. */
function wrap(d: number): number {
  return d - FIELD * Math.round(d / FIELD);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
