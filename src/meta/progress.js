import { createRng, seedFromString } from '../game/rng.js';

/** Pure progression logic (no DOM, no storage) so it is easy to test. */

export const GOAL_POOL = [
  { id: 'nm30', text: 'Make 30 near misses in one run', stat: 'nearMisses', target: 30, reward: 60 },
  { id: 'nm60', text: 'Make 60 near misses in one run', stat: 'nearMisses', target: 60, reward: 140 },
  { id: 'streak12', text: 'Reach a 12 streak', stat: 'maxStreak', target: 12, reward: 80 },
  { id: 'streak20', text: 'Reach a 20 streak', stat: 'maxStreak', target: 20, reward: 160 },
  { id: 'clean3', text: 'Land 3 clean air tricks in one run', stat: 'cleanLandings', target: 3, reward: 70 },
  { id: 'clean8', text: 'Land 8 clean landings in one run', stat: 'cleanLandings', target: 8, reward: 150 },
  { id: 'combo1', text: 'Land a roll + flip combo', stat: 'combos', target: 1, reward: 90 },
  { id: 'flip3', text: 'Do 3 flips in one run', stat: 'flips', target: 3, reward: 80 },
  { id: 'roll4', text: 'Do 4 barrel rolls in one run', stat: 'rolls', target: 4, reward: 80 },
  { id: 'dist3k', text: 'Drive 3,000 m', stat: 'distance', target: 3000, reward: 70 },
  { id: 'dist6k', text: 'Drive 6,000 m', stat: 'distance', target: 6000, reward: 170 },
  { id: 'score5k', text: 'Score 5,000 points', stat: 'score', target: 5000, reward: 70 },
  { id: 'score12k', text: 'Score 12,000 points', stat: 'score', target: 12000, reward: 180 },
  { id: 'ceil150', text: 'Drive 150 m upside down', stat: 'ceilingMeters', target: 150, reward: 100 },
  { id: 'ceil400', text: 'Drive 400 m upside down', stat: 'ceilingMeters', target: 400, reward: 200 },
  { id: 'pads5', text: 'Collect 5 charge pads in one run', stat: 'pads', target: 5, reward: 60 },
  { id: 'onc10', text: 'Pass 10 oncoming cars', stat: 'oncomingPasses', target: 10, reward: 90 },
  { id: 'skim3', text: 'Skim over 3 cars in the air', stat: 'skims', target: 3, reward: 90 },
  { id: 'speed50', text: 'Reach 180 km/h', stat: 'maxSpeed', target: 50, reward: 80 },
  { id: 'ramp2', text: 'Launch off 2 ramps in one run', stat: 'rampJumps', target: 2, reward: 70 },
];

export const MILESTONES = [
  { id: 'near500', text: '500 near misses in total', stat: 'totalNearMisses', target: 500, unlock: 'violet' },
  { id: 'dist50k', text: 'Drive 50 km in total', stat: 'totalDistance', target: 50000, unlock: 'forest' },
  { id: 'runs25', text: 'Complete 25 runs', stat: 'totalRuns', target: 25, unlock: 'ghost' },
];

export const todayKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const dailySeed = (key = todayKey()) => seedFromString(`ion-run:${key}`);

const dayNumber = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};

export function defaultSave() {
  return {
    v: 1,
    coins: 0,
    best: 0,
    totalRuns: 0,
    totalNearMisses: 0,
    totalDistance: 0,
    unlocked: ['midnight'],
    livery: 'midnight',
    goals: { active: [], completed: 0 },
    daily: { date: null, best: 0, streak: 0, lastPlayed: null },
    board: [],
    tutorialSeen: false,
    milestonesDone: [],
    settings: {
      master: 0.8,
      sfx: 0.9,
      music: 0.45,
      muted: false,
      reducedMotion: false,
      gameSpeed: 1,
      difficulty: 'normal',
      autoTrick: false,
      tilt: false,
      quality: 'auto',
    },
    bindings: null,
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, min = -Infinity, max = Infinity) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * Merge a loaded object over defaults and coerce every field to a safe type, so older or hand-edited
 * saves can never crash the game.
 */
export function normalizeSave(raw) {
  const d = defaultSave();
  if (!isObj(raw)) return d;
  const s = isObj(raw.settings) ? raw.settings : {};
  const dl = isObj(raw.daily) ? raw.daily : {};
  const g = isObj(raw.goals) ? raw.goals : {};
  const unlocked = strings(raw.unlocked);
  let bindings = null;
  if (isObj(raw.bindings)) {
    bindings = {};
    for (const [k, v] of Object.entries(raw.bindings)) {
      const codes = strings(v);
      if (codes.length) bindings[k] = codes;
    }
    if (!Object.keys(bindings).length) bindings = null;
  }
  return {
    ...d,
    v: 1,
    coins: Math.floor(num(raw.coins, 0, 0)),
    best: Math.floor(num(raw.best, 0, 0)),
    totalRuns: Math.floor(num(raw.totalRuns, 0, 0)),
    totalNearMisses: Math.floor(num(raw.totalNearMisses, 0, 0)),
    totalDistance: num(raw.totalDistance, 0, 0),
    unlocked: unlocked.length ? unlocked : d.unlocked,
    livery: typeof raw.livery === 'string' ? raw.livery : d.livery,
    goals: { active: strings(g.active), completed: Math.floor(num(g.completed, 0, 0)) },
    daily: {
      date: typeof dl.date === 'string' ? dl.date : null,
      best: Math.floor(num(dl.best, 0, 0)),
      streak: Math.floor(num(dl.streak, 0, 0)),
      lastPlayed: typeof dl.lastPlayed === 'string' ? dl.lastPlayed : null,
    },
    board: (Array.isArray(raw.board) ? raw.board : [])
      .filter((e) => isObj(e) && Number.isFinite(e.score) && typeof e.date === 'string')
      .slice(0, 50)
      .map((e) => ({ score: Math.floor(e.score), date: e.date, daily: !!e.daily })),
    tutorialSeen: !!raw.tutorialSeen,
    milestonesDone: strings(raw.milestonesDone),
    settings: {
      master: num(s.master, d.settings.master, 0, 1),
      sfx: num(s.sfx, d.settings.sfx, 0, 1),
      music: num(s.music, d.settings.music, 0, 1),
      muted: !!s.muted,
      reducedMotion: !!s.reducedMotion,
      gameSpeed: [0.8, 1, 1.2].includes(s.gameSpeed) ? s.gameSpeed : 1,
      difficulty: ['chill', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : 'normal',
      autoTrick: !!s.autoTrick,
      tilt: !!s.tilt,
      quality: ['auto', 'high', 'medium', 'low'].includes(s.quality) ? s.quality : 'auto',
    },
    bindings,
  };
}

/** Make sure three distinct active goals exist. `exclude` keeps just-completed goals from reappearing at once. */
export function ensureGoals(save, rng = createRng(Date.now() >>> 0), exclude = []) {
  const active = [...new Set(save.goals.active)].filter((id) => GOAL_POOL.some((g) => g.id === id));
  while (active.length < 3) {
    let pool = GOAL_POOL.filter((g) => !active.includes(g.id) && !exclude.includes(g.id));
    if (!pool.length) pool = GOAL_POOL.filter((g) => !active.includes(g.id));
    active.push(rng.pick(pool).id);
  }
  save.goals.active = active.slice(0, 3);
  return save;
}

export function goalById(id) {
  return GOAL_POOL.find((g) => g.id === id);
}

export function goalProgress(goal, stats, score) {
  const value = goal.stat === 'score' ? score : stats[goal.stat] ?? 0;
  return Math.min(1, value / goal.target);
}

export function coinsForRun(stats) {
  return Math.floor(
    Math.floor(stats.distance / 60) + stats.nearMisses + stats.tricks * 3 + stats.cleanLandings * 2 + stats.pads,
  );
}

/**
 * Apply a finished run to the save. Returns a summary for the game-over screen.
 * Mutates and returns `{ save, summary }`.
 */
export function recordRun(save, { stats, score, daily = false, now = new Date(), rng = createRng(Date.now() >>> 0) }) {
  const summary = {
    score: Math.round(score),
    coinsEarned: 0,
    goalCoins: 0,
    dailyBonus: 0,
    newBest: false,
    completedGoals: [],
    newUnlocks: [],
    goals: [],
    dailyStreak: save.daily.streak,
  };

  ensureGoals(save, rng);
  summary.coinsEarned = coinsForRun(stats);

  // goals
  const remaining = [];
  for (const id of save.goals.active) {
    const g = goalById(id);
    const p = goalProgress(g, stats, score);
    summary.goals.push({ id, text: g.text, progress: p, done: p >= 1, reward: g.reward });
    if (p >= 1) {
      summary.completedGoals.push(g);
      summary.goalCoins += g.reward;
      save.goals.completed += 1;
    } else remaining.push(id);
  }
  save.goals.active = remaining;
  ensureGoals(save, rng, summary.completedGoals.map((g) => g.id));

  // daily run with forgiving streak (one missed day keeps the streak)
  const key = todayKey(now);
  if (daily) {
    const last = save.daily.lastPlayed;
    if (last !== key) {
      const gap = last ? dayNumber(key) - dayNumber(last) : null;
      save.daily.streak = gap !== null && gap <= 2 ? save.daily.streak + 1 : 1;
      save.daily.lastPlayed = key;
      summary.dailyBonus = 100 + 20 * Math.min(save.daily.streak, 7);
    }
    if (save.daily.date !== key) {
      save.daily.date = key;
      save.daily.best = 0;
    }
    save.daily.best = Math.max(save.daily.best, Math.round(score));
    summary.dailyStreak = save.daily.streak;
  }

  save.coins += summary.coinsEarned + summary.goalCoins + summary.dailyBonus;
  save.totalRuns += 1;
  save.totalNearMisses += stats.nearMisses;
  save.totalDistance += stats.distance;

  const rounded = Math.round(score);
  if (rounded > save.best) {
    save.best = rounded;
    summary.newBest = true;
  }

  save.board.push({ score: rounded, date: key, daily });
  save.board.sort((a, b) => b.score - a.score);
  save.board = save.board.slice(0, 50);

  // milestone unlocks
  for (const m of MILESTONES) {
    if (save.milestonesDone.includes(m.id)) continue;
    if ((save[m.stat] ?? 0) >= m.target) {
      save.milestonesDone.push(m.id);
      if (!save.unlocked.includes(m.unlock)) {
        save.unlocked.push(m.unlock);
        summary.newUnlocks.push(m.unlock);
      }
    }
  }

  return { save, summary };
}

export function buyLivery(save, livery) {
  if (save.unlocked.includes(livery.id)) return { ok: true, reason: 'owned' };
  if (save.coins < livery.price) return { ok: false, reason: 'coins' };
  save.coins -= livery.price;
  save.unlocked.push(livery.id);
  return { ok: true, reason: 'bought' };
}

/** "Top 5 plus your rank" for today, or the all-time top. */
export function leaderboardView(save, mode = 'today', now = new Date(), lastScore = null) {
  const key = todayKey(now);
  const list = mode === 'today' ? save.board.filter((e) => e.date === key) : save.board;
  const top = list.slice(0, 5);
  let rank = null;
  if (lastScore !== null) {
    const i = list.findIndex((e) => e.score === lastScore);
    rank = i >= 0 ? i + 1 : null;
  }
  return { top, rank, total: list.length };
}
