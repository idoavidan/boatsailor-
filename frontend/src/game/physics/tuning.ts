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

  // Display / safety
  maxSpeed: number; // nominal top speed (HUD bar + hard safety cap)
}

export const CASUAL_TUNING: PhysicsTuning = {
  mass: 1,
  inertia: 1,
  sailPower: 63, // 63 / 0.9 ≈ 70 top speed on a reach
  noGoAngle: 0.6, // ~34° — can't point closer than this to the wind
  sailFloor: 0.12, // forgiving: still creeps upwind
  windRefSpeed: 105, // ≈ 1.5×maxSpeed: gentle apparent-wind swing. Lower to sharpen it.
  forwardDrag: 0.9,
  lateralDrag: 5,
  brakeDrag: 2.5,
  turnTorque: 4.2, // ~1.4 rad/s turn
  yawDamping: 3,
  steerSpeedRef: 32,
  weatherHelm: 0.3,
  currentCoupling: 0, // current off until a map enables it
  wavePush: 12, // climbing a wave face now noticeably bleeds speed (was 4)
  maxSpeed: 70,
};

export const SPEED_TUNING: PhysicsTuning = {
  mass: 1,
  inertia: 1.1,
  sailPower: 99, // 99 / 0.9 = 110 top speed on a reach
  noGoAngle: 0.68, // ~39° — racier, punishes pinching harder
  sailFloor: 0.06, // dead upwind is nearly stalled — you must tack
  windRefSpeed: 165, // ≈ 1.5×maxSpeed: gentle apparent-wind swing. Lower to sharpen it.
  forwardDrag: 0.9,
  lateralDrag: 6,
  brakeDrag: 3,
  turnTorque: 5.0, // ~1.7 rad/s turn
  yawDamping: 3,
  steerSpeedRef: 40,
  weatherHelm: 0.4,
  currentCoupling: 0,
  wavePush: 14, // climbing a wave face now noticeably bleeds speed (was 4)
  maxSpeed: 110,
};
