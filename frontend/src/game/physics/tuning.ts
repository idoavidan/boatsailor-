/**
 * Data-driven physics constants — one profile per game mode. All feel lives
 * here: tune these numbers without touching the force code. Units are arcade,
 * not SI.
 *
 * Handy relationships when tuning:
 *   top speed      ≈ sailPower / forwardDrag
 *   steady turn    ≈ turnTorque / yawDamping   (rad/s, at full rudder & speed)
 */
export interface PhysicsTuning {
  mass: number;
  inertia: number;

  // Sail (thrust from wind)
  sailPower: number; // peak thrust at full throttle, on a reach, unit wind
  noGoAngle: number; // radians off dead-upwind before the sail starts to draw
  sailFloor: number; // residual drive in the no-go zone (so upwind is very slow)
  windRefSpeed: number; // wind speed on the boat's velocity scale; sets how far the
  // apparent wind swings forward as the boat speeds up. Lower = stronger apparent-
  // wind effect (boat must foot more when fast, can point higher when slow).

  // Hull (water drag)
  forwardDrag: number; // resistance along the bow (with sailPower sets top speed)
  lateralDrag: number; // keel resistance to sideways slip (high = tracks tightly)
  brakeDrag: number; // extra forward drag while braking

  // Steering
  turnTorque: number; // rudder authority
  yawDamping: number; // settles the turn rate (no endless spin)
  steerSpeedRef: number; // speed at which the rudder is fully effective
  weatherHelm: number; // tendency to round up into the wind (sailing character)

  // Environment coupling
  currentCoupling: number; // how strongly water current drags the boat
  wavePush: number; // how strongly wave slopes shove the boat downhill
  surfCoupling: number; // how hard the swell's face pulls you toward its speed (0 = off)

  // Display / safety
  maxSpeed: number; // nominal top speed (HUD bar + hard safety cap)
}

export const CASUAL_TUNING: PhysicsTuning = {
  mass: 1,
  inertia: 1,
  sailPower: 36, // 36 / 0.9 = 40 top speed on a reach (slowed so waves can catch you)
  noGoAngle: 0.6, // ~34° — can't point closer than this to the wind
  sailFloor: 0.12, // forgiving: still creeps upwind
  windRefSpeed: 60, // ≈ 1.5×maxSpeed: gentle apparent-wind swing. Lower to sharpen it.
  forwardDrag: 0.9,
  lateralDrag: 5,
  brakeDrag: 2.5,
  turnTorque: 4.2, // ~1.4 rad/s turn
  yawDamping: 3,
  steerSpeedRef: 18, // full rudder by ~18 (scaled to the slower top speed)
  weatherHelm: 0.3,
  currentCoupling: 0, // current off until a map enables it
  wavePush: 8, // scaled with the slower boat; climbing a face still bleeds speed
  surfCoupling: 1.6, // gentle: a small nudge toward wave speed is enough to ride
  maxSpeed: 40,
};

export const SPEED_TUNING: PhysicsTuning = {
  mass: 1,
  inertia: 1.1,
  sailPower: 56, // 56 / 0.9 ≈ 62 top speed on a reach (slowed so waves can catch you)
  noGoAngle: 0.68, // ~39° — racier, punishes pinching harder
  sailFloor: 0.06, // dead upwind is nearly stalled — you must tack
  windRefSpeed: 93, // ≈ 1.5×maxSpeed: gentle apparent-wind swing. Lower to sharpen it.
  forwardDrag: 0.9,
  lateralDrag: 6,
  brakeDrag: 3,
  turnTorque: 5.0, // ~1.7 rad/s turn
  yawDamping: 3,
  steerSpeedRef: 23, // full rudder by ~23 (scaled to the slower top speed)
  weatherHelm: 0.4,
  currentCoupling: 0,
  wavePush: 9, // scaled with the slower boat; climbing a face still bleeds speed
  surfCoupling: 1.9, // gentle: a small nudge toward wave speed is enough to ride
  maxSpeed: 62,
};
