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
  const dialog = page.locator('.dialog-stack .dialog').last();
  const closeButton = dialog.getByRole('button', { name: 'Close', exact: true });
  if (await closeButton.count()) await closeButton.click();
  else await dialog.locator('.base-dialog-toolbar button').first().click();
  await expect.poll(() => stack(page)).toEqual([]);
  await expect(page.locator('.dialog-stack .dialog')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.Meteor?.userId()));
  await page.getByRole('button', { name: 'Archive characters', exact: true }).first().waitFor();
  const id = await call(page, 'creatures.insertCreature', { name: 'Tab interaction fixture', startingLevel: 1, allowedLibraries: [], allowedLibraryCollections: [] });
  try {
    // Use the same SPA navigation as the character list; a forced reload can emit
    // Firefox's interrupted-WebSocket console diagnostic while tearing down DDP.
    await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'characterSheet', params: { id } }), id);
    await expect(page).toHaveURL(new RegExp(`/character/${id}(?:/|$)`));
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
    await creator.getByRole('button', { name: 'Create', exact: true }).click();
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
    // Two real log notifications exercise the queue advancing to an already waiting entry.
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setRightDrawer', true));
    const recovery = await insert('attribute', 'First recovery', { variableName: 'practiceRecovery', attributeType: 'healthBar', baseValue: { calculation: '10' }, damage: 1, reset: 'longRest' });
    await page.waitForFunction(id => window.Mongo.getCollection('creatureProperties').findOne(id)?.value === 9, recovery);
    const rest = async (eventName) => {
      const actionId = await call(page, 'actions.insertAction', { action: { creatureId: id, task: { subtaskFn: 'reset', eventName, targetIds: [id] } } });
      await call(page, 'actions.runAction', { actionId });
    };
    await rest('longRest');
    const toast = page.locator('.v-snackbar');
    await expect(toast).toContainText('First recovery');
    // Use distinct event titles so this queue check does not depend on property recomputation.
    await rest('shortRest');
    await toast.locator('.v-snackbar__actions button').click();
    await expect(toast).toContainText('Short Rest');
    await expect(toast).toBeVisible();
    await toast.locator('.v-snackbar__actions button').click();
    await expect(toast).not.toBeVisible();
    await page.waitForTimeout(700);
    await expect(toast).not.toBeVisible();
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setRightDrawer', false));
    for (const [tab, target, text] of [
      ['Actions', `.actions-tab [data-id="${action}"] .action-title`, 'Practice salute'],
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

test('Character tabs: New Character steps, responsive layout and creation choices', async ({ page }, info) => {
  test.skip(!fixture, 'Requires the native workflow account');
  test.setTimeout(120_000);
  const { owner } = JSON.parse(readFileSync(fixture, 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url('sign-in'));
  await page.getByLabel('Username or email').fill(owner.username);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.Meteor?.userId()));
  await page.getByRole('button', { name: 'Archive characters', exact: true }).first().waitFor();
  const name = `Creation dialog fixture ${Date.now()}`;
  const libraryId = await call(page, 'libraries.insert', { name: 'Creation dialog library', description: 'Synthetic UI fixture', public: false, readers: [], writers: [], readersCanCopy: false });
  let id;
  try {
    const dialog = await open(page, page.locator('[data-id="new-character-button"]'), 'character-creation-dialog');
    const bio = dialog.getByRole('tab', { name: 'Biography', exact: true });
    const libraries = dialog.getByRole('tab', { name: 'Libraries', exact: true });
    const fit = async () => {
      const box = await dialog.boundingBox(), viewport = page.viewportSize();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await dialog.locator('.creation-toolbar').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(65);
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeInViewport();
    };
    await expect(bio).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('All user libraries')).not.toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill('');
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
    await expect(dialog.getByText('Name required', { exact: true })).toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Alignment', { exact: true }).fill('Neutral good');
    await dialog.getByLabel('Gender', { exact: true }).fill('Unspecified');
    await dialog.getByLabel('Level', { exact: true }).fill('4');
    await dialog.getByLabel('Level', { exact: true }).press('Tab');
    await expect(bio).toHaveAttribute('aria-selected', 'true');
    await call(page, 'users.setDarkMode', { darkMode: false });
    await fit();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('new-character-desktop-light.png') });
    await call(page, 'users.setDarkMode', { darkMode: true });
    await page.screenshot({ animations: 'disabled', path: info.outputPath('new-character-desktop-dark.png') });
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(libraries).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByLabel('Name', { exact: true })).not.toBeVisible();
    await expect(dialog.getByLabel('All user libraries')).toBeChecked();
    await dialog.getByLabel('All user libraries').uncheck();
    const library = dialog.locator('.creation-library-list .v-list-item').filter({ hasText: 'Creation dialog library' });
    await library.getByRole('checkbox').check();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('new-character-libraries-desktop-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    // The theme keeps a small edge gutter; check the settled dialog against its viewport.
    await expect.poll(async () => { const box = await dialog.boundingBox(); return box.width; }).toBeGreaterThan(370);
    await fit();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('new-character-libraries-mobile-dark.png') });
    await call(page, 'users.setDarkMode', { darkMode: false });
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(name);
    await fit();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('new-character-mobile-light.png') });
    await libraries.click();
    await expect(library.getByRole('checkbox')).toBeChecked();
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.poll(() => stack(page)).toEqual([]);
    await page.waitForFunction(name => window.Mongo.getCollection('creatures').findOne({ name }), name);
    const creature = await page.evaluate(name => window.Mongo.getCollection('creatures').findOne({ name }), name);
    id = creature._id;
    expect(creature.gender).toBe('Unspecified');
    expect(creature.alignment).toBe('Neutral good');
    await expect(page).toHaveURL(new RegExp(`/character/${id}(?:/|$)`));
    // characterList publishes biography only; wait for singleCharacter's library settings.
    await expect.poll(() => page.evaluate(id => window.Mongo.getCollection('creatures').findOne(id)?.allowedLibraries, id), { timeout: 15000 }).toEqual([libraryId]);
    await page.waitForTimeout(700);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(async () => { const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store; while (store.state.dialogStack.dialogs.length) store.commit('popDialogStackMutation'); }).catch(() => {});
    if (!id) id = await page.evaluate(name => window.Mongo.getCollection('creatures').findOne({ name })?._id, name).catch(() => undefined);
    if (id) await call(page, 'Creatures.methods.removeCreature', { charId: id });
    await call(page, 'libraries.remove', { _id: libraryId });
  }
});

test('Character tabs: Settings and shared responsive layout controls', async ({ page }, info) => {
  test.skip(!fixture, 'Requires the native workflow account');
  test.setTimeout(90000);
  const { owner, creatureId } = JSON.parse(readFileSync(fixture, 'utf8'));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url('sign-in'));
  await page.getByLabel('Username or email').fill(owner.username);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.Meteor?.userId()));
  const navigate = path => page.evaluate(path => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path), path);
  await navigate('/account');
  await expect(page.getByRole('heading', { name: 'Account & settings', exact: true })).toBeVisible();
  const togglesFit = () => page.locator('.smart-toggle-options').evaluateAll(elements => elements.every(el => {
    const p = el.getBoundingClientRect();
    return el.scrollHeight <= el.clientHeight + 2 && [...el.querySelectorAll('.v-btn')].every(button => { const b = button.getBoundingClientRect(); return b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1 && b.bottom <= p.bottom + 1; });
  }));
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--light/);
  await page.screenshot({ path: info.outputPath('settings-desktop-light.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(togglesFit).toBe(true);
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('settings-phone-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--dark/);
  await expect.poll(togglesFit).toBe(true);
  await page.getByRole('button', { name: 'Add email address', exact: true }).click();
  await expect(page.getByLabel('Add email address', { exact: true })).toBeVisible();
  await page.locator('.email-input-row').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Add email address', { exact: true })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('settings-phone-dark.png'), fullPage: true, animations: 'disabled' });
  await navigate(`/character/${creatureId}`);
  await page.locator('.bottom-nav-btns').waitFor();
  await expect.poll(() => page.locator('.bottom-nav-btns .v-btn').evaluateAll(buttons => buttons.every(el => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }))).toBe(true);
  const fab = page.locator('.character-sheet-bottom-fab');
  await expect.poll(() => fab.evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.bottom-nav-btns').getBoundingClientRect().top)).toBe(true);
  await fab.locator('[data-id="insert-creature-property-fab"]').click();
  await expect(fab.locator('.character-add-menu')).toBeVisible();
  await page.screenshot({ path: info.outputPath('character-phone-navigation.png'), animations: 'disabled' });
  await fab.locator('[data-id="insert-creature-property-fab"]').click();
  await navigate('/docs/functions');
  await page.locator('.function-examples').first().waitFor();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await navigate('/feedback');
  await expect(page.getByText('DiceCloud Discord server', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.feedback-card .v-card-title')).toHaveText('DiceCloud Discord server');
  await page.screenshot({ path: info.outputPath('feedback-phone.png'), animations: 'disabled' });
  await navigate('/character-list');
  await expect(page.getByRole('button', { name: 'Import Aurora character', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New character', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add folder', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('character-list-phone.png'), animations: 'disabled' });
  await navigate('/account');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  expect(errors).toEqual([]);
});
