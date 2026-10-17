import './style.css';
import { STEP } from './config.js';
import { AudioEngine } from './audio/audio.js';
import { BATTERY } from './config.js';
import { createSim } from './game/sim.js';
import { Input } from './input/input.js';
import { buyLivery, dailySeed, recordRun, todayKey } from './meta/progress.js';
import { loadSave, resetSave, writeSave } from './meta/storage.js';
import { LIVERIES } from './render/models.js';
import { GameView, isWebGLAvailable } from './render/view.js';
import { UI, keyLabel } from './ui/ui.js';

const $ = (id) => document.getElementById(id);
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const DISTRICT_NAMES = ['Coastal Dusk', 'Neon City', 'Desert Night', 'Rain Storm', 'Mountain Dawn'];
const fmt = (n) => Math.round(n).toLocaleString('en-US');

async function boot() {
  const ui = new UI();
  ui.show('loading');

  if (!isWebGLAvailable()) {
    ui.show('nogl');
    return;
  }

  ui.setLoading(0.1, 'Loading your garage');
  let save = loadSave();
  await frame();

  let view;
  try {
    view = new GameView($('scene'), { reducedMotion: save.settings.reducedMotion, quality: save.settings.quality });
  } catch (err) {
    console.error('Renderer failed to start', err);
    ui.show('nogl');
    return;
  }
  ui.setLoading(0.55, 'Building the road');
  await frame();

  const audio = new AudioEngine();
  const input = new Input($('app'));
  input.setBindings(save.bindings ?? {});
  const coarse = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  input.bindThrusterButton($('touch-thruster'));
  input.bindBrakeButton($('touch-brake'));

  const equipped = () => LIVERIES.find((l) => l.id === save.livery && save.unlocked.includes(l.id)) ?? LIVERIES[0];
  view.setLivery(equipped());
  ui.setReduced(save.settings.reducedMotion);
  applyAudioSettings();
  ui.setLoading(0.9, 'Charging the battery');
  await frame();

  // ---------------------------------------------------------------- state
  let mode = 'menu'; // menu | playing | paused | countdown | dying | over
  let sim = null;
  let acc = 0;
  let dyingTimer = 0;
  let countdown = 0;
  let overAt = 0;
  let currentRun = { daily: false, date: new Date() };
  let tutorial = null;
  /** Name of the key currently bound to an action, for on-screen hints (keys are rebindable). */
  const keyName = (action) => keyLabel(input.bindings[action][0]);
  let settingsReturn = 'menu';
  let gameClock = 0;

  function applyAudioSettings() {
    const s = save.settings;
    audio.setVolume('master', s.master);
    audio.setVolume('sfx', s.sfx);
    audio.setVolume('music', s.music);
    audio.setMuted(s.muted);
  }

  function dailyInfo() {
    const d = save.daily;
    const base = d.lastPlayed === todayKey() ? `Done today, best ${fmt(d.best)}` : 'A fresh road every day';
    return d.streak > 0 ? `${base}, ${d.streak} day streak` : base;
  }

  function showMenu() {
    mode = 'menu';
    input.enabled = false;
    ui.setHud(false);
    ui.updateMenu(save, dailyInfo());
    ui.show('menu');
    view.debris.visible = false;
    view.debrisActive = false;
    audio.setMotor(0, false);
  }

  // ---------------------------------------------------------------- run control
  function startRun({ daily = false } = {}) {
    audio.unlock();
    audio.click();
    // the date (and so the daily seed, streak and board entry) is fixed when the run starts, not when it ends
    currentRun = { daily, date: new Date() };
    const seed = daily ? dailySeed(todayKey(currentRun.date)) : (Math.random() * 2 ** 32) >>> 0;
    input.held.brake = false;
    if (save.settings.tilt && !input.tiltOn) {
      input.enableTilt().then((ok) => {
        if (!ok) ui.toast('Tilt steering is not available on this device.');
      });
    }
    sim = createSim({ seed, difficulty: save.settings.difficulty, autoTrick: save.settings.autoTrick });
    acc = 0;
    gameClock = 0;
    ui.resetHud();
    ui.show(null);
    ui.setHud(true);
    ui.setTouch(coarse);
    view.resetForRun();
    mode = 'playing';
    input.enabled = true;
    input.setTiltActive(save.settings.tilt);
    audio.startMusic();
    audio.setIntensity(0);
    tutorial = save.tutorialSeen ? null : { t: 0, step: 0, laneMoved: false, hopped: false, landed: false };
    ui.hint(null);
  }

  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    input.enabled = false;
    input.held.brake = false;
    audio.setMotor(0, false);
    audio.stopMusic();
    ui.show('pause');
  }

  function resume() {
    if (mode !== 'paused') return;
    ui.show(null);
    mode = 'countdown';
    countdown = 3;
    audio.unlock();
  }

  function quitToMenu() {
    audio.stopMusic();
    sim = null;
    showMenu();
  }

  function finishRun() {
    const stats = { ...sim.state.stats };
    const { summary } = recordRun(save, { stats, score: sim.state.score, daily: currentRun.daily, now: currentRun.date });
    writeSave(save);
    input.held.brake = false;
    ui.setHud(false);
    ui.showOver(summary, sim.state.overReason, stats);
    mode = 'over';
    overAt = performance.now();
    audio.setMotor(0, false);
    audio.stopMusic();
  }

  // ---------------------------------------------------------------- sim events
  function handleEvent(ev) {
    view.onEvent(ev);
    switch (ev.type) {
      case 'lane':
        if (tutorial) tutorial.laneMoved = true;
        break;
      case 'nearMiss':
        audio.nearMiss(ev.streak, ev.shave);
        ui.popup(`${ev.shave ? 'Close shave ' : ''}+${fmt(ev.points)}`, ev.shave ? 'shave' : '');
        break;
      case 'pad':
        audio.pad();
        ui.popup(`Charged +${BATTERY.pad}`, 'good');
        break;
      case 'hop':
        audio.hop();
        if (tutorial) tutorial.hopped = true;
        break;
      case 'ramp':
        audio.hop();
        ui.popup('Ramp!', 'trick');
        break;
      case 'maneuver':
        audio.maneuver();
        break;
      case 'maneuverDone':
        ui.popup(ev.axis === 'roll' ? 'Barrel roll' : 'Flip', 'trick');
        break;
      case 'land':
        audio.landClean(0);
        if (tutorial) tutorial.landed = true;
        break;
      case 'landClean':
        audio.landClean(ev.points);
        ui.popup(ev.combo ? `Combo +${fmt(ev.points)}` : ev.points ? `Clean landing +${fmt(ev.points)}` : 'Clean landing', 'good');
        if (tutorial) tutorial.landed = true;
        break;
      case 'landMessy':
        audio.landMessy();
        ui.popup('Messy landing, streak lost', 'bad');
        if (tutorial) tutorial.landed = true;
        break;
      case 'skim':
        ui.popup(`Skim +${fmt(ev.points)}`, 'trick');
        break;
      case 'ceilGrab':
        audio.ceiling(true);
        ui.popup('Ceiling run, score x2', 'trick');
        break;
      case 'ceilDrop':
        audio.ceiling(false);
        if (ev.reason === 'suction') ui.popup('Out of suction', 'bad');
        break;
      case 'zoneWarn':
        audio.zone();
        ui.banner(coarse ? 'Ceiling run ahead. Hold Hop to stick to the roof.' : `Ceiling run ahead. Press ${keyName('grab')} to stick to the roof.`);
        break;
      case 'batteryLow':
        audio.warn();
        ui.banner('Battery low. Drive over a green charge pad.', 'warn');
        break;
      case 'district':
        ui.toast(DISTRICT_NAMES[ev.index] ?? '');
        break;
      case 'crash':
        audio.crash();
        if (!save.settings.reducedMotion) ui.flash();
        break;
      default:
        break;
    }
  }

  function updateTutorial(dt) {
    const tu = tutorial;
    if (!tu || !sim) return;
    tu.t += dt;
    const s = sim.state;
    if (tu.step === 0) {
      ui.hint(coarse ? 'Swipe or tap left and right to change lane' : `Press ${keyName('left')} or ${keyName('right')} to change lane`);
      if (tu.laneMoved || tu.t > 8) {
        tu.step = 1;
        tu.t = 0;
      }
    } else if (tu.step === 1) {
      ui.hint('Pass cars closely to build a streak. Green pads recharge the battery.');
      if (tu.t > 6) {
        tu.step = 2;
        tu.t = 0;
      }
    } else if (tu.step === 2) {
      if (s.pips >= 1) {
        ui.hint(coarse ? 'Tap Hop to jump over traffic' : `Press ${keyName('hop')} to hop over traffic`);
        if (tu.hopped || tu.t > 10) {
          tu.step = 3;
          tu.t = 0;
        }
      } else {
        ui.hint(null);
        tu.t = 0;
      }
    } else if (tu.step === 3) {
      if (tu.hopped && !tu.landed) {
        ui.hint(coarse ? 'In the air, swipe to roll or flip. Land level.' : `In the air, ${keyName('left')} and ${keyName('right')} roll, ${keyName('up')} and ${keyName('down')} flip. Land level.`);
      } else ui.hint(null);
      if (tu.landed || tu.t > 9) tu.step = 4;
    } else {
      ui.hint(null);
      save.tutorialSeen = true;
      writeSave(save);
      tutorial = null;
    }
  }

  // ---------------------------------------------------------------- input routing
  input.onAction = (name) => {
    if (name === 'pause') {
      if (mode === 'playing') pause();
      else if (mode === 'paused' && ui.current === 'pause') resume(); // not while Settings is open on top
      return;
    }
    if (mode === 'playing' && sim) sim.action(name);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (['garage', 'goals', 'settings'].includes(ui.current)) goBack();
      else if (mode === 'playing') pause();
      else if (mode === 'paused') resume();
      return;
    }
    if (mode === 'over' && (e.code === 'Enter' || e.code === 'Space') && performance.now() - overAt > 700) {
      if (document.activeElement?.tagName !== 'BUTTON') {
        e.preventDefault();
        startRun(currentRun);
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  window.addEventListener('blur', () => pause());
  window.addEventListener('resize', () => view.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => view.resize(), 200));

  // ---------------------------------------------------------------- menu wiring
  function goBack() {
    audio.click();
    if (settingsReturn === 'pause' && ui.current === 'settings') {
      ui.show('pause');
      settingsReturn = 'menu';
    } else {
      ui.updateMenu(save, dailyInfo());
      ui.show('menu');
    }
  }

  $('btn-play').addEventListener('click', () => startRun({ daily: false }));
  $('btn-daily').addEventListener('click', () => startRun({ daily: true }));
  $('btn-retry').addEventListener('click', () => startRun(currentRun));
  $('btn-over-menu').addEventListener('click', () => {
    audio.click();
    quitToMenu();
  });
  $('btn-pause').addEventListener('click', () => pause());
  $('btn-resume').addEventListener('click', () => {
    audio.click();
    resume();
  });
  $('btn-restart').addEventListener('click', () => startRun(currentRun));
  $('btn-quit').addEventListener('click', () => {
    audio.click();
    quitToMenu();
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', goBack));

  // garage
  function pickLivery(l) {
    audio.unlock();
    let msg = '';
    if (save.unlocked.includes(l.id)) {
      save.livery = l.id;
      msg = `Equipped ${l.name}`;
    } else {
      const res = buyLivery(save, l);
      if (res.ok) {
        save.livery = l.id;
        msg = `Unlocked ${l.name}`;
        audio.pad();
      } else msg = `Not enough coins. You need ${fmt(l.price - save.coins)} more.`;
    }
    view.setLivery(equipped());
    writeSave(save);
    ui.renderGarage(save, save.livery, pickLivery, msg);
  }
  $('btn-garage').addEventListener('click', () => {
    audio.unlock();
    audio.click();
    ui.renderGarage(save, save.livery, pickLivery);
    ui.show('garage');
  });

  // goals
  $('btn-goals').addEventListener('click', () => {
    audio.unlock();
    audio.click();
    ui.renderGoals(save);
    ui.show('goals');
  });
  $('tab-today').addEventListener('click', () => {
    ui.boardMode = 'today';
    ui.renderBoard(save);
  });
  $('tab-all').addEventListener('click', () => {
    ui.boardMode = 'all';
    ui.renderBoard(save);
  });

  // settings
  function openSettings(from) {
    settingsReturn = from;
    ui.renderSettings(save, input, rebind);
    ui.show('settings');
  }
  function rebind(action, btn) {
    btn.textContent = 'Press a key';
    btn.classList.add('listening');
    input.rebind(action).then(() => {
      save.bindings = input.bindings;
      writeSave(save);
      ui.renderSettings(save, input, rebind);
    });
  }
  $('btn-settings').addEventListener('click', () => {
    audio.unlock();
    audio.click();
    openSettings('menu');
  });
  $('btn-pause-settings').addEventListener('click', () => openSettings('pause'));

  const bindRange = (id, key, kind) => {
    $(id).addEventListener('input', (e) => {
      save.settings[key] = Number(e.target.value);
      audio.setVolume(kind, save.settings[key]);
    });
    $(id).addEventListener('change', () => {
      audio.unlock();
      audio.click();
      writeSave(save);
    });
  };
  bindRange('set-master', 'master', 'master');
  bindRange('set-sfx', 'sfx', 'sfx');
  bindRange('set-music', 'music', 'music');
  $('set-muted').addEventListener('change', (e) => {
    save.settings.muted = e.target.checked;
    audio.setMuted(save.settings.muted);
    writeSave(save);
  });
  $('set-reduced').addEventListener('change', (e) => {
    save.settings.reducedMotion = e.target.checked;
    view.setReducedMotion(e.target.checked);
    ui.setReduced(e.target.checked);
    writeSave(save);
  });
  $('set-auto').addEventListener('change', (e) => {
    save.settings.autoTrick = e.target.checked;
    writeSave(save);
  });
  $('set-tilt').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const ok = await input.enableTilt();
      if (!ok) {
        e.target.checked = false;
        ui.toast('Tilt steering is not available on this device.');
      }
      save.settings.tilt = ok;
    } else save.settings.tilt = false;
    writeSave(save);
  });
  $('set-speed').addEventListener('change', (e) => {
    save.settings.gameSpeed = Number(e.target.value);
    writeSave(save);
  });
  $('set-difficulty').addEventListener('change', (e) => {
    save.settings.difficulty = e.target.value;
    writeSave(save);
  });
  $('set-quality').addEventListener('change', (e) => {
    save.settings.quality = e.target.value;
    view.setQualityMode(e.target.value);
    writeSave(save);
  });
  $('btn-reset-keys').addEventListener('click', () => {
    input.setBindings({});
    save.bindings = null;
    writeSave(save);
    ui.renderSettings(save, input, rebind);
  });
  $('btn-reset-save').addEventListener('click', () => {
    if (!window.confirm('Erase all coins, unlocks, goals and best scores on this device?')) return;
    save = resetSave();
    input.setBindings({});
    applyAudioSettings();
    view.setLivery(equipped());
    view.setReducedMotion(save.settings.reducedMotion);
    ui.setReduced(save.settings.reducedMotion);
    ui.renderSettings(save, input, rebind);
    ui.toast('Progress erased.');
  });

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // `last` can briefly be ahead of the rAF timestamp
    last = now;
    gameClock += dt;
    input.pollGamepad();

    if (mode === 'playing' && sim) {
      sim.setBraking(input.held.brake && !sim.state.player.air);
      acc += dt * save.settings.gameSpeed;
      let steps = 0;
      while (acc >= STEP && steps < 5 && !sim.state.over) {
        sim.step(STEP);
        acc -= STEP;
        steps++;
        sim.flushEvents(handleEvent);
      }
      if (steps === 5) acc = 0;
      const st = sim.state;
      view.update(st, dt);
      ui.updateHud(st);
      const speedFrac = Math.min(1, Math.max(0, (st.speed - 20) / 44));
      audio.setMotor(speedFrac, !st.over, st.player.air || !!st.player.transit);
      audio.setIntensity(speedFrac);
      updateTutorial(dt);
      if (st.over) {
        mode = 'dying';
        dyingTimer = 1.1;
        audio.setMotor(0, false);
        ui.hint(null);
      }
    } else if (mode === 'dying' && sim) {
      sim.flushEvents(handleEvent);
      view.update(sim.state, dt);
      dyingTimer -= dt;
      if (dyingTimer <= 0) finishRun();
    } else if (mode === 'countdown' && sim) {
      view.update(sim.state, 0.0001);
      const prev = Math.ceil(countdown);
      countdown -= dt;
      const n = Math.ceil(countdown);
      if (countdown <= 0) {
        mode = 'playing';
        input.enabled = true;
        ui.hint(null);
        audio.startMusic();
        last = performance.now();
      } else {
        ui.hint(String(n));
        if (n !== prev) audio.click();
      }
    } else if ((mode === 'paused' || mode === 'over') && sim) {
      view.update(sim.state, 0.0001);
    } else {
      view.idleUpdate(dt, gameClock, { garage: ui.current === 'garage' });
    }
    view.render();
  }

  ui.setLoading(1, 'Ready');
  await frame();
  showMenu();
  requestAnimationFrame(tick);

  // minimal hooks for automated tests; they expose nothing the page cannot already do
  window.__ionrun = {
    get mode() {
      return mode;
    },
    get state() {
      return sim?.state ?? null;
    },
    startRun,
    action: (a) => sim?.action(a),
    get quality() {
      return view.tier;
    },
    get camBlend() {
      return view.camBlend;
    },
  };
}

boot().catch((err) => {
  console.error(err);
  try {
    document.getElementById('screen-nogl').hidden = false;
    document.getElementById('screen-loading').hidden = true;
  } catch {
    /* nothing else to do */
  }
});
