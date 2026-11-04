import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const baseURL = process.env.DICECLOUD_TEST_URL || 'http://127.0.0.1:31080';
const fixturePath = process.env.DICECLOUD_TEST_FIXTURE;

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
  test.setTimeout(120_000);
  const owner = { username: `runtime-owner-${Date.now()}`, password: randomBytes(24).toString('hex') };
  const other = { username: `runtime-other-${Date.now()}`, password: randomBytes(24).toString('hex') };
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
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
  const asset = await page.request.get(new URL('/crown-dice-logo-cropped-transparent.png', baseURL).href);
  expect(asset.ok()).toBeTruthy();
  expect(asset.headers()['content-type']).toContain('image');
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
  const temporary = await call(page, 'creatures.insertCreature', {
    name: 'Disposable character', startingLevel: 0, allowedLibraries: [], allowedLibraryCollections: [],
  });
  await call(page, 'Creatures.methods.removeCreature', { charId: temporary });
  await ready(page, `/character/${creatureId}`);
  await expect(page.getByText('Runtime verified character', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
  if (fixturePath) writeFileSync(fixturePath, JSON.stringify({ owner, creatureId, libraryId }), { mode: 0o600 });
  await context.close();
});

test('retained fixture survives restart or restore', async ({ page }) => {
  test.skip(!process.env.DICECLOUD_VERIFY_RESTORE, 'Run separately against the restarted/restored stack');
  const { owner, creatureId, libraryId } = JSON.parse(readFileSync(fixturePath, 'utf8'));
  await login(page, owner);
  await ready(page, `/character/${creatureId}`);
  await expect(page.getByText('Runtime verified character', { exact: true }).first()).toBeVisible();
  await ready(page, `/library/${libraryId}`);
  await expect(page.getByText('Runtime smoke library', { exact: true }).first()).toBeVisible();
});
