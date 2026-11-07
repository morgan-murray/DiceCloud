import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const base = (process.env.DICECLOUD_TEST_URL || 'http://127.0.0.1:31080').replace(/\/?$/, '/');
const url = path => new URL(path.replace(/^\//, ''), base).href;
const fixture = process.env.DICECLOUD_TEST_FIXTURE;
const stack = page => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.dialogStack.dialogs.map(d => d.component));
async function call(page, name, argument) {
  return page.evaluate(({ name, argument }) => window.Meteor.callAsync(name, argument), { name, argument });
}
async function close(page) {
  await page.locator('.dialog-stack .dialog').last().locator('.base-dialog-toolbar button').first().click();
  await expect.poll(() => stack(page)).toEqual([]);
  await expect(page.locator('.dialog-stack')).not.toBeVisible();
}
async function open(page, target, component = 'creature-property-dialog') {
  await target.click();
  await expect.poll(() => stack(page)).toEqual([component]);
  return page.locator('.dialog-stack .dialog').last();
}

test('Character tabs: populated entries, single dialogs, journal, Build choices and Add', async ({ page }, info) => {
  test.skip(!fixture, 'Requires the native workflow account');
  test.setTimeout(150_000);
  const { owner } = JSON.parse(readFileSync(fixture, 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url('sign-in'));
  await page.getByLabel('Username or email').fill(owner.username);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.Meteor?.userId()));
  await page.getByRole('button', { name: 'Archive characters', exact: true }).first().waitFor();
  const id = await call(page, 'creatures.insertCreature', { name: 'Tab interaction fixture', startingLevel: 1, allowedLibraries: [], allowedLibraryCollections: [] });
  try {
    await page.goto(url(`character/${id}`));
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
    await expect(page.getByText('No actions yet', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Build', exact: true }).click();
    await expect(page.getByText('No class progression added to this character.')).toBeVisible();
    const add = page.locator('.character-sheet-toolbar [data-id="insert-creature-property-fab"]');
    await expect(add).toBeVisible();
    await add.click();
    await open(page, page.locator('[data-id="insert-creature-property-type-null"]'), 'insert-property-dialog');
    await expect(page.locator('.dialog-stack')).toContainText('Property');
    await close(page);
    await expect(add).toBeVisible();
    await add.click();
    const creator = await open(page, page.locator('[data-id="insert-creature-property-type-null"]'), 'insert-property-dialog');
    await creator.locator('.v-card').filter({ has: page.locator('.v-card-title').filter({ hasText: /^\s*Note\s*$/ }) }).first().click();
    await creator.getByLabel('Name', { exact: true }).fill('Note created through Build');
    await creator.getByRole('button', { name: 'create', exact: true }).click();
    await expect.poll(() => stack(page)).toEqual([]);
    await page.waitForFunction(id => Boolean(window.Mongo.getCollection('creatureProperties').findOne({ 'root.id': id, name: 'Note created through Build' })), id);
    await expect(add).toBeVisible();
    // Space inserts to respect the production method rate limit as well as CI.
    const insert = async (type, name, fields = {}, parentId) => {
      await page.waitForTimeout(1100);
      return call(page, 'creatureProperties.insert', { creatureProperty: { type, name, ...fields, parentId, root: { collection: 'creatures', id } } });
    };
    const action = await insert('action', 'Practice salute', { actionType: 'action', summary: { text: 'Raise a hand in greeting.' } });
    const list = await insert('spellList', 'Practice spells');
    const spell = await insert('spell', 'Practice light', { level: 0, prepared: true, description: { text: 'A small light illuminates this synthetic example.' } }, list);
    const item = await insert('item', 'Practice lantern', { quantity: 1, weight: 2, description: { text: 'A lantern for interface testing.' } });
    const featureName = 'An unusually long feature name that must remain readable on the character sheet';
    const feature = await insert('feature', featureName, { summary: { text: 'Open this feature to read the full description.' }, description: { text: 'The complete feature description is visible and usable.' } });
    const note = await insert('note', 'Practice journal', { description: { text: 'The journal entry opens correctly.' } });
    await insert('class', 'Practice class', { variableName: 'practiceClass' });
    const slot = await insert('propertySlot', 'Practice build choice', { slotType: 'feature', quantityExpected: { calculation: '1' }, description: { text: 'Choose a practice feature.' } });
    for (const [tab, target, text] of [
      ['Actions', `.actions-tab [data-id="${action}"]`, 'Practice salute'],
      ['Spells', '.character-sheet .v-window-item--active .spell', 'Practice light'],
      ['Inventory', `.item[data-id="${item}"]`, 'Practice lantern'],
      ['Features', `.features [data-id="${feature}"]`, 'complete feature description'],
      ['Journal', `.journal-tab [data-id="${note}"]`, 'journal entry opens correctly'],
    ]) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.locator(target)).toBeVisible();
      const body = page.locator('.character-sheet .v-window-item--active');
      await expect(body).not.toContainText('$vuetify.icons.');
      if (tab === 'Features') {
        const title = page.locator(target).locator('.v-toolbar-title__placeholder');
        expect(await title.evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      await page.screenshot({ path: info.outputPath(`tabs-${tab.toLowerCase()}.png`), animations: 'disabled' });
      const dialog = await open(page, page.locator(target));
      await expect(dialog).toContainText(text);
      await close(page);
    }
    await page.getByRole('tab', { name: 'Build', exact: true }).click();
    await expect(page.locator('.class-details')).toContainText('Practice class');
    await expect(add).toBeVisible();
    await open(page, page.locator(`[data-id="slot-card-${slot}"]`), 'slot-fill-dialog');
    await close(page);
    await page.screenshot({ path: info.outputPath('tabs-build.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(async () => { const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store; while (store.state.dialogStack.dialogs.length) store.commit('popDialogStackMutation'); }).catch(() => {});
    await call(page, 'Creatures.methods.removeCreature', { charId: id });
  }
});
