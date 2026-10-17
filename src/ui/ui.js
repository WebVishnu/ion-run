import { SCORE } from '../config.js';
import { ACTION_LABELS } from '../input/input.js';
import { LIVERIES } from '../render/models.js';
import { GOAL_POOL, MILESTONES, goalById, leaderboardView } from '../meta/progress.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const REASONS = {
  collision: 'You hit another car.',
  battery: 'The battery ran flat. Drive over green charge pads to refill it.',
  landing: 'You landed upside down or sideways.',
};

export const keyLabel = (code) =>
  ({
    ArrowLeft: 'Left arrow',
    ArrowRight: 'Right arrow',
    ArrowUp: 'Up arrow',
    ArrowDown: 'Down arrow',
    Space: 'Space',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
  })[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '');

/** Thin DOM layer. It never touches the simulation; main.js passes it plain values. */
export class UI {
  constructor() {
    this.screens = ['loading', 'menu', 'pause', 'over', 'garage', 'goals', 'settings', 'nogl'];
    this.current = null;
    this.last = {};
    this.boardMode = 'today';
    this.hudEl = {
      score: $('hud-score'),
      mult: $('hud-mult'),
      streakFill: $('hud-streak-fill'),
      streakText: $('hud-streak-text'),
      speed: $('hud-speed'),
      batteryVal: $('hud-battery-val'),
      batteryFill: $('hud-battery-fill'),
      battery: $('hud-battery'),
      pips: [...document.querySelectorAll('#hud-pips .pip')],
      suction: $('hud-suction'),
      suctionFill: $('hud-suction-fill'),
    };
    this.bannerTimer = null;
    this.hintTimer = null;
    this.popupCount = 0;
  }

  // ------------------------------------------------------------ screens
  show(name) {
    for (const s of this.screens) {
      const el = $(`screen-${s}`);
      if (el) el.hidden = s !== name;
    }
    this.current = name;
    if (name) {
      const root = $(`screen-${name}`);
      const target = root?.querySelector('[autofocus]') ?? root?.querySelector('button:not([hidden])');
      target?.focus({ preventScroll: true });
    }
  }

  setHud(on) {
    $('hud').hidden = !on;
    if (!on) {
      this.hideBanner();
      this.hint(null);
    }
  }

  setTouch(on) {
    document.body.classList.toggle('touch', on);
    $('touch-controls').hidden = !on;
  }

  setReduced(on) {
    document.body.classList.toggle('reduced', !!on);
  }

  setLoading(p, text) {
    $('load-fill').style.width = `${Math.round(p * 100)}%`;
    if (text) $('load-text').textContent = text;
  }

  // ------------------------------------------------------------ menu
  updateMenu(save, dailyInfo) {
    $('menu-best').textContent = fmt(save.best);
    $('menu-coins').textContent = fmt(save.coins);
    $('daily-sub').textContent = dailyInfo;
  }

  // ------------------------------------------------------------ HUD
  updateHud(state) {
    const el = this.hudEl;
    const L = this.last;
    const score = Math.round(state.score);
    if (L.score !== score) {
      el.score.textContent = fmt(score);
      L.score = score;
    }
    const mult = state.mult;
    if (L.mult !== mult) {
      el.mult.hidden = mult <= 1;
      el.mult.textContent = `x${mult % 1 ? mult.toFixed(1) : mult}`;
      L.mult = mult;
    }
    const streakPct = state.streak > 0 ? Math.max(0, state.streakTimer / SCORE.streakTime) : 0;
    const sp = Math.round(streakPct * 100);
    if (L.streakPct !== sp) {
      el.streakFill.style.width = `${sp}%`;
      L.streakPct = sp;
    }
    if (L.streak !== state.streak) {
      el.streakText.textContent = state.streak > 1 ? `${state.streak} streak` : '';
      L.streak = state.streak;
    }
    const kmh = Math.round(state.speed * 3.6);
    if (L.kmh !== kmh) {
      el.speed.textContent = kmh;
      L.kmh = kmh;
    }
    const bat = Math.max(0, Math.round(state.battery));
    if (L.bat !== bat) {
      el.batteryVal.textContent = `${bat}%`;
      el.batteryFill.style.transform = `scaleX(${bat / 100})`;
      el.battery.classList.toggle('low', bat < 22);
      L.bat = bat;
    }
    const pipKey = Math.floor(state.pips * 10);
    if (L.pips !== pipKey) {
      el.pips.forEach((pip, i) => {
        const f = Math.max(0, Math.min(1, state.pips - i));
        pip.style.setProperty('--f', `${Math.round(f * 100)}%`);
        pip.classList.toggle('full', f >= 1);
      });
      L.pips = pipKey;
    }
    const inverted = state.player.level === 1 || !!state.player.transit;
    if (L.inv !== inverted) {
      el.suction.hidden = !inverted;
      L.inv = inverted;
    }
    if (inverted) {
      const s = Math.round(state.suction * 100);
      if (L.suction !== s) {
        el.suctionFill.style.transform = `scaleX(${s / 100})`;
        L.suction = s;
      }
    }
  }

  resetHud() {
    this.last = {};
  }

  /** Three fixed rows; a new popup takes a free row, or replaces the oldest one so nothing important is dropped. */
  popup(text, cls = '') {
    const box = $('hud-popups');
    const slots = (this.popupSlots ??= [null, null, null]);
    let slot = slots.findIndex((s) => s === null);
    if (slot === -1) {
      slot = slots.reduce((oldest, s, i) => (s.at < slots[oldest].at ? i : oldest), 0);
      slots[slot].el.remove();
    }
    const el = document.createElement('span');
    el.className = `popup ${cls}`;
    el.textContent = text;
    el.style.top = `${slot * 34 - 10}px`;
    box.appendChild(el);
    const entry = { el, at: performance.now() };
    slots[slot] = entry;
    setTimeout(() => {
      el.remove();
      if (slots[slot] === entry) slots[slot] = null;
    }, 900);
  }

  banner(text, kind = '', ms = 2600) {
    const el = $('hud-banner');
    el.textContent = text;
    el.className = `banner ${kind}`;
    el.hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.hideBanner(), ms);
    this.announce(text);
  }

  hideBanner() {
    $('hud-banner').hidden = true;
  }

  hint(text) {
    const el = $('hud-hint');
    if (!text) {
      el.hidden = true;
      return;
    }
    if (el.textContent !== text) el.textContent = text;
    el.hidden = false;
  }

  toast(text) {
    const box = $('toast');
    const item = document.createElement('div');
    item.className = 'toast-item';
    item.textContent = text;
    box.appendChild(item);
    setTimeout(() => item.remove(), 2700);
  }

  flash() {
    const f = $('flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  announce(text) {
    $('sr-live').textContent = '';
    setTimeout(() => {
      $('sr-live').textContent = text;
    }, 30);
  }

  // ------------------------------------------------------------ game over
  showOver(summary, reason, stats) {
    $('over-reason').textContent = REASONS[reason] ?? '';
    $('over-score').textContent = fmt(summary.score);
    $('over-best').hidden = !summary.newBest;
    const rows = [
      ['Distance', `${fmt(stats.distance)} m`],
      ['Near misses', fmt(stats.nearMisses)],
      ['Air tricks', fmt(stats.tricks)],
      ['Upside down', `${fmt(stats.ceilingMeters)} m`],
      ['Coins from the run', `+${fmt(summary.coinsEarned)}`],
    ];
    if (summary.goalCoins) rows.push(['Goal rewards', `+${fmt(summary.goalCoins)}`]);
    if (summary.dailyBonus) rows.push([`Daily run, ${summary.dailyStreak} day streak`, `+${fmt(summary.dailyBonus)}`]);
    $('over-breakdown').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join('');
    $('over-goals').innerHTML = summary.goals
      .map(
        (g) =>
          `<div class="goal ${g.done ? 'done' : ''}"><div class="goal-top"><span>${g.text}</span><b>${g.done ? 'Done +' + g.reward : Math.round(g.progress * 100) + '%'}</b></div><div class="bar"><div style="width:${Math.round(g.progress * 100)}%"></div></div></div>`,
      )
      .join('');
    const unlock = $('over-unlocks');
    if (summary.newUnlocks.length) {
      const names = summary.newUnlocks.map((id) => LIVERIES.find((l) => l.id === id)?.name ?? id).join(', ');
      unlock.textContent = `New livery unlocked: ${names}`;
      unlock.hidden = false;
    } else unlock.hidden = true;
    this.show('over');
    this.announce(`Run over. Score ${fmt(summary.score)}.`);
  }

  // ------------------------------------------------------------ garage
  renderGarage(save, selectedId, onPick, msg = '') {
    $('garage-coins').textContent = fmt(save.coins);
    $('garage-msg').textContent = msg;
    const list = $('livery-list');
    list.innerHTML = '';
    for (const l of LIVERIES) {
      const owned = save.unlocked.includes(l.id);
      const btn = document.createElement('button');
      btn.className = 'livery';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(l.id === selectedId));
      const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
      btn.innerHTML = `<span class="swatch" style="--col:${hex(l.body)};--acc:${hex(l.accent)};--glow:${hex(l.glow)}55"></span><span><span class="name">${l.name}</span></span><span class="state ${owned ? '' : 'locked'}">${l.id === selectedId ? 'Equipped' : owned ? 'Owned' : fmt(l.price) + ' coins'}</span>`;
      btn.addEventListener('click', () => onPick(l));
      list.appendChild(btn);
    }
  }

  // ------------------------------------------------------------ goals
  renderGoals(save, now = new Date()) {
    $('goal-list').innerHTML = save.goals.active
      .map((id) => {
        const g = goalById(id);
        return `<div class="goal"><div class="goal-top"><span>${g.text}</span><b>+${g.reward}</b></div></div>`;
      })
      .join('');
    this.renderBoard(save, now);
    $('milestones').innerHTML = MILESTONES.map((m) => {
      const value = Math.min(m.target, Math.round(save[m.stat] ?? 0));
      const done = save.milestonesDone.includes(m.id);
      const lv = LIVERIES.find((l) => l.id === m.unlock);
      return `<div class="goal ${done ? 'done' : ''}"><div class="goal-top"><span>${m.text}</span><b>${done ? 'Unlocked' : lv?.name ?? ''}</b></div><div class="bar"><div style="width:${Math.round((value / m.target) * 100)}%"></div></div></div>`;
    }).join('');
  }

  renderBoard(save, now = new Date(), lastScore = null) {
    const view = leaderboardView(save, this.boardMode, now, lastScore);
    const board = $('board');
    if (!view.top.length) {
      board.innerHTML = '<li class="empty">No runs yet. Play one to get on the board.</li>';
    } else {
      board.innerHTML = view.top
        .map((e, i) => `<li><span>${i + 1}. ${e.daily ? 'Daily run' : 'Run'}</span><b class="num">${fmt(e.score)}</b></li>`)
        .join('');
    }
    $('tab-today').setAttribute('aria-selected', String(this.boardMode === 'today'));
    $('tab-all').setAttribute('aria-selected', String(this.boardMode === 'all'));
  }

  // ------------------------------------------------------------ settings
  renderSettings(save, input, onRebind) {
    const s = save.settings;
    $('set-master').value = s.master;
    $('set-sfx').value = s.sfx;
    $('set-music').value = s.music;
    $('set-muted').checked = s.muted;
    $('set-reduced').checked = s.reducedMotion;
    $('set-auto').checked = s.autoTrick;
    $('set-tilt').checked = s.tilt;
    $('set-speed').value = String(s.gameSpeed);
    $('set-difficulty').value = s.difficulty;
    $('set-quality').value = s.quality;
    const box = $('bindings');
    box.innerHTML = '';
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      const row = document.createElement('div');
      row.className = 'bind';
      const name = document.createElement('span');
      name.textContent = label;
      const btn = document.createElement('button');
      btn.textContent = input.bindings[action].map(keyLabel).join(' / ');
      btn.setAttribute('aria-label', `${label}: ${btn.textContent}. Press to change.`);
      btn.addEventListener('click', () => onRebind(action, btn));
      row.append(name, btn);
      box.appendChild(row);
    }
  }
}

export { GOAL_POOL };
