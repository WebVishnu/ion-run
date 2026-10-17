export const DEFAULT_BINDINGS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  hop: ['Space'],
  grab: ['ShiftLeft', 'ShiftRight', 'KeyE'],
  pause: ['KeyP'],
};

export const ACTION_LABELS = {
  left: 'Steer / roll left',
  right: 'Steer / roll right',
  up: 'Flip forward (in air)',
  down: 'Brake / flip back',
  hop: 'Thruster hop',
  grab: 'Grab ceiling',
  pause: 'Pause',
};

const SWIPE_PX = 28;
const TAP_PX = 14;
const TAP_MS = 320;
const GRAB_HOLD_MS = 260;

/**
 * Unified input: keyboard (remappable via KeyboardEvent.code), touch (swipe / tap zones / buttons),
 * gamepad and optional tilt. Everything funnels into `onAction(name)` plus a `held` state for braking.
 */
export class Input {
  constructor(target) {
    this.target = target;
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.onAction = () => {};
    this.enabled = false;
    this.held = { brake: false };
    this.keysDown = new Set();
    this.gesture = null;
    this.gamepadPrev = {};
    this.tiltOn = false;
    this.tiltCooldown = 0;
    this.rebinding = null;
    this.usedTouch = false;
    this.bind();
  }

  setBindings(b) {
    this.bindings = { ...structuredClone(DEFAULT_BINDINGS), ...b };
  }

  /** Wait for the next key press and bind it to `action`. Resolves with the code. */
  rebind(action) {
    return new Promise((resolve) => {
      this.rebinding = { action, resolve };
    });
  }

  codeToAction(code) {
    for (const [action, codes] of Object.entries(this.bindings)) if (codes.includes(code)) return action;
    return null;
  }

  trigger(name) {
    if (this.enabled || name === 'pause') this.onAction(name);
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (this.rebinding) {
        e.preventDefault();
        e.stopImmediatePropagation(); // Escape while rebinding must only cancel the rebind, not leave the screen
        if (e.code !== 'Escape') {
          const { action, resolve } = this.rebinding;
          for (const k of Object.keys(this.bindings)) this.bindings[k] = this.bindings[k].filter((c) => c !== e.code);
          this.bindings[action] = [e.code];
          resolve(e.code);
        } else this.rebinding.resolve(null);
        this.rebinding = null;
        return;
      }
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const action = this.codeToAction(e.code);
      if (!action) return;
      if (action !== 'pause' && !this.enabled) return;
      if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keysDown.add(e.code);
      if (action === 'down') this.held.brake = true;
      this.onAction(action);
    });
    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
      if (this.codeToAction(e.code) === 'down') {
        const stillDown = this.bindings.down.some((c) => this.keysDown.has(c));
        this.held.brake = stillDown;
      }
    });
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.held.brake = false;
    });

    const t = this.target;
    t.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest?.('[data-ui]')) return;
      if (e.pointerType !== 'mouse') this.usedTouch = true;
      this.gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
    });
    t.addEventListener('pointermove', (e) => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId || !this.enabled) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) >= Math.abs(dy)) {
        g.moved = true;
        this.onAction(dx < 0 ? 'left' : 'right');
        g.x0 = e.clientX;
        g.y0 = e.clientY;
      } else if (Math.abs(dy) > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
        g.moved = true;
        this.onAction(dy < 0 ? 'up' : 'down');
        g.x0 = e.clientX;
        g.y0 = e.clientY;
      }
    });
    const end = (e) => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.gesture = null;
      if (!this.enabled || e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
      if (!g.moved && moved < TAP_PX && performance.now() - g.t0 < TAP_MS) {
        this.onAction(e.clientX < window.innerWidth / 2 ? 'left' : 'right');
      }
    };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
  }

  /** Hold-style on-screen button: tap = hop, hold = grab the ceiling. */
  bindThrusterButton(el) {
    let timer = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      this.trigger('hop');
      timer = setTimeout(() => this.trigger('grab'), GRAB_HOLD_MS);
    });
    const up = () => clearTimeout(timer);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  bindBrakeButton(el) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      this.held.brake = true;
    });
    const up = () => {
      if (!this.bindings.down.some((c) => this.keysDown.has(c))) this.held.brake = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  // ------------------------------------------------------------ gamepad
  pollGamepad() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return;
    const edge = (key, down, action) => {
      const was = this.gamepadPrev[key];
      this.gamepadPrev[key] = down;
      if (down && !was) this.trigger(action);
    };
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    edge('l', ax < -0.55 || gp.buttons[14]?.pressed, 'left');
    edge('r', ax > 0.55 || gp.buttons[15]?.pressed, 'right');
    edge('u', ay < -0.55 || gp.buttons[12]?.pressed, 'up');
    edge('d', ay > 0.55 || gp.buttons[13]?.pressed, 'down');
    edge('a', gp.buttons[0]?.pressed, 'hop');
    edge('b', gp.buttons[1]?.pressed || gp.buttons[5]?.pressed, 'grab');
    edge('s', gp.buttons[9]?.pressed, 'pause');
    const brake = gp.buttons[6]?.pressed || gp.buttons[7]?.value > 0.4 || ay > 0.7;
    if (brake) this.held.brake = true;
    else if (this.gamepadPrev.brake) this.held.brake = this.bindings.down.some((c) => this.keysDown.has(c));
    this.gamepadPrev.brake = brake;
  }

  // ------------------------------------------------------------ tilt
  async enableTilt() {
    if (this.tiltOn) return true;
    try {
      const DOE = window.DeviceOrientationEvent;
      if (!DOE) return false;
      if (typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', (e) => this.onTilt(e));
      this.tiltOn = true;
      return true;
    } catch {
      return false;
    }
  }

  onTilt(e) {
    if (!this.enabled || !this.tiltActive) return;
    const now = performance.now();
    if (now < this.tiltCooldown) return;
    const g = e.gamma ?? 0; // left/right tilt in degrees (portrait)
    if (g < -16) {
      this.onAction('left');
      this.tiltCooldown = now + 320;
    } else if (g > 16) {
      this.onAction('right');
      this.tiltCooldown = now + 320;
    }
  }

  setTiltActive(on) {
    this.tiltActive = !!on;
  }
}
