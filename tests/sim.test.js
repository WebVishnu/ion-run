import { describe, expect, it } from 'vitest';
import { CEIL_Y, STEP, laneX } from '../src/config.js';
import { createRng, seedFromString } from '../src/game/rng.js';
import { createSim } from '../src/game/sim.js';

/** A sim with an empty road that stays empty, for isolated mechanic tests. */
function emptyWorld(opts = {}) {
  const sim = createSim({ seed: 7, ...opts });
  const clear = () => {
    sim.state.vehicles.length = 0;
    sim.state.pads.length = 0;
    sim.state.ramps.length = 0;
  };
  clear();
  const run = (steps) => {
    for (let i = 0; i < steps; i++) {
      clear();
      sim.step(STEP);
    }
  };
  return { sim, run, clear };
}

function collectEvents(sim) {
  const seen = [];
  return {
    seen,
    flush: () => sim.flushEvents((e) => seen.push(e)),
  };
}

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('produces different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('keeps range() and int() within bounds', () => {
    const r = createRng(5);
    for (let i = 0; i < 500; i++) {
      const v = r.range(3, 4);
      const n = r.int(2, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(4);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('hashes equal strings to equal seeds', () => {
    expect(seedFromString('2026-10-17')).toBe(seedFromString('2026-10-17'));
    expect(seedFromString('2026-10-17')).not.toBe(seedFromString('2026-10-18'));
  });
});

describe('determinism', () => {
  it('replays identically for the same seed and inputs', () => {
    const play = () => {
      const sim = createSim({ seed: 99 });
      for (let i = 0; i < 1500 && !sim.state.over; i++) {
        if (i % 90 === 10) sim.action('left');
        if (i % 90 === 55) sim.action('right');
        sim.step(STEP);
      }
      return [sim.state.score, sim.state.dist, sim.state.vehicles.length, sim.state.over];
    };
    expect(play()).toEqual(play());
  });

  it('spawns different traffic for different seeds', () => {
    const a = createSim({ seed: 1 }).state.vehicles.map((v) => v.lane + v.type);
    const b = createSim({ seed: 2 }).state.vehicles.map((v) => v.lane + v.type);
    expect(a).not.toEqual(b);
  });
});

describe('traffic fairness', () => {
  /** Collects every ground row (same-direction lanes 1-3) and ramp the sim spawns over a long invulnerable run. */
  function collectRows(seed, difficulty = 'normal') {
    const sim = createSim({ seed, difficulty });
    sim.state.player.invuln = 1e9;
    const rows = new Map();
    const ramps = new Map();
    for (let i = 0; i < 60 * 200; i++) {
      sim.state.battery = 100;
      sim.step(STEP);
      for (const v of sim.state.vehicles) {
        if (v.level !== 0 || v.lane === 0) continue;
        const key = Math.round(v.z0 * 10);
        if (!rows.has(key)) rows.set(key, { z: v.z0, blocked: new Set() });
        rows.get(key).blocked.add(v.lane);
      }
      for (const r of sim.state.ramps) ramps.set(r.id, r);
    }
    return { rows: [...rows.values()].sort((a, b) => a.z - b.z), ramps: [...ramps.values()] };
  }

  it('lets the player reach a free lane from EVERY free lane of the previous row (no trap)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const difficulty of ['chill', 'normal', 'hard']) {
        const { rows } = collectRows(seed, difficulty);
        expect(rows.length).toBeGreaterThan(40);
        let prevFree = [2];
        for (const row of rows) {
          const free = [1, 2, 3].filter((l) => !row.blocked.has(l));
          expect(free.length).toBeGreaterThan(0);
          for (const f of prevFree) expect(free.some((g) => Math.abs(f - g) <= 1)).toBe(true);
          prevFree = free;
        }
      }
    }
  });

  it('never places a ramp in the only free lane of a row', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const { rows, ramps } = collectRows(seed);
      for (const ramp of ramps) {
        const row = rows.find((r) => Math.abs(r.z - (ramp.z - 2)) < 0.01);
        expect(row).toBeTruthy();
        const free = [1, 2, 3].filter((l) => !row.blocked.has(l));
        expect(free.length).toBeGreaterThanOrEqual(2);
        expect(free).toContain(ramp.lane);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('spreads out rows far enough apart to react (>= 0.55 s at top speed)', () => {
    const { rows } = collectRows(3, 'hard');
    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i].z - rows[i - 1].z;
      expect(gap / (62 * 1.08 - 16)).toBeGreaterThan(0.55);
    }
  });
});

describe('review fixes', () => {
  it('builds the same road for everyone on a daily seed, however they drive', () => {
    const collect = (brake) => {
      const sim = createSim({ seed: 4242 });
      sim.state.player.invuln = 1e9;
      const seen = new Map();
      for (let i = 0; i < 60 * 120 && sim.state.dist < 3500; i++) {
        sim.state.battery = 100;
        sim.setBraking(brake && i % 300 < 150);
        if (i % 97 === 5) sim.action(i % 2 ? 'left' : 'right');
        sim.step(STEP);
        for (const v of sim.state.vehicles) seen.set(v.id, v);
      }
      return [...seen.values()]
        .filter((v) => v.z0 < 3200)
        .map((v) => `${v.z0.toFixed(2)}|${v.lane}|${v.level}|${v.type}|${v.color}`)
        .sort();
    };
    const a = collect(false);
    const b = collect(true);
    expect(a.length).toBeGreaterThan(30);
    expect(b).toEqual(a);
  });

  it('gives no reward for a plain hop without a trick', () => {
    const { sim, run } = emptyWorld();
    const events = collectEvents(sim);
    sim.state.battery = 50;
    sim.state.pips = 2;
    sim.action('hop');
    run(70);
    events.flush();
    expect(sim.state.stats.cleanLandings).toBe(0);
    expect(events.seen.some((e) => e.type === 'land')).toBe(true);
    expect(events.seen.some((e) => e.type === 'landClean')).toBe(false);
    expect(sim.state.battery).toBeLessThan(50); // the hop cost battery and nothing paid it back
    expect(sim.state.pips).toBeLessThan(2);
  });

  it('puts oncoming traffic in lane 0 of the ceiling road so it is not a free lane', () => {
    const sim = createSim({ seed: 11 });
    sim.state.player.invuln = 1e9;
    sim.state.zone = null;
    let ceilLane0 = 0;
    for (let i = 0; i < 60 * 90; i++) {
      sim.state.battery = 100;
      sim.step(STEP);
      ceilLane0 = Math.max(ceilLane0, sim.state.vehicles.filter((v) => v.level === 1 && v.lane === 0).length);
      if (ceilLane0 > 0) break;
    }
    expect(ceilLane0).toBeGreaterThan(0);
    const oncoming = sim.state.vehicles.find((v) => v.level === 1 && v.lane === 0);
    expect(oncoming.vz).toBeLessThan(0);
  });

  it('counts every pass that does not collide as a near miss if it is close', () => {
    const { sim } = emptyWorld();
    const lane = sim.state.player.lane + 1;
    sim.state.vehicles.push({
      id: 970, type: 'van', lane, level: 0, x: laneX(lane), z: sim.state.dist + 25, z0: 0,
      prevRel: 25, vz: 16, w: 2.0, l: 5.2, h: 2.3, color: 0, scored: false, skimmed: false,
    });
    for (let i = 0; i < 300; i++) {
      sim.step(STEP);
      sim.state.vehicles = sim.state.vehicles.filter((v) => v.id === 970);
      sim.state.pads.length = 0;
    }
    expect(sim.state.over).toBe(false);
    expect(sim.state.stats.nearMisses).toBe(1);
  });
});

describe('lane movement', () => {
  it('changes lane and clamps at the road edges', () => {
    const { sim, run } = emptyWorld();
    sim.action('left');
    sim.action('left');
    sim.action('left');
    sim.action('left');
    run(60);
    expect(sim.state.player.lane).toBe(0);
    expect(sim.state.player.x).toBeCloseTo(laneX(0), 1);
    for (let i = 0; i < 6; i++) sim.action('right');
    run(60);
    expect(sim.state.player.lane).toBe(3);
  });
});

describe('collisions and near misses', () => {
  it('crashes when driving into a vehicle in the same lane', () => {
    const { sim } = emptyWorld();
    const p = sim.state.player;
    sim.state.vehicles.push({
      id: 900, type: 'sedan', lane: p.lane, level: 0, x: laneX(p.lane), z: sim.state.dist + 25,
      prevRel: 25, vz: 16, w: 1.8, l: 4.4, h: 1.45, color: 0, scored: false, skimmed: false,
    });
    for (let i = 0; i < 300 && !sim.state.over; i++) {
      sim.step(STEP);
      sim.state.vehicles = sim.state.vehicles.filter((v) => v.id === 900);
    }
    expect(sim.state.over).toBe(true);
    expect(sim.state.overReason).toBe('collision');
  });

  it('scores a near miss when passing a car in the adjacent lane', () => {
    const { sim } = emptyWorld();
    const lane = sim.state.player.lane + 1;
    const events = collectEvents(sim);
    sim.state.vehicles.push({
      id: 901, type: 'sedan', lane, level: 0, x: laneX(lane), z: sim.state.dist + 25,
      prevRel: 25, vz: 16, w: 1.8, l: 4.4, h: 1.45, color: 0, scored: false, skimmed: false,
    });
    for (let i = 0; i < 300; i++) {
      sim.step(STEP);
      sim.state.vehicles = sim.state.vehicles.filter((v) => v.id === 901);
      sim.state.pads.length = 0;
    }
    events.flush();
    expect(sim.state.over).toBe(false);
    expect(sim.state.stats.nearMisses).toBe(1);
    expect(events.seen.some((e) => e.type === 'nearMiss')).toBe(true);
    expect(sim.state.streak).toBe(1);
  });

  it('does not score a near miss for a car two lanes away', () => {
    const { sim } = emptyWorld();
    sim.action('left'); // lane 1
    for (let i = 0; i < 30; i++) {
      sim.state.vehicles.length = 0;
      sim.step(STEP);
    }
    sim.state.vehicles.push({
      id: 902, type: 'sedan', lane: 3, level: 0, x: laneX(3), z: sim.state.dist + 25,
      prevRel: 25, vz: 16, w: 1.8, l: 4.4, h: 1.45, color: 0, scored: false, skimmed: false,
    });
    for (let i = 0; i < 300; i++) {
      sim.step(STEP);
      sim.state.vehicles = sim.state.vehicles.filter((v) => v.id === 902);
    }
    expect(sim.state.stats.nearMisses).toBe(0);
  });

  it('decays the streak after a few safe seconds', () => {
    const { sim, run } = emptyWorld();
    sim.state.streak = 5;
    sim.state.streakTimer = 3;
    run(60 * 4);
    expect(sim.state.streak).toBe(0);
    expect(sim.state.mult).toBe(1);
  });
});

describe('thruster hop', () => {
  it('spends a pip and leaves the ground', () => {
    const { sim, run } = emptyWorld();
    const before = sim.state.pips;
    sim.action('hop');
    run(10);
    expect(sim.state.pips).toBe(before - 1);
    expect(sim.state.player.air).toBe(true);
    expect(sim.state.player.y).toBeGreaterThan(0.5);
  });

  it('does nothing without a pip', () => {
    const { sim, run } = emptyWorld();
    sim.state.pips = 0;
    sim.action('hop');
    run(5);
    expect(sim.state.player.air).toBe(false);
  });

  it('lets the car clear a sedan and awards a skim bonus at high speed', () => {
    const { sim } = emptyWorld();
    sim.state.t = 200; // near top speed
    sim.step(STEP);
    const events = collectEvents(sim);
    const rel = (sim.state.speed - 16) * 0.44;
    const lane = sim.state.player.lane;
    sim.state.vehicles.push({
      id: 903, type: 'sedan', lane, level: 0, x: laneX(lane), z: sim.state.dist + rel,
      prevRel: rel, vz: 16, w: 1.8, l: 4.4, h: 1.45, color: 0, scored: false, skimmed: false,
    });
    sim.action('hop');
    for (let i = 0; i < 90; i++) {
      sim.step(STEP);
      sim.state.vehicles = sim.state.vehicles.filter((v) => v.id === 903);
      sim.state.pads.length = 0;
    }
    events.flush();
    expect(sim.state.over).toBe(false);
    expect(sim.state.stats.skims).toBe(1);
  });
});

describe('air maneuvers and landing', () => {
  it('completes a barrel roll, lands clean and awards trick points', () => {
    const { sim, run } = emptyWorld();
    const events = collectEvents(sim);
    const lane = sim.state.player.lane;
    sim.action('hop');
    sim.action('right');
    const before = sim.state.score;
    run(70);
    events.flush();
    expect(sim.state.over).toBe(false);
    expect(sim.state.stats.rolls).toBe(1);
    expect(sim.state.stats.cleanLandings).toBe(1);
    expect(sim.state.player.lane).toBe(lane + 1);
    expect(events.seen.find((e) => e.type === 'landClean')?.points).toBeGreaterThan(100);
    expect(sim.state.score).toBeGreaterThan(before + 100);
  });

  it('counts a roll followed by a flip as a combo', () => {
    const { sim, run } = emptyWorld();
    const events = collectEvents(sim);
    sim.action('hop');
    sim.action('right');
    sim.action('up');
    run(70);
    events.flush();
    const landing = events.seen.find((e) => e.type === 'landClean');
    expect(landing?.combo).toBe(true);
    expect(sim.state.stats.combos).toBe(1);
  });

  it('does a front flip when hop is pressed again in the air (double tap)', () => {
    const { sim, run } = emptyWorld();
    const events = collectEvents(sim);
    sim.action('hop');
    run(9); // about 0.15 s later
    expect(sim.state.player.air).toBe(true);
    sim.action('hop');
    expect(sim.state.player.maneuvers[0]).toMatchObject({ axis: 'pitch', dir: 1 });
    run(70);
    events.flush();
    expect(sim.state.stats.flips).toBe(1);
    expect(sim.state.stats.hops).toBe(1); // the second press did not spend another pip
    expect(events.seen.some((e) => e.type === 'landClean')).toBe(true);
    expect(sim.state.over).toBe(false);
  });

  it('lets a double-tap flip follow a roll, up to the two-trick limit', () => {
    const { sim, run } = emptyWorld();
    sim.action('hop');
    sim.action('right');
    sim.action('hop');
    sim.action('hop');
    run(70);
    expect(sim.state.stats.tricks).toBe(2);
    expect(sim.state.over).toBe(false);
  });

  it('limits a hop to two maneuvers', () => {
    const { sim, run } = emptyWorld();
    sim.action('hop');
    sim.action('right');
    sim.action('up');
    sim.action('down');
    sim.action('left');
    run(70);
    expect(sim.state.stats.tricks).toBeLessThanOrEqual(2);
  });

  it('gives a messy landing (streak lost) when a roll is mostly finished', () => {
    const { sim, run } = emptyWorld();
    const events = collectEvents(sim);
    sim.state.streak = 6;
    sim.state.streakTimer = 99;
    sim.action('hop');
    run(36); // 0.6 s into a ~0.89 s hop
    sim.action('right');
    run(40);
    events.flush();
    expect(events.seen.some((e) => e.type === 'landMessy')).toBe(true);
    expect(sim.state.over).toBe(false);
    expect(sim.state.streak).toBe(0);
  });

  it('crashes when landing badly rotated', () => {
    const { sim, run } = emptyWorld();
    sim.action('hop');
    run(42); // ~0.7 s in
    sim.action('up');
    run(40);
    expect(sim.state.over).toBe(true);
    expect(sim.state.overReason).toBe('landing');
  });

  it('ignores flips and rolls while on the ground', () => {
    const { sim, run } = emptyWorld();
    sim.action('up');
    sim.action('down');
    run(10);
    expect(sim.state.player.maneuvers.length).toBe(0);
    expect(sim.state.stats.tricks).toBe(0);
  });

  it('auto-trick performs a safe roll on its own', () => {
    const { sim, run } = emptyWorld({ autoTrick: true });
    sim.action('hop');
    run(70);
    expect(sim.state.stats.rolls).toBe(1);
    expect(sim.state.over).toBe(false);
  });
});

describe('ramps', () => {
  it('launches the car higher and for longer than a hop, for free', () => {
    const { sim } = emptyWorld();
    const lane = sim.state.player.lane;
    sim.state.ramps.push({ id: 5, lane, x: laneX(lane), z: sim.state.dist + 8, level: 0, used: false });
    let peak = 0;
    let airSteps = 0;
    const pipsBefore = sim.state.pips;
    for (let i = 0; i < 160; i++) {
      sim.state.vehicles.length = 0;
      sim.step(STEP);
      peak = Math.max(peak, sim.state.player.y);
      if (sim.state.player.air) airSteps++;
    }
    expect(peak).toBeGreaterThan(5);
    expect(airSteps / 60).toBeGreaterThan(1.2);
    expect(sim.state.pips).toBeGreaterThanOrEqual(pipsBefore); // no pip spent (a clean landing refunds a little)
    expect(sim.state.stats.rampJumps).toBe(1);
  });
});

describe('battery and pads', () => {
  it('ends the run when the battery is empty', () => {
    const { sim, run } = emptyWorld();
    run(60 * 100);
    expect(sim.state.over).toBe(true);
    expect(sim.state.overReason).toBe('battery');
  });

  it('refills the battery from a charge pad', () => {
    const { sim } = emptyWorld();
    sim.state.battery = 40;
    const lane = sim.state.player.lane;
    sim.state.pads.push({ id: 8, lane, x: laneX(lane), z: sim.state.dist + 20, level: 0, taken: false });
    for (let i = 0; i < 60; i++) {
      sim.state.vehicles.length = 0;
      sim.step(STEP);
    }
    expect(sim.state.stats.pads).toBe(1);
    expect(sim.state.battery).toBeGreaterThan(60);
  });
});

describe('ceiling run', () => {
  it('only grabs the ceiling inside a zone', () => {
    const { sim, run } = emptyWorld();
    sim.action('grab');
    run(40);
    expect(sim.state.player.level).toBe(0);
  });

  it('flips onto the ceiling, drives inverted, and drops when suction runs out', () => {
    const { sim, run } = emptyWorld();
    const events = collectEvents(sim);
    sim.state.zone = { start: sim.state.dist - 10, end: sim.state.dist + 1e6 };
    sim.action('grab');
    run(40);
    expect(sim.state.player.level).toBe(1);
    expect(sim.state.pose.y).toBeCloseTo(CEIL_Y, 1);
    expect(sim.state.pose.roll).toBeCloseTo(Math.PI, 1);
    const scoreOnCeiling = sim.state.score;
    run(60 * 8);
    events.flush();
    expect(events.seen.some((e) => e.type === 'ceilDrop' && e.reason === 'suction')).toBe(true);
    expect(sim.state.player.level).toBe(0);
    expect(sim.state.over).toBe(false);
    expect(sim.state.score).toBeGreaterThan(scoreOnCeiling);
    expect(sim.state.stats.ceilingMeters).toBeGreaterThan(50);
  });

  it('can be grabbed straight after landing (hop cooldown does not block it)', () => {
    const { sim, run } = emptyWorld();
    sim.state.zone = { start: sim.state.dist - 10, end: sim.state.dist + 1e6 };
    sim.action('hop');
    run(70);
    expect(sim.state.player.air).toBe(false);
    expect(sim.state.player.cooldown).toBeGreaterThan(0);
    sim.action('grab');
    run(40);
    expect(sim.state.player.level).toBe(1);
  });

  it('can be left manually and gives brief invulnerability', () => {
    const { sim, run } = emptyWorld();
    sim.state.zone = { start: sim.state.dist - 10, end: sim.state.dist + 1e6 };
    sim.action('grab');
    run(40);
    sim.action('grab');
    run(45);
    expect(sim.state.player.level).toBe(0);
    expect(sim.state.player.invuln).toBeGreaterThan(0);
  });

  it('ignores ground traffic while inverted', () => {
    const { sim } = emptyWorld();
    sim.state.zone = { start: sim.state.dist - 10, end: sim.state.dist + 1e6 };
    sim.action('grab');
    for (let i = 0; i < 40; i++) {
      sim.state.vehicles.length = 0;
      sim.step(STEP);
    }
    const lane = sim.state.player.lane;
    sim.state.vehicles.push({
      id: 950, type: 'truck', lane, level: 0, x: laneX(lane), z: sim.state.dist + 30,
      prevRel: 30, vz: 16, w: 2.5, l: 9, h: 3.4, color: 0, scored: false, skimmed: false,
    });
    for (let i = 0; i < 120; i++) {
      sim.state.suction = 1;
      sim.step(STEP);
      sim.state.vehicles = sim.state.vehicles.filter((v) => v.id === 950);
    }
    expect(sim.state.over).toBe(false);
  });
});

describe('progression', () => {
  it('speeds up over time but stays under the cap', () => {
    const { sim, run } = emptyWorld();
    const s0 = sim.state.speed;
    sim.state.battery = 1e6;
    run(60 * 30);
    const s1 = sim.state.speed;
    run(60 * 60);
    expect(s1).toBeGreaterThan(s0);
    expect(sim.state.speed).toBeLessThan(63);
    expect(sim.state.speed).toBeGreaterThan(s1);
  });

  it('brakes to a lower speed while the brake is held', () => {
    const { sim, run } = emptyWorld();
    run(120);
    const free = sim.state.speed;
    sim.setBraking(true);
    run(120);
    expect(sim.state.speed).toBeLessThan(free * 0.85);
  });

  it('survives a long autopilot-free run without NaN state', () => {
    const sim = createSim({ seed: 3 });
    sim.state.player.invuln = 1e9;
    for (let i = 0; i < 60 * 120; i++) {
      sim.state.battery = 100;
      sim.step(STEP);
    }
    expect(Number.isFinite(sim.state.score)).toBe(true);
    expect(Number.isFinite(sim.state.dist)).toBe(true);
    expect(sim.state.vehicles.length).toBeLessThan(120);
  });
});
