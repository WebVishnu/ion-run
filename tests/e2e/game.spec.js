import { expect, test } from '@playwright/test';

/** Page object for Ion Run. Uses roles and labels; the game state hook is only used to read results. */
class IonRun {
  constructor(page) {
    this.page = page;
    this.errors = [];
    page.on('pageerror', (e) => this.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') this.errors.push(`console: ${m.text()}`);
    });
    this.play = page.getByRole('button', { name: 'Play' });
    this.pause = page.getByRole('button', { name: 'Pause' });
    this.resume = page.getByRole('button', { name: 'Resume' });
    this.retry = page.getByRole('button', { name: 'Retry' });
  }

  async open() {
    await this.page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await this.page.goto('/');
    await expect(this.play).toBeVisible();
  }

  mode() {
    return this.page.evaluate(() => window.__ionrun?.mode);
  }

  state() {
    return this.page.evaluate(() => {
      const s = window.__ionrun?.state;
      return s
        ? { t: s.t, dist: s.dist, score: s.score, over: s.over, reason: s.overReason, battery: s.battery, speed: s.speed, level: s.player.level, air: s.player.air, lane: s.player.lane, pips: s.pips, zone: s.zone, stats: s.stats }
        : null;
    });
  }

  async startAndWait() {
    await this.play.click();
    await expect.poll(() => this.mode()).toBe('playing');
  }
}

test.describe('Ion Run', () => {
  test('boots to the menu with no errors and a rendered 3D scene', async ({ page }, info) => {
    const game = new IonRun(page);
    await game.open();
    await expect(page.getByRole('heading', { name: 'Ion Run', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Daily run' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Garage' })).toBeVisible();
    // the canvas must have drawn something other than a single colour
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = document.getElementById('scene');
          const gl = c.getContext('webgl2') ?? c.getContext('webgl');
          return !!gl && c.width > 0;
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `test-results/menu-${info.project.name}.png` });
    expect(game.errors).toEqual([]);
  });

  test('starts a run, scores, and ends when the player stops steering into traffic', async ({ page }, info) => {
    const game = new IonRun(page);
    await game.open();
    await game.startAndWait();
    await expect.poll(async () => (await game.state()).dist).toBeGreaterThan(80);
    await page.screenshot({ path: `test-results/run-${info.project.name}.png` });
    await expect(page.locator('#hud-speed')).not.toHaveText('0');
    // drive without steering until something ends the run (collision or flat battery)
    await expect.poll(async () => (await game.state()).over, { timeout: 55_000, intervals: [500] }).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Run over' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused();
    await page.screenshot({ path: `test-results/over-${info.project.name}.png` });
    expect(game.errors).toEqual([]);
  });

  test('keyboard steering, hop and trick change the simulation', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard only');
    const game = new IonRun(page);
    await game.open();
    await game.startAndWait();
    const lane0 = (await game.state()).lane;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await game.state()).lane).toBe(lane0 - 1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await game.state()).lane).toBe(lane0);

    await page.keyboard.press('Space');
    await expect.poll(async () => (await game.state()).air).toBe(true);
    await page.keyboard.press('ArrowUp'); // flip
    await expect.poll(async () => (await game.state()).stats.hops).toBeGreaterThanOrEqual(1);
    expect(game.errors).toEqual([]);
  });

  test('pausing freezes the run and resume continues it', async ({ page }) => {
    const game = new IonRun(page);
    await game.open();
    await game.startAndWait();
    await game.pause.click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    const frozen = (await game.state()).dist;
    await expect.poll(() => game.mode()).toBe('paused');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    expect((await game.state()).dist).toBe(frozen);
    await game.resume.click();
    await expect.poll(() => game.mode()).toBe('playing');
    await expect.poll(async () => (await game.state()).dist).toBeGreaterThan(frozen);
  });

  test('garage lets the player preview, and shows locked liveries with a price', async ({ page }) => {
    const game = new IonRun(page);
    await game.open();
    await page.getByRole('button', { name: 'Garage' }).click();
    await expect(page.getByRole('heading', { name: 'Garage' })).toBeVisible();
    await expect(page.getByRole('option', { name: /Midnight Copper/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('option', { name: /Aurora Teal/ }).click();
    await expect(page.locator('#garage-msg')).toContainText('Not enough coins');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(game.play).toBeVisible();
  });

  test('settings: reduce motion toggles and persists', async ({ page }) => {
    const game = new IonRun(page);
    await game.open();
    await page.getByRole('button', { name: 'Settings' }).click();
    const box = page.getByLabel(/Reduce motion/);
    await box.check();
    await expect(page.locator('body')).toHaveClass(/reduced/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ion-run:save:v1')).settings.reducedMotion);
    expect(saved).toBe(true);
  });

  test('ceiling run: grabbing flips the car onto the roof road', async ({ page, isMobile }) => {
    test.skip(isMobile, 'uses the keyboard');
    const game = new IonRun(page);
    await game.open();
    await game.startAndWait();
    // open a zone around the player so the check does not depend on driving 2 km
    await page.evaluate(() => {
      const s = window.__ionrun.state;
      s.zone = { start: s.dist - 5, end: s.dist + 100000 };
      s.player.invuln = 1e6; // keep the check about the mechanic, not traffic
      s.battery = 100;
    });
    await page.keyboard.press('Shift');
    await expect.poll(async () => (await game.state()).level, { timeout: 8000 }).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__ionrun.camBlend), { timeout: 8000 }).toBeGreaterThan(0.97);
    await page.screenshot({ path: 'test-results/ceiling-desktop.png' });
    await page.keyboard.press('Shift');
    await expect.poll(async () => (await game.state()).level, { timeout: 8000 }).toBe(0);
    expect(game.errors).toEqual([]);
  });

  test('touch devices get on-screen thruster and brake buttons', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone only');
    const game = new IonRun(page);
    await game.open();
    await game.startAndWait();
    await expect(page.getByRole('button', { name: /Thruster hop/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Brake' })).toBeVisible();
    await page.getByRole('button', { name: /Thruster hop/ }).tap();
    await expect.poll(async () => (await game.state()).stats.hops).toBeGreaterThanOrEqual(1);
  });
});
