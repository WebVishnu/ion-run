import {
  BATTERY,
  CEIL_Y,
  CEILING,
  DIFFICULTY_PRESETS,
  DISTRICT_LENGTH,
  LANES,
  NEAR_BAND,
  PHYSICS,
  PLAYER,
  SCORE,
  SHAVE_BAND,
  SHAVE_MULT,
  SPAWN,
  SPEED,
  THRUSTER,
  VEHICLES,
  laneX,
} from '../config.js';
import { createRng } from './rng.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
};
const easeInOut = (t) => t * t * (3 - 2 * t);

/**
 * Pure, deterministic game simulation. No DOM, no rendering.
 * The renderer, audio and UI read `sim.state` and consume `sim.events`.
 */
export function createSim({ seed = 1, difficulty = 'normal', autoTrick = false } = {}) {
  // Separate streams per spawner, and spawn content depends only on distance (never on player speed),
  // so a daily seed produces the same road for everybody.
  const rng = createRng(seed); // ground rows
  const rngOnc = createRng(seed ^ 0x9e3779b9); // oncoming cars
  const rngCeil = createRng(seed ^ 0x85ebca6b); // ceiling rows and ceiling oncoming
  const rngZone = createRng(seed ^ 0xc2b2ae35); // zone placement
  const preset = DIFFICULTY_PRESETS[difficulty] ?? DIFFICULTY_PRESETS.normal;

  const state = {
    t: 0,
    dist: 0,
    speed: SPEED.start * preset.speedMul,
    brakeMul: 1,
    braking: false,
    score: 0,
    over: false,
    overReason: null,
    battery: BATTERY.max,
    pips: THRUSTER.startPips,
    suction: CEILING.suctionMax,
    streak: 0,
    streakTimer: 0,
    mult: 1,
    district: 0,
    batteryLowSent: false,
    zone: null,
    zoneWarned: false,
    vehicles: [],
    pads: [],
    ramps: [],
    player: {
      lane: 2,
      x: laneX(2),
      y: 0,
      vy: 0,
      air: false,
      level: 0,
      transit: null,
      invuln: 0,
      cooldown: 0,
      maneuvers: [], // queue: { axis: 'roll' | 'pitch', dir, t }
      done: 0, // completed maneuvers this hop
      donePoints: 0,
      rollAngle: 0,
      pitchAngle: 0,
      autoTrickUsed: false,
    },
    pose: { x: laneX(2), y: 0, roll: 0, pitch: 0, level: 0 },
    stats: {
      nearMisses: 0,
      oncomingPasses: 0,
      maxStreak: 0,
      tricks: 0,
      rolls: 0,
      flips: 0,
      combos: 0,
      cleanLandings: 0,
      hops: 0,
      rampJumps: 0,
      skims: 0,
      pads: 0,
      ceilingMeters: 0,
      ceilingDrops: 0,
      maxSpeed: 0,
    },
  };

  const spawn = {
    nextRowZ: 110,
    prevFree: [2], // the player starts in lane 2
    ceilPrevFree: [1, 2, 3], // the player can enter the roof from any lane
    lastPadZ: 40,
    padGap: 150,
    nextOncomingZ: 90,
    ceilOncomingZ: 0,
    nextZoneAt: CEILING.firstAt,
    ceilRowZ: 0,
    ceilLastPadZ: 0,
    nextId: 1,
  };

  const events = [];
  const emit = (type, data) => events.push({ type, ...data });

  /** Difficulty and expected speed as functions of road distance, so spawning is independent of how the player drives. */
  const diffAt = (z) => clamp(z / 4200 + preset.diffOffset, 0, 1);
  const speedAt = (z) => SPEED.start + (SPEED.max - SPEED.start) * (1 - Math.exp(-z / 2000));

  // ---------------------------------------------------------------- spawning
  function addVehicle(type, lane, z, level, r) {
    const dims = VEHICLES[type];
    const oncoming = lane === 0; // lane 0 carries oncoming traffic on both roads
    state.vehicles.push({
      id: spawn.nextId++,
      type,
      lane,
      level,
      x: laneX(lane),
      z,
      z0: z,
      prevRel: z - state.dist,
      // every same-direction vehicle (barrier trailers included) moves at the same speed, so rows never shear apart
      vz: oncoming ? SPEED.oncoming : SPEED.sameDir,
      w: dims.w,
      l: dims.l,
      h: dims.h,
      color: r.int(0, 6),
      scored: false,
      skimmed: false,
    });
  }

  function pickBlockerType(diff, level, r) {
    if (level === 1) return r.pick(['sedan', 'sedan', 'suv', 'van']);
    const x = r.next();
    if (x < 0.14) return 'barrier';
    if (x < 0.5) return 'sedan';
    if (x < 0.72) return 'suv';
    if (x < 0.85) return 'van';
    return diff > 0.3 && r.chance(0.55) ? 'truck' : diff > 0.3 ? 'bus' : 'sedan';
  }

  const FREE_SETS = {
    1: [[1], [2], [3]],
    2: [[1, 2], [2, 3], [1, 3]],
  };

  /**
   * Picks the free lanes (of 1..3) for a new row. Fairness rule: from EVERY free lane of the previous row the
   * player must be able to reach a free lane of this row with a single lane change, so no choice traps them.
   */
  function chooseFree(prevFree, diff, r) {
    const pSingle = clamp(0.12 + 0.6 * diff, 0, 0.7);
    const want = r.chance(pSingle) ? 1 : 2;
    const ok = (set) => prevFree.every((f) => set.some((g) => Math.abs(f - g) <= 1));
    for (const size of [want, 3 - want]) {
      const valid = FREE_SETS[size].filter(ok);
      if (valid.length) return r.pick(valid);
    }
    return [2]; // the middle lane is adjacent to every lane
  }

  function spawnRow(level) {
    const isCeil = level === 1;
    const r = isCeil ? rngCeil : rng;
    const z = isCeil ? spawn.ceilRowZ : spawn.nextRowZ;
    const diff = diffAt(z);
    const free = chooseFree(isCeil ? spawn.ceilPrevFree : spawn.prevFree, isCeil ? diff * 0.8 : diff, r);
    const blocked = [1, 2, 3].filter((l) => !free.includes(l));
    for (const lane of blocked) addVehicle(pickBlockerType(diff, level, r), lane, z, level, r);

    const lastPad = isCeil ? spawn.ceilLastPadZ : spawn.lastPadZ;
    const padGap = isCeil ? 110 : spawn.padGap;
    if (z - lastPad > padGap) {
      const lane = !isCeil && r.chance(0.4) ? 0 : r.pick(free);
      state.pads.push({ id: spawn.nextId++, lane, x: laneX(lane), z, level, taken: false });
      if (isCeil) spawn.ceilLastPadZ = z;
      else {
        spawn.lastPadZ = z;
        spawn.padGap = r.range(140, 200);
      }
    } else if (!isCeil && free.length >= 2 && r.chance(0.1)) {
      // ramps are optional: only placed when another free lane exists, so nobody is forced to launch
      const lane = r.pick(free);
      state.ramps.push({ id: spawn.nextId++, lane, x: laneX(lane), z: z + 2, level: 0, used: false });
    }

    if (isCeil) spawn.ceilPrevFree = free;
    else spawn.prevFree = free;

    const v = Math.max(speedAt(z), 24) * 1.1;
    const gap = Math.max(30, (v - SPEED.sameDir) * (0.9 - 0.25 * diff)) + 12;
    if (isCeil) spawn.ceilRowZ += gap * 1.15;
    else spawn.nextRowZ += gap;
  }

  function spawnOncoming(level) {
    const isCeil = level === 1;
    const r = isCeil ? rngCeil : rngOnc;
    const z = isCeil ? spawn.ceilOncomingZ : spawn.nextOncomingZ;
    const diff = diffAt(z);
    const type = r.pick(diff > 0.4 ? ['sedan', 'suv', 'van', 'bike', 'sedan'] : ['sedan', 'suv', 'bike']);
    addVehicle(type, 0, z, level, r);
    const step = r.range(35, 90) * (1.25 - 0.6 * diff) * (isCeil ? 1.4 : 1);
    if (isCeil) spawn.ceilOncomingZ += step;
    else spawn.nextOncomingZ += step;
  }

  function spawnAhead() {
    const limit = state.dist + SPAWN.horizon;
    while (spawn.nextRowZ < limit) spawnRow(0);
    while (spawn.nextOncomingZ < limit) spawnOncoming(0);

    if (!state.zone && spawn.nextZoneAt < limit) {
      state.zone = { start: spawn.nextZoneAt, end: spawn.nextZoneAt + CEILING.length };
      spawn.ceilRowZ = state.zone.start + 60;
      spawn.ceilOncomingZ = state.zone.start + 90;
      spawn.ceilLastPadZ = state.zone.start;
      spawn.nextZoneAt = state.zone.end + rngZone.range(CEILING.gapMin, CEILING.gapMax);
      state.zoneWarned = false;
    }
    if (state.zone) {
      const end = Math.min(state.zone.end - 40, limit);
      while (spawn.ceilRowZ < end) spawnRow(1);
      while (spawn.ceilOncomingZ < end) spawnOncoming(1);
    }
  }

  // ---------------------------------------------------------------- scoring
  function multiplier() {
    return Math.min(SCORE.streakCap, 1 + Math.floor(state.streak / 3) * 0.5);
  }

  function addScore(points) {
    state.score += points;
  }

  function registerNearMiss(e, gap) {
    state.streak += 1;
    state.streakTimer = SCORE.streakTime;
    state.mult = multiplier();
    state.stats.maxStreak = Math.max(state.stats.maxStreak, state.streak);
    state.stats.nearMisses += 1;
    const oncoming = e.vz < 0;
    if (oncoming) state.stats.oncomingPasses += 1;
    const zoneMult = state.player.level === 1 ? CEILING.scoreMult : 1;
    const shave = gap < SHAVE_BAND;
    const pts = Math.round(
      SCORE.nearMiss * state.mult * (oncoming ? SCORE.oncomingMult : 1) * zoneMult * (shave ? SHAVE_MULT : 1),
    );
    addScore(pts);
    state.pips = Math.min(THRUSTER.maxPips, state.pips + THRUSTER.nearMissGain);
    emit('nearMiss', { points: pts, streak: state.streak, mult: state.mult, oncoming, shave, x: e.x });
  }

  // ---------------------------------------------------------------- actions
  function inZone() {
    return !!state.zone && state.dist >= state.zone.start && state.dist <= state.zone.end;
  }

  function startManeuver(axis, dir) {
    const p = state.player;
    if (p.done + p.maneuvers.length >= PHYSICS.maxManeuvers) return;
    p.maneuvers.push({ axis, dir, t: 0 });
    emit('maneuver', { axis, dir });
  }

  function hop() {
    const p = state.player;
    if (p.level !== 0 || p.air || p.transit || p.cooldown > 0 || state.pips < 1) return false;
    state.pips -= 1;
    state.battery = Math.max(0, state.battery - BATTERY.hopCost);
    p.vy = PHYSICS.hopVy;
    p.air = true;
    p.done = 0;
    p.donePoints = 0;
    p.autoTrickUsed = false;
    state.stats.hops += 1;
    emit('hop', {});
    return true;
  }

  function beginTransit(dir) {
    const p = state.player;
    p.transit = {
      dir,
      t: 0,
      dur: dir > 0 ? CEILING.transitUp : CEILING.transitDown,
      startY: p.y,
    };
    p.maneuvers.length = 0;
    p.rollAngle = 0;
    p.pitchAngle = 0;
    p.vy = 0;
    p.air = false;
  }

  function grab() {
    const p = state.player;
    if (p.transit) return false;
    if (p.level === 1) {
      beginTransit(-1);
      emit('ceilDrop', { reason: 'manual' });
      return true;
    }
    if (!inZone() || state.suction < CEILING.minSuctionToGrab) return false;
    if (!p.air) {
      if (state.pips < 1) return false; // the hop cooldown does not block grabbing the roof
      state.pips -= 1;
      state.battery = Math.max(0, state.battery - BATTERY.hopCost);
    }
    beginTransit(1);
    emit('ceilGrab', {});
    return true;
  }

  /** Discrete player actions: left, right, up, down, hop, grab. */
  function action(name) {
    if (state.over) return;
    const p = state.player;
    if (p.transit) return;
    switch (name) {
      case 'left':
      case 'right': {
        const dir = name === 'left' ? -1 : 1;
        if (p.air) {
          startManeuver('roll', dir);
          p.lane = clamp(p.lane + dir, 0, LANES - 1);
        } else if (p.lane + dir >= 0 && p.lane + dir < LANES) {
          p.lane += dir;
          emit('lane', { dir });
        }
        break;
      }
      case 'up':
      case 'down':
        if (p.air) startManeuver('pitch', name === 'up' ? 1 : -1);
        break;
      case 'hop':
        if (p.level === 1) grab();
        else if (p.air) startManeuver('pitch', 1); // pressing hop again in the air (double tap) is a front flip
        else hop();
        break;
      case 'grab':
        grab();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- landing
  function maneuverBase(axis) {
    return axis === 'roll' ? SCORE.roll : SCORE.flip;
  }

  function land() {
    const p = state.player;
    let err = 0;
    if (p.maneuvers.length) {
      const m = p.maneuvers[0];
      err = Math.abs(wrapPi(m.dir * TAU * easeInOut(clamp(m.t / PHYSICS.maneuverTime, 0, 1))));
    }
    p.y = 0;
    p.vy = 0;
    p.air = false;
    p.cooldown = PHYSICS.hopCooldown;
    p.maneuvers.length = 0;
    p.rollAngle = 0;
    p.pitchAngle = 0;

    if (err > PHYSICS.messyAngle) {
      crash('landing');
      return;
    }
    if (err > PHYSICS.cleanAngle) {
      state.streak = 0;
      state.mult = 1;
      const pts = Math.round(p.donePoints * 0.5);
      addScore(pts);
      emit('landMessy', { points: pts });
    } else if (p.done === 0) {
      // a plain hop or ramp jump with no trick: safe, but no bonus (otherwise hopping would farm battery and goals)
      emit('land', {});
    } else {
      const combo = p.done >= 2;
      if (combo) state.stats.combos += 1;
      const pts = Math.round(p.donePoints * (combo ? SCORE.comboMult : 1) * state.mult);
      addScore(pts);
      state.battery = Math.min(BATTERY.max, state.battery + BATTERY.cleanLanding);
      state.pips = Math.min(THRUSTER.maxPips, state.pips + THRUSTER.cleanLandingGain);
      state.stats.cleanLandings += 1;
      emit('landClean', { points: pts, maneuvers: p.done, combo });
    }
    p.done = 0;
    p.donePoints = 0;
  }

  function crash(reason) {
    if (state.over) return;
    state.over = true;
    state.overReason = reason;
    emit('crash', { reason });
  }

  // ---------------------------------------------------------------- update parts
  function updatePlayerMotion(dt) {
    const p = state.player;
    p.x += (laneX(p.lane) - p.x) * (1 - Math.exp(-PLAYER.laneRate * dt));
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    if (p.transit) {
      p.transit.t += dt;
      if (p.transit.t >= p.transit.dur) {
        const dir = p.transit.dir;
        p.transit = null;
        if (dir > 0) {
          p.level = 1;
          p.y = 0;
          p.invuln = 0.4;
        } else {
          p.level = 0;
          p.y = 0;
          p.invuln = CEILING.landInvuln;
          state.stats.ceilingDrops += 1;
          state.battery = Math.min(BATTERY.max, state.battery + BATTERY.cleanLanding * 0.5);
        }
      }
      return;
    }

    if (p.level === 1) {
      state.suction = Math.max(0, state.suction - CEILING.suctionDrain * dt);
      state.stats.ceilingMeters += state.speed * dt;
      addScore(state.speed * dt * SCORE.distance * (CEILING.scoreMult - 1));
      if (state.suction <= 0) {
        beginTransit(-1);
        emit('ceilDrop', { reason: 'suction' });
      } else if (state.zone && state.dist > state.zone.end) {
        beginTransit(-1);
        emit('ceilDrop', { reason: 'zoneEnd' });
      }
      return;
    }

    state.suction = Math.min(CEILING.suctionMax, state.suction + CEILING.suctionRefill * dt);

    if (p.air) {
      // maneuver progress
      if (p.maneuvers.length) {
        const m = p.maneuvers[0];
        m.t += dt;
        if (m.t >= PHYSICS.maneuverTime) {
          p.maneuvers.shift();
          p.done += 1;
          p.donePoints += maneuverBase(m.axis);
          state.stats.tricks += 1;
          if (m.axis === 'roll') state.stats.rolls += 1;
          else state.stats.flips += 1;
          emit('maneuverDone', { axis: m.axis });
        }
      } else if (autoTrick && !p.autoTrickUsed && p.vy < 3 && p.done === 0) {
        p.autoTrickUsed = true;
        startManeuver('roll', 1);
      }
      p.vy -= PHYSICS.gravity * dt;
      p.y += p.vy * dt;
      if (p.y <= 0 && p.vy < 0) land();
    } else {
      // ramps
      for (const r of state.ramps) {
        if (r.used || r.level !== 0) continue;
        if (Math.abs(r.z - state.dist) < 3 && Math.abs(r.x - p.x) < 1.6) {
          r.used = true;
          p.vy = PHYSICS.rampVy;
          p.air = true;
          p.done = 0;
          p.donePoints = 0;
          p.autoTrickUsed = false;
          state.stats.rampJumps += 1;
          emit('ramp', {});
          break;
        }
      }
    }

    // visible orientation
    const m = p.maneuvers[0];
    p.rollAngle = 0;
    p.pitchAngle = 0;
    if (m && p.air) {
      const a = m.dir * TAU * easeInOut(clamp(m.t / PHYSICS.maneuverTime, 0, 1));
      if (m.axis === 'roll') p.rollAngle = a;
      else p.pitchAngle = a;
    }
  }

  function updateEntities(dt) {
    const p = state.player;
    const px = p.x;
    for (const e of state.vehicles) {
      e.z += e.vz * dt;
      const rel = e.z - state.dist;
      if (!state.over && !p.transit && e.level === p.level) {
        const dx = Math.abs(e.x - px);
        const dz = Math.abs(rel);
        // near miss: entity crosses the player's z this step
        if (!e.scored && e.prevRel > 0 && rel <= 0) {
          e.scored = true;
          if (!p.air) {
            const gap = dx - (e.w / 2 + PLAYER.halfW);
            if (gap > 0 && gap < NEAR_BAND && state.speed >= SPEED.nearMissMin) registerNearMiss(e, gap);
          }
        }
        // skim: airborne above a vehicle
        if (p.air && !e.skimmed && dx < e.w / 2 + PLAYER.halfW && dz < e.l / 2 + PLAYER.halfL && p.y > e.h) {
          e.skimmed = true;
          state.stats.skims += 1;
          const pts = Math.round(SCORE.skim * state.mult);
          addScore(pts);
          emit('skim', { points: pts });
        }
        // collision
        if (p.invuln <= 0 && dx < PLAYER.halfW + e.w / 2 && dz < PLAYER.halfL + e.l / 2 && p.y < e.h - 0.05) {
          crash('collision');
        }
      }
      e.prevRel = rel;
    }
    for (const pad of state.pads) {
      if (pad.taken || p.transit || pad.level !== p.level) continue;
      if (Math.abs(pad.z - state.dist) < 3 && Math.abs(pad.x - px) < 1.4 && p.y < 1.6) {
        pad.taken = true;
        state.battery = Math.min(BATTERY.max, state.battery + BATTERY.pad);
        state.stats.pads += 1;
        emit('pad', { x: pad.x });
      }
    }
    const behind = state.dist - SPAWN.despawnBehind;
    state.vehicles = state.vehicles.filter((e) => e.z > behind - 12);
    state.pads = state.pads.filter((pad) => pad.z > behind && !pad.taken);
    state.ramps = state.ramps.filter((r) => r.z > behind);
  }

  function updatePose() {
    const p = state.player;
    const pose = state.pose;
    pose.x = p.x;
    pose.level = p.level;
    if (p.transit) {
      const s = easeInOut(clamp(p.transit.t / p.transit.dur, 0, 1));
      const bump = Math.sin(Math.PI * s) * 1.2;
      if (p.transit.dir > 0) {
        pose.y = p.transit.startY + (CEIL_Y - p.transit.startY) * s + bump;
        pose.roll = Math.PI * s;
      } else {
        pose.y = CEIL_Y * (1 - s) + bump;
        pose.roll = Math.PI * (1 + s);
      }
      pose.pitch = 0;
    } else if (p.level === 1) {
      pose.y = CEIL_Y - p.y;
      pose.roll = Math.PI;
      pose.pitch = 0;
    } else {
      pose.y = p.y;
      pose.roll = p.rollAngle;
      pose.pitch = p.pitchAngle;
    }
  }

  // ---------------------------------------------------------------- main step
  function step(dt) {
    if (state.over) return;
    state.t += dt;

    const base = SPEED.start + (SPEED.max - SPEED.start) * (1 - Math.exp(-state.t / SPEED.rampTime));
    const target = state.braking ? SPEED.brakeFactor : 1;
    state.brakeMul += (target - state.brakeMul) * (1 - Math.exp(-3 * dt));
    state.speed = Math.max(14, base * preset.speedMul * state.brakeMul);
    state.stats.maxSpeed = Math.max(state.stats.maxSpeed, state.speed);

    state.dist += state.speed * dt;
    state.stats.distance = state.dist;
    addScore(state.speed * dt * SCORE.distance);

    // battery
    state.battery -= BATTERY.drain * dt;
    if (state.battery < 20 && !state.batteryLowSent) {
      state.batteryLowSent = true;
      emit('batteryLow', {});
    }
    if (state.battery >= 25) state.batteryLowSent = false;

    // streak decay
    if (state.streak > 0) {
      state.streakTimer -= dt;
      if (state.streakTimer <= 0) {
        state.streak = 0;
        state.mult = 1;
        emit('streakLost', {});
      }
    }

    spawnAhead();
    updatePlayerMotion(dt);
    updateEntities(dt);

    if (state.battery <= 0) {
      state.battery = 0;
      crash('battery');
    }

    // zone warnings and expiry
    if (state.zone) {
      if (!state.zoneWarned && state.dist > state.zone.start - 220) {
        state.zoneWarned = true;
        emit('zoneWarn', {});
      }
      if (state.dist > state.zone.end + 20 && state.player.level === 0) state.zone = null;
    }

    const district = Math.floor(state.dist / DISTRICT_LENGTH) % 5;
    if (district !== state.district) {
      state.district = district;
      emit('district', { index: district });
    }

    updatePose();
  }

  function setBraking(on) {
    state.braking = !!on;
  }

  function flushEvents(fn) {
    for (let i = 0; i < events.length; i++) fn(events[i]);
    events.length = 0;
  }

  // prime the world so the first frame has traffic ahead
  spawnAhead();
  updatePose();

  return { state, step, action, setBraking, flushEvents, events, inZone };
}
