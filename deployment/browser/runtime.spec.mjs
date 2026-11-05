import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const baseURL = process.env.DICECLOUD_TEST_URL || 'http://127.0.0.1:31080';
const fixturePath = process.env.DICECLOUD_TEST_FIXTURE;
const imageFixture = readFileSync(new URL('./fixtures/runtime.png', import.meta.url));

async function propertyHasValue(page, id, value) {
  await page.waitForFunction(({ id, value }) => window.Mongo.getCollection('creatureProperties')?.findOne(id)?.value === value, { id, value });
}

async function ready(page, path = '/') {
  await page.goto(new URL(path, baseURL).href);
  await page.waitForFunction(() => window.Meteor?.status().connected);
}

async function call(page, name, argument) {
  return page.evaluate(async ({ name, argument }) => {
    return await window.Meteor.callAsync(name, argument);
  }, { name, argument });
}

async function login(page, user) {
  await ready(page, '/sign-in');
  await page.getByLabel('Username or email').fill(user.username);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.Meteor.userId()));
}

async function register(page, username, password) {
  await ready(page);
  await page.evaluate(({ username, password }) => new Promise((resolve, reject) => {
    window.Accounts.createUser({ username, password }, error => error ? reject(error) : resolve());
  }), { username, password });
  await page.waitForFunction(() => Boolean(window.Meteor.userId()));
}

test('root mode: accounts, character CRUD, libraries, reconnect and access boundaries', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = { username: `runtime-owner-${Date.now()}`, password: randomBytes(24).toString('hex') };
  const other = { username: `runtime-other-${Date.now()}`, password: randomBytes(24).toString('hex') };
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser runtime error:', error.message); });
  await register(page, owner.username, owner.password);
  const creatureId = await call(page, 'creatures.insertCreature', {
    name: 'Runtime smoke character', gender: '', alignment: '', startingLevel: 1,
    allowedLibraries: [], allowedLibraryCollections: [],
  });
  expect(creatureId).toBeTruthy();
  await call(page, 'creatures.update', { _id: creatureId, path: ['name'], value: 'Runtime verified character' });
  await ready(page, `/character/${creatureId}`);
  await expect(page.getByText('Runtime verified character', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Runtime verified character', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.Meteor.disconnect());
  await page.waitForFunction(() => !window.Meteor.status().connected);
  await page.evaluate(() => window.Meteor.reconnect());
  await page.waitForFunction(() => window.Meteor.status().connected);
  const libraryId = await call(page, 'libraries.insert', {
    name: 'Runtime smoke library', description: 'Synthetic runtime fixture',
    public: false, readers: [], writers: [], readersCanCopy: false,
  });
  await ready(page, `/library/${libraryId}`);
  await expect(page.getByText('Runtime smoke library', { exact: true }).first()).toBeVisible();
  const libraryNodeId = await call(page, 'libraryNodes.insert', { libraryNode: {
    type: 'attribute', name: 'Runtime Strength', variableName: 'strength', attributeType: 'ability',
    baseValue: { calculation: '14' }, root: { collection: 'libraries', id: libraryId }, left: 1, right: 2,
  } });
  const [abilityId] = await call(page, 'creatureProperties.insertPropertyFromLibraryNode', {
    nodeIds: [libraryNodeId], root: { collection: 'creatures', id: creatureId },
  });
  await ready(page, `/character/${creatureId}`);
  await propertyHasValue(page, abilityId, 14);
  const slotId = await call(page, 'creatureProperties.insert', { creatureProperty: {
    type: 'attribute', name: 'Runtime spell slots', variableName: 'runtimeSlots', attributeType: 'spellSlot',
    baseValue: { calculation: '2' }, spellSlotLevel: { calculation: '1' }, damage: 1, reset: 'longRest',
    root: { collection: 'creatures', id: creatureId },
  } });
  await propertyHasValue(page, slotId, 1);
  await call(page, 'creatureProperties.insert', { creatureProperty: {
    type: 'item', name: 'Runtime training focus', quantity: 1, weight: 2,
    root: { collection: 'creatures', id: creatureId },
  } });
  await call(page, 'creatureProperties.insert', { creatureProperty: {
    type: 'spell', name: 'Runtime glow', level: 1, target: 'self', actionType: 'action',
    summary: { text: 'A synthetic spell fixture' }, root: { collection: 'creatures', id: creatureId },
  } });
  const actionId = await call(page, 'actions.insertAction', { action: {
    creatureId, task: { subtaskFn: 'reset', eventName: 'longRest', targetIds: [creatureId] },
  } });
  await call(page, 'actions.runAction', { actionId });
  await propertyHasValue(page, slotId, 2);
  const asset = await page.request.get(new URL('/crown-dice-logo-cropped-transparent.png', baseURL).href);
  expect(asset.ok()).toBeTruthy();
  expect(asset.headers()['content-type']).toContain('image');
  await ready(page, '/my-files');
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'runtime-fixture.png', mimeType: 'image/png', buffer: imageFixture });
  const imageCard = page.locator('.user-image-card').filter({ hasText: 'runtime-fixture.png' });
  await expect(imageCard).toBeVisible({ timeout: 30000 });
  const imageHref = await imageCard.locator('a[href*="download"]').getAttribute('href');
  const imageResponse = await page.request.get(new URL(imageHref, baseURL).href);
  expect(imageResponse.ok()).toBeTruthy();
  expect((await imageResponse.body()).equals(imageFixture)).toBe(true);
  const imageURL = new URL(imageHref, baseURL);
  const imagePath = imageURL.pathname + imageURL.search;
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await register(second, other.username, other.password);
  const denied = await second.evaluate(async creatureId => {
    try {
      await window.Meteor.callAsync('creatures.update', { _id: creatureId, path: ['name'], value: 'Stolen' });
      return false;
    } catch { return true; }
  }, creatureId);
  expect(denied).toBe(true);
  await secondContext.close();
  await page.evaluate(() => new Promise((resolve, reject) => window.Meteor.logout(error => error ? reject(error) : resolve())));
  expect(await page.evaluate(() => window.Meteor.userId())).toBeNull();
  const anonymousDenied = await page.evaluate(async creatureId => {
    try {
      await window.Meteor.callAsync('Creatures.methods.removeCreature', { charId: creatureId });
      return false;
    } catch { return true; }
  }, creatureId);
  expect(anonymousDenied).toBe(true);
  await login(page, owner);
  const archiveId = await call(page, 'Creatures.methods.archiveCreatureToFile', { creatureId });
  expect(archiveId).toBeTruthy();
  await ready(page, '/my-files');
  const archiveCard = page.locator(`[data-id="${archiveId}-archive-card"]`);
  await expect(archiveCard).toBeVisible();
  const archiveHref = await archiveCard.locator('a[href*="download"]').getAttribute('href');
  const archiveResponse = await page.request.get(new URL(archiveHref, baseURL).href);
  expect(archiveResponse.ok()).toBeTruthy();
  expect((await archiveResponse.json()).creature.name).toBe('Runtime verified character');
  await archiveCard.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(archiveCard).toHaveCount(0);
  const temporary = await call(page, 'creatures.insertCreature', {
    name: 'Disposable character', startingLevel: 0, allowedLibraries: [], allowedLibraryCollections: [],
  });
  await call(page, 'Creatures.methods.removeCreature', { charId: temporary });
  await ready(page, `/character/${creatureId}`);
  await expect(page.getByText('Runtime verified character', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
  await propertyHasValue(page, abilityId, 14);
  await propertyHasValue(page, slotId, 2);
  if (fixturePath) writeFileSync(fixturePath, JSON.stringify({ owner, creatureId, libraryId, abilityId, slotId, imagePath }), { mode: 0o600 });
  await context.close();
});

test('retained fixture survives restart or restore', async ({ page }) => {
  test.skip(!process.env.DICECLOUD_VERIFY_RESTORE, 'Run separately against the restarted/restored stack');
  const { owner, creatureId, libraryId, abilityId, slotId, imagePath } = JSON.parse(readFileSync(fixturePath, 'utf8'));
  await login(page, owner);
  await ready(page, `/character/${creatureId}`);
  await expect(page.getByText('Runtime verified character', { exact: true }).first()).toBeVisible();
  await propertyHasValue(page, abilityId, 14);
  await propertyHasValue(page, slotId, 2);
  await ready(page, `/library/${libraryId}`);
  await expect(page.getByText('Runtime smoke library', { exact: true }).first()).toBeVisible();
  const response = await page.request.get(new URL(imagePath, baseURL).href);
  expect(response.ok()).toBeTruthy();
  expect((await response.body()).equals(imageFixture)).toBe(true);
});

test('closed registration rejects a new browser account', async ({ page }) => {
  test.skip(!process.env.DICECLOUD_VERIFY_RESTORE, 'Registration is enabled only during initial private setup');
  await ready(page);
  const denied = await page.evaluate(() => new Promise(resolve => {
    window.Accounts.createUser({ username: `blocked-${Date.now()}`, password: 'synthetic-registration-probe' }, error => resolve(Boolean(error)));
  }));
  expect(denied).toBe(true);
  expect(await page.evaluate(() => window.Meteor.userId())).toBeNull();
});
