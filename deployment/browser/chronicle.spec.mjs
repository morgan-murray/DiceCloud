import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const base = (process.env.DICECLOUD_TEST_URL || 'http://127.0.0.1:31080').replace(/\/?$/, '/');
const url = path => new URL(path.replace(/^\//, ''), base).href;
const fixture = process.env.DICECLOUD_TEST_FIXTURE;
async function assertHeaderLayout(page, desktop) {
  const toolbar = page.locator('.character-sheet-toolbar');
  await expect(toolbar.locator('[data-id="character-toolbar-name"]')).toHaveAttribute('title', 'Runtime verified character');
  if (desktop) await expect(toolbar.locator('[data-id="character-navigation"]')).toBeVisible();
  else await expect(toolbar.locator('[data-id="character-navigation"]')).toHaveCount(0);
  const boxes = await toolbar.evaluate(el => {
    const box = selector => {
      const target = el.querySelector(selector);
      if (!target) return { top: 0, bottom: 0, height: 0 };
      const r = target.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    return { content: box('.v-toolbar__content'), title: box('.v-toolbar-title__placeholder'), extension: box('.v-toolbar__extension') };
  });
  expect(boxes.title.top).toBeGreaterThanOrEqual(boxes.content.top);
  expect(boxes.title.bottom).toBeLessThanOrEqual(boxes.content.bottom);
  expect(boxes.content.height).toBe(56);
  if (!desktop) {
    await expect(toolbar.locator('[data-id="character-navigation"]')).toHaveCount(0);
    expect(boxes.extension.height).toBe(0);
    return;
  }
  expect(boxes.extension.top).toBeGreaterThanOrEqual(boxes.content.bottom);
  const nav = toolbar.locator('[data-id="character-navigation"]');
  await expect(nav).toBeVisible();
  const controls = await nav.evaluate(el => {
    const navRect = el.getBoundingClientRect();
    const bounds = [...el.querySelectorAll('.v-tabs, .insert-creature-property-fab')].map(e => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    return { top: navRect.top, bottom: navRect.bottom, background: getComputedStyle(el).backgroundColor, toolbarBackground: getComputedStyle(el.closest('.v-app-bar')).backgroundColor, bounds };
  });
  expect(controls.background).not.toBe(controls.toolbarBackground);
  for (const control of controls.bounds) {
    expect(control.top).toBeGreaterThanOrEqual(controls.top);
    expect(control.bottom).toBeLessThanOrEqual(controls.bottom);
    expect(control.top).toBeGreaterThan(boxes.title.bottom);
  }
}

test('Lance Chronicle: artwork, mobile layout, stored preferences and print', async ({ page }, info) => {
  test.skip(!fixture, 'Requires the native workflow fixture');
  const { owner, creatureId } = JSON.parse(readFileSync(fixture, 'utf8'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url('/sign-in'));
  await page.getByLabel('Username or email').fill(owner.username);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.Meteor?.userId()));
  await page.evaluate(() => window.Meteor.callAsync('users.setDarkMode', { darkMode: false }));
  await page.goto(url(`/character/${creatureId}`));
  const banner = page.locator('[data-id="chronicle-banner"]');
  await expect(banner).toBeVisible();
  await expect(banner.locator('h1')).toHaveText('Runtime verified character');
  const art = banner.locator('img');
  await expect(art).toHaveAttribute('src', new URL('images/themes/lance-chronicle/banner.png', base).pathname);
  await expect.poll(() => art.evaluate(img => img.complete && img.naturalWidth > 1000)).toBe(true);
  await expect(page.locator('.lance-ability-strip .ability-list-tile').first()).toBeVisible();
  await expect(page.locator('.lance-chronicle')).toHaveClass(/v-theme--light/);
  await assertHeaderLayout(page, true);
  await page.getByRole('tab', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Actions', exact: true })).toHaveAttribute('aria-selected', 'true');
  await assertHeaderLayout(page, true);
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.lance-ability-strip .ability-list-tile').first()).toBeVisible();
  const add = page.locator('.character-sheet-toolbar [data-id="insert-creature-property-fab"]');
  await add.click();
  await expect(page.locator('.character-sheet-toolbar [data-id="insert-creature-property-type-attribute"]')).toBeVisible();
  await assertHeaderLayout(page, true);
  const expanded = await page.locator('.character-sheet-toolbar [data-id="insert-creature-property-type-attribute"]').boundingBox();
  const navigation = await page.locator('[data-id="character-navigation"]').boundingBox();
  expect(expanded.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
  await add.click();
  await page.waitForFunction(() => !document.querySelector('[class*="fade-transition-enter"],[class*="fade-transition-leave"]'));
  await page.screenshot({ path: info.outputPath('chronicle-desktop-light.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => window.Meteor.callAsync('users.setDarkMode', { darkMode: true }));
  await page.reload();
  await expect(page.locator('.lance-chronicle')).toHaveClass(/v-theme--dark/);
  await expect(banner.locator('h1')).toHaveText('Runtime verified character');
  await expect(page.locator('.lance-ability-strip .ability-list-tile').first()).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[class*="fade-transition-enter"],[class*="fade-transition-leave"]'));
  await page.screenshot({ path: info.outputPath('chronicle-desktop-dark.png'), fullPage: true, animations: 'disabled' });
  await assertHeaderLayout(page, true);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await assertHeaderLayout(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertHeaderLayout(page, false);
  await expect(banner).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.lance-ability-strip .ability-name-short').first()).toBeVisible();
  const tiles = page.locator('.lance-ability-strip');
  await expect(tiles).toBeVisible();
  expect(await tiles.evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.waitForFunction(() => !document.querySelector('[class*="fade-transition-enter"],[class*="fade-transition-leave"]'));
  await page.screenshot({ path: info.outputPath('chronicle-mobile-dark.png'), fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ media: 'print' });
  await expect(banner).not.toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.Meteor.callAsync('users.setDarkMode', { darkMode: false }));
  expect(errors).toEqual([]);
});
