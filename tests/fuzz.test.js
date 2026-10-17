import { describe, expect, it } from 'vitest';
import { CEIL_Y, LANES, STEP } from '../src/config.js';
import { createRng } from '../src/game/rng.js';
import { createSim } from '../src/game/sim.js';

const ACTIONS = ['left', 'right', 'up', 'down', 'hop', 'grab'];

/** Returns the first broken invariant, or null. Reproducible: same seed and same input stream. */
function check(sim) {
  const s = sim.state;
  const p = s.player;
  const pose = s.pose;
  const finite = [s.t, s.dist, s.speed, s.score, s.battery, s.pips, s.suction, s.streak, p.x, p.y, p.vy, pose.x, pose.y, pose.roll, pose.pitch];
  if (finite.some((v) => !Number.isFinite(v))) return 'non-finite value';
  if (p.lane < 0 || p.lane > LANES - 1) return `lane out of range: ${p.lane}`;
  if (![0, 1].includes(p.level)) return `bad level ${p.level}`;
  if (s.battery < -1e-9 || s.battery > 100 + 1e-9) return `battery out of range ${s.battery}`;
  if (s.pips < -1e-9 || s.pips > 3 + 1e-9) return `pips out of range ${s.pips}`;
  if (s.suction < -1e-9 || s.suction > 1 + 1e-9) return `suction out of range ${s.suction}`;
  if (p.y < -1e-9) return `player below the road: ${p.y}`;
  if (!p.transit && p.level === 1 && Math.abs(pose.y - CEIL_Y) > 1e-6 && p.y === 0) return 'roof pose is not at roof height';
  if (p.air && p.level === 1) return 'airborne while on the roof';
  if (p.air && p.transit) return 'airborne during a transit';
  if (p.maneuvers.length > 2) return 'too many queued maneuvers';
  if (s.vehicles.length > 140) return `vehicle list grew to ${s.vehicles.length}`;
  if (s.pads.length > 40 || s.ramps.length > 40) return 'pads or ramps are leaking';
  if (s.stats.maxStreak < s.streak) return 'streak above recorded max';
  return null;
}

describe('fuzz: random inputs never break the simulation', () => {
  it('holds every invariant over 60 seeded runs with random button mashing', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const inputs = createRng(seed * 7919);
      const sim = createSim({ seed, difficulty: ['chill', 'normal', 'hard'][seed % 3], autoTrick: seed % 5 === 0 });
      // force roof zones early so the transit code is exercised as well
      if (seed % 2 === 0) sim.state.zone = { start: 150, end: 1200 };
      // odd seeds cannot crash from traffic, so they run for minutes and reach roof zones, districts and long spawns
      if (seed % 2 === 1) sim.state.player.invuln = 1e9;
      const log = [];
      for (let i = 0; i < 60 * 150 && !sim.state.over; i++) {
        if (inputs.chance(0.12)) {
          const a = inputs.pick(ACTIONS);
          log.push(`${i}:${a}`);
          sim.action(a);
        }
        sim.setBraking(inputs.chance(0.01) ? !sim.state.braking : sim.state.braking);
        if (inputs.chance(0.004)) sim.state.battery = 100; // keep runs long enough to be interesting
        sim.step(STEP);
        sim.flushEvents(() => {});
        const broken = check(sim);
        if (broken) {
          throw new Error(`seed ${seed} step ${i}: ${broken}\nlast inputs: ${log.slice(-8).join(' ')}`);
        }
      }
    }
  });

  it('stays frozen after the run is over', () => {
    const sim = createSim({ seed: 3 });
    sim.state.battery = 0.01;
    for (let i = 0; i < 120; i++) sim.step(STEP);
    expect(sim.state.over).toBe(true);
    const snapshot = JSON.stringify([sim.state.score, sim.state.dist, sim.state.t]);
    sim.action('hop');
    sim.action('left');
    for (let i = 0; i < 60; i++) sim.step(STEP);
    expect(JSON.stringify([sim.state.score, sim.state.dist, sim.state.t])).toBe(snapshot);
  });

  it('survives very large and very small time steps without breaking', () => {
    const sim = createSim({ seed: 9 });
    sim.state.player.invuln = 1e9;
    for (const dt of [STEP, STEP / 100, STEP * 3, STEP / 7, STEP]) {
      for (let i = 0; i < 400; i++) {
        sim.state.battery = 100;
        sim.step(dt);
      }
    }
    expect(check(sim)).toBeNull();
  });
});
