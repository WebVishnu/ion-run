/** Central tunables. Every number here is a playtest starting point. */

export const LANES = 4; // lane 0 = oncoming (danger) lane, lanes 1-3 = same direction
export const LANE_W = 3.4;
export const laneX = (i) => (i - (LANES - 1) / 2) * LANE_W;

export const STEP = 1 / 60; // fixed simulation step (seconds)

export const CEIL_Y = 9.0; // height of the ceiling road surface

export const PLAYER = {
  halfW: 0.95 * 0.88,
  halfL: 2.25 * 0.88,
  height: 1.2,
  laneRate: 15, // exponential lane-change smoothing
};

export const SPEED = {
  start: 24,
  max: 62,
  rampTime: 45, // seconds constant of the ramp
  brakeFactor: 0.72,
  sameDir: 16, // traffic speed (m/s) in lanes 1-3
  oncoming: -26, // traffic speed in lane 0
  nearMissMin: 25, // minimum speed (m/s) for near-miss scoring
};

export const PHYSICS = {
  gravity: 26,
  hopVy: 11.5,
  rampVy: 20,
  maneuverTime: 0.4, // seconds for one 360 degree maneuver
  maxManeuvers: 2,
  cleanAngle: Math.PI / 4, // 45 degrees
  messyAngle: Math.PI / 2, // 90 degrees
  hopCooldown: 0.3,
};

export const BATTERY = {
  max: 100,
  drain: 1.1, // per second
  pad: 30,
  cleanLanding: 8,
  hopCost: 2,
};

export const THRUSTER = {
  maxPips: 3,
  startPips: 2,
  nearMissGain: 0.25,
  cleanLandingGain: 0.5,
};

export const SCORE = {
  distance: 0.25, // points per metre
  nearMiss: 50,
  oncomingMult: 2,
  roll: 150,
  flip: 225,
  comboMult: 2,
  skim: 100,
  streakTime: 3.0,
  streakCap: 5,
};

export const NEAR_BAND = 1.9; // lateral gap (m) counted as a near miss (adjacent lane pass ~1.5 m)
export const SHAVE_BAND = 0.7; // tighter than this is a "close shave" (bonus)
export const SHAVE_MULT = 1.5;

export const CEILING = {
  firstAt: 2200,
  length: 450,
  gapMin: 2000,
  gapMax: 2800,
  suctionMax: 1,
  suctionDrain: 1 / 6.5,
  suctionRefill: 0.3,
  transitUp: 0.5,
  transitDown: 0.6,
  landInvuln: 0.8,
  scoreMult: 2,
  minSuctionToGrab: 0.15,
};

export const SPAWN = {
  horizon: 280,
  despawnBehind: 30,
};

export const DISTRICT_LENGTH = 1800;

export const VEHICLES = {
  sedan: { w: 1.8, l: 4.4, h: 1.45 },
  suv: { w: 2.0, l: 4.7, h: 1.8 },
  van: { w: 2.0, l: 5.2, h: 2.3 },
  truck: { w: 2.5, l: 9.0, h: 3.4 },
  bus: { w: 2.5, l: 11.0, h: 3.3 },
  bike: { w: 0.8, l: 2.0, h: 1.3 },
  barrier: { w: 2.2, l: 1.0, h: 1.25 },
};

export const DIFFICULTY_PRESETS = {
  chill: { diffOffset: -0.25, speedMul: 0.88 },
  normal: { diffOffset: 0, speedMul: 1 },
  hard: { diffOffset: 0.2, speedMul: 1.08 },
};

export const COLORS = {
  // Okabe-Ito based, colour-blind safe traffic palette
  traffic: [0xe69f00, 0x56b4e9, 0x009e73, 0xf0e442, 0xd55e00, 0xcc79a7, 0xbbbbbb],
};
