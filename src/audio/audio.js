/**
 * Fully synthesized audio (Web Audio API): EV whine + wind bed, sound effects and a small
 * generative synthwave loop. Zero audio files. The context is created on the first user gesture.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, sfx: 0.9, music: 0.45 };
    this.muted = false;
    this.musicOn = false;
    this.step = 0;
    this.nextNoteTime = 0;
    this.intensity = 0;
  }

  /** Must be called from a user gesture (click / touchend / keydown). Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      try {
        this.ctx = new Ctx();
      } catch {
        return false;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.motorBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.motorBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.applyVolumes();

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // motor: low hum (saw through lowpass) + electric whine (sine) + wind (bandpassed noise)
    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(this.humFilter).connect(this.humGain).connect(this.motorBus);

    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.motorBus);

    this.wind = ctx.createBufferSource();
    this.wind.buffer = this.noise;
    this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter).connect(this.windGain).connect(this.motorBus);

    this.hum.start();
    this.whine.start();
    this.wind.start();
    this.motorOn = false;
    this.setMotor(0, false);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.03);
    this.motorBus.gain.setTargetAtTime(this.vol.sfx * 0.7, t, 0.03);
  }

  setVolume(kind, value) {
    this.vol[kind] = Math.max(0, Math.min(1, value));
    this.applyVolumes();
  }

  setMuted(on) {
    this.muted = !!on;
    this.applyVolumes();
  }

  // ------------------------------------------------------------ motor
  /** speedFrac 0..1, boosting adds a thruster hiss. */
  setMotor(speedFrac, active, boosting = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = active ? 1 : 0;
    this.hum.frequency.setTargetAtTime(48 + speedFrac * 70, t, 0.05);
    this.humFilter.frequency.setTargetAtTime(180 + speedFrac * 500, t, 0.05);
    this.humGain.gain.setTargetAtTime(on * (0.1 + speedFrac * 0.08), t, 0.08);
    this.whine.frequency.setTargetAtTime(380 + speedFrac * 1900 + (boosting ? 500 : 0), t, 0.05);
    this.whineGain.gain.setTargetAtTime(on * (0.025 + speedFrac * 0.045), t, 0.08);
    this.windFilter.frequency.setTargetAtTime(500 + speedFrac * 2600 + (boosting ? 1500 : 0), t, 0.08);
    this.windGain.gain.setTargetAtTime(on * (0.04 + speedFrac * 0.26 + (boosting ? 0.12 : 0)), t, 0.1);
  }

  // ------------------------------------------------------------ one shots
  tone({ type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.3, attack = 0.005, delay = 0, bus = this.sfxBus }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst({ dur = 0.3, f0 = 1000, f1 = f0, q = 1, gain = 0.3, type = 'bandpass', delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  nearMiss(streak = 1, shave = false) {
    const k = Math.min(streak, 20);
    this.burst({ dur: 0.28, f0: 900 + k * 90, f1: 3200 + k * 120, q: 1.2, gain: shave ? 0.4 : 0.28 });
    this.tone({ type: 'triangle', f0: 520 + k * 30, f1: 880 + k * 40, dur: 0.12, gain: 0.12 });
  }

  pad() {
    this.tone({ type: 'sine', f0: 660, f1: 660, dur: 0.14, gain: 0.22 });
    this.tone({ type: 'sine', f0: 990, f1: 990, dur: 0.26, gain: 0.2, delay: 0.08 });
    this.tone({ type: 'sine', f0: 1320, f1: 1320, dur: 0.34, gain: 0.14, delay: 0.17 });
  }

  hop() {
    this.burst({ dur: 0.5, f0: 3800, f1: 500, q: 0.8, gain: 0.45, type: 'highpass' });
    this.tone({ type: 'sawtooth', f0: 140, f1: 520, dur: 0.35, gain: 0.12 });
  }

  maneuver() {
    this.burst({ dur: 0.25, f0: 600, f1: 2400, q: 2, gain: 0.18 });
  }

  landClean(points = 0) {
    this.tone({ type: 'sine', f0: 120, f1: 50, dur: 0.18, gain: 0.5 });
    if (points > 0) {
      this.tone({ type: 'triangle', f0: 740, dur: 0.12, gain: 0.14, delay: 0.04 });
      this.tone({ type: 'triangle', f0: 1110, dur: 0.2, gain: 0.14, delay: 0.12 });
    }
  }

  landMessy() {
    this.tone({ type: 'square', f0: 110, f1: 55, dur: 0.22, gain: 0.25 });
    this.burst({ dur: 0.2, f0: 700, f1: 200, gain: 0.3, type: 'lowpass' });
  }

  ceiling(on = true) {
    this.burst({ dur: 0.55, f0: on ? 300 : 2600, f1: on ? 2600 : 300, q: 3, gain: 0.35 });
    this.tone({ type: 'sine', f0: on ? 220 : 880, f1: on ? 880 : 220, dur: 0.5, gain: 0.15 });
  }

  warn() {
    this.tone({ type: 'square', f0: 880, dur: 0.09, gain: 0.1 });
    this.tone({ type: 'square', f0: 880, dur: 0.09, gain: 0.1, delay: 0.14 });
  }

  zone() {
    this.tone({ type: 'sine', f0: 392, dur: 0.14, gain: 0.14 });
    this.tone({ type: 'sine', f0: 523, dur: 0.14, gain: 0.14, delay: 0.12 });
    this.tone({ type: 'sine', f0: 784, dur: 0.3, gain: 0.14, delay: 0.24 });
  }

  crash() {
    this.burst({ dur: 0.9, f0: 2600, f1: 90, q: 0.7, gain: 0.8, type: 'lowpass' });
    this.tone({ type: 'sine', f0: 90, f1: 30, dur: 0.7, gain: 0.7 });
    this.tone({ type: 'sawtooth', f0: 220, f1: 40, dur: 0.5, gain: 0.2 });
  }

  click() {
    this.tone({ type: 'triangle', f0: 600, f1: 420, dur: 0.07, gain: 0.12 });
  }

  // ------------------------------------------------------------ music
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.schedule(), 40);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.musicTimer);
  }

  setIntensity(v) {
    this.intensity = v;
  }

  schedule() {
    if (!this.ctx || !this.musicOn) return;
    const bpm = 108 + this.intensity * 22;
    const stepTime = 60 / bpm / 4;
    while (this.nextNoteTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += stepTime;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, time) {
    const ctx = this.ctx;
    const bar = Math.floor(step / 16) % 4;
    const roots = [45, 41, 43, 40]; // A, F, G, E (MIDI) minor-ish progression
    const root = roots[bar];
    const m2f = (m) => 440 * 2 ** ((m - 69) / 12);

    const voice = (type, freq, dur, gain, bus = this.musicBus, detune = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g).connect(bus);
      o.start(time);
      o.stop(time + dur + 0.05);
    };

    // bass on 8ths
    if (step % 2 === 0) voice('sawtooth', m2f(root), 0.2, 0.18);
    // arpeggio
    const arp = [0, 7, 12, 15, 12, 7, 3, 7];
    if (step % 2 === 1 || this.intensity > 0.5) voice('square', m2f(root + 24 + arp[step % 8]), 0.12, 0.05, this.musicBus, 6);
    // kick on beats
    if (step % 4 === 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(130, time);
      o.frequency.exponentialRampToValueAtTime(40, time + 0.12);
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      o.connect(g).connect(this.musicBus);
      o.start(time);
      o.stop(time + 0.2);
    }
    // hat
    if (step % 2 === 1 && this.intensity > 0.2) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(time, Math.random());
      src.stop(time + 0.06);
    }
  }
}
