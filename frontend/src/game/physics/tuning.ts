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
  sailPower: number; // peak thrust at full throttle, downwind, unit wind
  minWindFactor: number; // thrust multiplier sailing straight into the wind
  windInfluence: number; // 0 = wind direction ignored, 1 = it fully matters

  // Hull (water drag)
  forwardDrag: number; // resistance along the bow (with sailPower sets top speed)
  lateralDrag: number; // keel resistance to sideways slip (high = tracks tightly)
  brakeDrag: number; // extra forward drag while braking

  // Steering
  turnTorque: number; // rudder authority
  yawDamping: number; // settles the turn rate (no endless spin)
  steerSpeedRef: number; // speed at which the rudder is fully effective

  // Environment coupling
  currentCoupling: number; // how strongly water current drags the boat
  wavePush: number; // how strongly wave slopes shove the boat downhill

  // Display / safety
  maxSpeed: number; // nominal top speed (HUD bar + hard safety cap)
}

export const CASUAL_TUNING: PhysicsTuning = {
  mass: 1,
  inertia: 1,
  sailPower: 63, // 63 / 0.9 ≈ 70 top speed
  minWindFactor: 0.55,
  windInfluence: 0.4,
  forwardDrag: 0.9,
  lateralDrag: 5,
  brakeDrag: 2.5,
  turnTorque: 4.5, // 4.5 / 3 = 1.5 rad/s turn
  yawDamping: 3,
  steerSpeedRef: 32,
  currentCoupling: 0, // current off until a map enables it
  wavePush: 4,
  maxSpeed: 70,
};

export const SPEED_TUNING: PhysicsTuning = {
  mass: 1,
  inertia: 1.1,
  sailPower: 99, // 99 / 0.9 = 110 top speed
  minWindFactor: 0.5,
  windInfluence: 0.5,
  forwardDrag: 0.9,
  lateralDrag: 6,
  brakeDrag: 3,
  turnTorque: 5.4, // 5.4 / 3 = 1.8 rad/s turn
  yawDamping: 3,
  steerSpeedRef: 40,
  currentCoupling: 0,
  wavePush: 4,
  maxSpeed: 110,
};
