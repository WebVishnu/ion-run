import { describe, expect, it } from 'vitest';
import { LIVERIES } from '../src/render/models.js';
import {
  GOAL_POOL,
  MILESTONES,
  buyLivery,
  coinsForRun,
  dailySeed,
  defaultSave,
  ensureGoals,
  leaderboardView,
  normalizeSave,
  recordRun,
  todayKey,
} from '../src/meta/progress.js';
import { createRng } from '../src/game/rng.js';

const baseStats = () => ({
  distance: 3000,
  nearMisses: 10,
  tricks: 2,
  cleanLandings: 2,
  pads: 3,
  maxStreak: 5,
  combos: 0,
  flips: 1,
  rolls: 1,
  ceilingMeters: 0,
  oncomingPasses: 0,
  skims: 0,
  rampJumps: 0,
  maxSpeed: 40,
});

const fresh = () => ensureGoals(defaultSave(), createRng(1));
const day = (y, m, d) => new Date(y, m - 1, d, 12);

describe('goals', () => {
  it('always keeps three distinct active goals', () => {
    const save = fresh();
    expect(save.goals.active).toHaveLength(3);
    expect(new Set(save.goals.active).size).toBe(3);
    save.goals.active = [save.goals.active[0]];
    ensureGoals(save, createRng(2));
    expect(new Set(save.goals.active).size).toBe(3);
  });

  it('has a unique id and a positive reward for every goal', () => {
    const ids = GOAL_POOL.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GOAL_POOL) {
      expect(g.reward).toBeGreaterThan(0);
      expect(g.target).toBeGreaterThan(0);
    }
  });

  it('pays out and replaces a completed goal', () => {
    const save = fresh();
    save.goals.active = ['dist3k', 'streak20', 'onc10'];
    const { summary } = recordRun(save, { stats: baseStats(), score: 100, rng: createRng(3) });
    expect(summary.completedGoals.map((g) => g.id)).toEqual(['dist3k']);
    expect(summary.goalCoins).toBe(70);
    expect(save.goals.active).toHaveLength(3);
    expect(save.goals.active).not.toContain('dist3k');
    expect(save.goals.completed).toBe(1);
  });

  it('measures score goals against the run score', () => {
    const save = fresh();
    save.goals.active = ['score5k', 'streak20', 'onc10'];
    const { summary } = recordRun(save, { stats: baseStats(), score: 6000, rng: createRng(4) });
    expect(summary.completedGoals.some((g) => g.id === 'score5k')).toBe(true);
  });
});

describe('coins and records', () => {
  it('turns run stats into coins', () => {
    expect(coinsForRun({ distance: 600, nearMisses: 10, tricks: 2, cleanLandings: 1, pads: 2 })).toBe(10 + 10 + 6 + 2 + 2);
  });

  it('tracks the best score and totals', () => {
    const save = fresh();
    const first = recordRun(save, { stats: baseStats(), score: 1000, rng: createRng(5) });
    expect(first.summary.newBest).toBe(true);
    const second = recordRun(save, { stats: baseStats(), score: 400, rng: createRng(5) });
    expect(second.summary.newBest).toBe(false);
    expect(save.best).toBe(1000);
    expect(save.totalRuns).toBe(2);
    expect(save.totalNearMisses).toBe(20);
  });
});

describe('daily run streak (forgiving)', () => {
  const play = (save, when) => recordRun(save, { stats: baseStats(), score: 500, daily: true, now: when, rng: createRng(6) });

  it('starts a streak and pays a bonus once per day', () => {
    const save = fresh();
    const a = play(save, day(2026, 10, 17));
    expect(save.daily.streak).toBe(1);
    expect(a.summary.dailyBonus).toBe(120);
    const again = play(save, day(2026, 10, 17));
    expect(again.summary.dailyBonus).toBe(0);
    expect(save.daily.streak).toBe(1);
  });

  it('extends on consecutive days and forgives one missed day', () => {
    const save = fresh();
    play(save, day(2026, 10, 17));
    play(save, day(2026, 10, 18));
    expect(save.daily.streak).toBe(2);
    play(save, day(2026, 10, 20)); // skipped the 19th
    expect(save.daily.streak).toBe(3);
  });

  it('resets after two or more missed days', () => {
    const save = fresh();
    play(save, day(2026, 10, 17));
    play(save, day(2026, 10, 18));
    play(save, day(2026, 10, 22));
    expect(save.daily.streak).toBe(1);
  });

  it('uses a stable seed per date', () => {
    expect(dailySeed('2026-10-17')).toBe(dailySeed('2026-10-17'));
    expect(dailySeed('2026-10-17')).not.toBe(dailySeed('2026-10-18'));
    expect(todayKey(day(2026, 3, 5))).toBe('2026-03-05');
  });
});

describe('garage', () => {
  const aurora = LIVERIES.find((l) => l.id === 'aurora');

  it('refuses to sell without enough coins', () => {
    const save = fresh();
    save.coins = aurora.price - 1;
    expect(buyLivery(save, aurora)).toEqual({ ok: false, reason: 'coins' });
    expect(save.coins).toBe(aurora.price - 1);
    expect(save.unlocked).not.toContain('aurora');
  });

  it('charges once and unlocks', () => {
    const save = fresh();
    save.coins = aurora.price + 20;
    expect(buyLivery(save, aurora)).toEqual({ ok: true, reason: 'bought' });
    expect(save.coins).toBe(20);
    expect(buyLivery(save, aurora)).toEqual({ ok: true, reason: 'owned' });
    expect(save.coins).toBe(20);
  });

  it('gives the starter livery for free', () => {
    expect(LIVERIES[0].price).toBe(0);
    expect(defaultSave().unlocked).toContain(LIVERIES[0].id);
  });

  it('only awards milestone liveries that exist', () => {
    for (const m of MILESTONES) expect(LIVERIES.some((l) => l.id === m.unlock)).toBe(true);
  });

  it('unlocks a milestone livery after 25 runs', () => {
    const save = fresh();
    save.totalRuns = 24;
    const { summary } = recordRun(save, { stats: baseStats(), score: 10, rng: createRng(7) });
    expect(summary.newUnlocks).toContain('ghost');
    expect(save.unlocked).toContain('ghost');
  });
});

describe('leaderboard', () => {
  it('shows only today for the today tab, sorted, top 5', () => {
    const save = fresh();
    const now = day(2026, 10, 17);
    for (const s of [100, 900, 300, 700, 500, 200, 800]) recordRun(save, { stats: baseStats(), score: s, now, rng: createRng(8) });
    recordRun(save, { stats: baseStats(), score: 5000, now: day(2026, 10, 10), rng: createRng(8) });
    const today = leaderboardView(save, 'today', now);
    expect(today.top.map((e) => e.score)).toEqual([900, 800, 700, 500, 300]);
    const all = leaderboardView(save, 'all', now);
    expect(all.top[0].score).toBe(5000);
    expect(leaderboardView(save, 'today', now, 700).rank).toBe(3);
  });

  it('caps stored entries', () => {
    const save = fresh();
    for (let i = 0; i < 80; i++) recordRun(save, { stats: baseStats(), score: i, rng: createRng(9) });
    expect(save.board.length).toBeLessThanOrEqual(50);
  });
});

describe('review fixes', () => {
  it('does not re-roll a goal that was just completed', () => {
    for (let seed = 1; seed < 40; seed++) {
      const save = fresh();
      save.goals.active = ['dist3k', 'streak20', 'onc10'];
      recordRun(save, { stats: baseStats(), score: 100, rng: createRng(seed) });
      expect(save.goals.active).not.toContain('dist3k');
    }
  });

  it('keeps every speed goal reachable on the slowest difficulty', () => {
    const chillTop = 62 * 0.88;
    for (const g of GOAL_POOL.filter((x) => x.stat === 'maxSpeed')) expect(g.target).toBeLessThan(chillTop);
  });

  it('survives malformed nested save data instead of crashing the game', () => {
    const bad = [
      { goals: { active: 'x' } },
      { bindings: { left: 5 } },
      { settings: { master: 'loud', gameSpeed: 99, difficulty: 'insane', quality: 7 } },
      { unlocked: 'all', board: [1, 'x', { score: 'a' }], daily: 5, milestonesDone: {} },
      { coins: -50, best: NaN },
    ];
    for (const raw of bad) {
      const save = ensureGoals(normalizeSave(raw), createRng(1));
      expect(save.goals.active).toHaveLength(3);
      expect(save.unlocked.length).toBeGreaterThan(0);
      expect(save.settings.gameSpeed).toBe(1);
      expect(['chill', 'normal', 'hard']).toContain(save.settings.difficulty);
      expect(save.settings.master).toBeGreaterThanOrEqual(0);
      expect(save.settings.master).toBeLessThanOrEqual(1);
      expect(save.coins).toBeGreaterThanOrEqual(0);
      expect(save.board.every((e) => Number.isFinite(e.score))).toBe(true);
    }
  });

  it('keeps valid custom key bindings', () => {
    const save = normalizeSave({ bindings: { left: ['KeyJ'], right: [] } });
    expect(save.bindings).toEqual({ left: ['KeyJ'] });
  });
});

describe('save compatibility', () => {
  it('fills in missing fields from older saves', () => {
    const save = normalizeSave({ coins: 42, settings: { master: 0.1 } });
    expect(save.coins).toBe(42);
    expect(save.settings.master).toBe(0.1);
    expect(save.settings.sfx).toBe(defaultSave().settings.sfx);
    expect(save.unlocked).toContain('midnight');
  });

  it('survives garbage input', () => {
    for (const junk of [null, undefined, 5, 'x', []]) {
      expect(normalizeSave(junk).unlocked.length).toBeGreaterThan(0);
    }
  });
});
