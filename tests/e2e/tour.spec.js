import { expect, test } from '@playwright/test';

test.describe('Visual tour', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('menu sub screens fit the viewport and have no horizontal scroll', async ({ page }, info) => {
    const name = info.project.name;
    for (const [button, heading, file] of [
      ['Garage', 'Garage', 'garage'],
      ['Goals', 'Goals', 'goals'],
      ['Settings', 'Settings', 'settings'],
    ]) {
      await page.getByRole('button', { name: button }).click();
      await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
      await page.screenshot({ path: `test-results/tour-${file}-${name}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    }
  });

  test('mid-air trick and the ceiling run on screen', async ({ page, isMobile }, info) => {
    const name = info.project.name;
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => page.evaluate(() => window.__ionrun?.mode)).toBe('playing');
    // keep the tour about visuals: no crashes, plenty of battery, tutorial already seen
    await page.evaluate(() => {
      const s = window.__ionrun.state;
      s.player.invuln = 1e6;
      s.battery = 100;
      s.pips = 3;
    });
    await page.evaluate(() => {
      window.__ionrun.action('hop');
      window.__ionrun.action('right');
    });
    await expect.poll(() => page.evaluate(() => window.__ionrun.state.player.maneuvers.length)).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/tour-air-${name}.png` });

    await expect.poll(() => page.evaluate(() => window.__ionrun.state.player.air), { timeout: 10_000 }).toBe(false);
    await page.evaluate(() => {
      const s = window.__ionrun.state;
      s.zone = { start: s.dist - 5, end: s.dist + 100000 };
      s.pips = 3;
      window.__ionrun.action('grab');
    });
    await expect.poll(() => page.evaluate(() => window.__ionrun.state.player.level), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__ionrun.camBlend), { timeout: 10_000 }).toBeGreaterThan(0.97);
    await page.screenshot({ path: `test-results/tour-ceiling-${name}.png` });
    expect(isMobile === true || isMobile === false).toBe(true);
  });
});
