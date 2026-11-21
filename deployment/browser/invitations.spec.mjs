import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const fixturePath = process.env.DICECLOUD_TEST_FIXTURE;
const base = (process.env.DICECLOUD_TEST_URL || 'http://127.0.0.1:31080').replace(/\/?$/, '/');
const url = path => new URL(path.replace(/^\//, ''), base).href;
const call = (page, method, arg) => page.evaluate(({ method, arg }) => window.Meteor.callAsync('playerInvitations.' + method, arg), { method, arg });
const navigate = (page, path) => page.evaluate(path => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path), path);
async function login(page, user) {
  await page.goto(url('sign-in'));
  await page.getByLabel('Username or email').fill(user.username);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.Meteor.userId()));
}
async function closed(page) {
  expect(await page.evaluate(() => new Promise(resolve => window.Accounts.createUser({ username: 'blocked-' + Date.now(), password: 'synthetic-registration-probe' }, error => resolve(Boolean(error)))))).toBe(true);
  expect(await page.evaluate(() => window.Meteor.userId())).toBeNull();
}

test('Player invitation workflow: private creation, chosen password, replacement, revocation and closed registration', async ({ page, browser }, info) => {
  test.skip(!fixturePath, 'Requires the configured private native fixture');
  test.setTimeout(120000);
  const data = JSON.parse(readFileSync(fixturePath, 'utf8'));
  await login(page, data.owner);
  expect((await call(page, 'status')).canInvite).toBe(true);
  await navigate(page, '/account');
  const invite = page.getByRole('button', { name: 'Invite player', exact: true });
  await expect(invite).toBeVisible();
  const dialog = page.getByRole('dialog');
  const stamp = Date.now();
  async function create(suffix) {
    const person = { username: `player-${stamp}-${suffix}`, email: `player-${stamp}-${suffix}@example.invalid` };
    await invite.click();
    await dialog.getByLabel('Player username', { exact: true }).fill(person.username);
    await dialog.getByLabel('Player email', { exact: true }).fill(person.email);
    await dialog.getByRole('button', { name: 'Create invitation', exact: true }).click();
    const link = dialog.getByLabel('Invitation link', { exact: true });
    await expect(link).toHaveValue(/accept-invite/);
    const address = await link.inputValue();
    await page.screenshot({ path: info.outputPath('invite-player-desktop.png'), animations: 'disabled', mask: [link] });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    return { ...person, address, token: new URL(address).pathname.split('/').pop() };
  }
  const original = await create('join');
  const row = page.locator('.invitation-row').filter({ hasText: original.username });
  await row.getByRole('button', { name: 'Replace link', exact: true }).click();
  const newLink = dialog.getByLabel('Invitation link', { exact: true });
  await expect(newLink).not.toHaveValue(original.address);
  const address = await newLink.inputValue();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guest.goto(url('sign-in')); await closed(guest);
    expect(await call(guest, 'list').then(() => false, () => true)).toBe(true);
    await guest.goto(original.address);
    await expect(guest.getByText('This invitation is invalid, expired or already used. Ask your friend for a new link.', { exact: true })).toBeVisible();
    await guest.goto(address);
    await expect(guest.getByLabel('Password', { exact: true })).toBeVisible();
    await guest.setViewportSize({ width: 320, height: 844 });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await guest.screenshot({ path: info.outputPath('accept-invitation-phone.png'), animations: 'disabled' });
    const password = randomBytes(24).toString('hex');
    await guest.getByLabel('Password', { exact: true }).fill(password);
    await guest.getByLabel('Password again', { exact: true }).fill(password);
    await guest.getByRole('button', { name: 'Create account', exact: true }).click();
    await guest.waitForFunction(() => Boolean(window.Meteor.userId()));
    await expect(guest).toHaveURL(/\/character-list$/);
    expect((await call(guest, 'status')).canInvite).toBe(false);
    await navigate(guest, '/account');
    await expect(guest.getByRole('button', { name: 'Invite player', exact: true })).toHaveCount(0);
    expect(await call(guest, 'create', { username: 'not-allowed', email: 'not-allowed@example.invalid' }).then(() => false, () => true)).toBe(true);
    data.playerInvitation = { accepted: { username: original.username, password } };
  } finally { await guestContext.close(); }
  const revoked = await create('revoke');
  await page.locator('.invitation-row').filter({ hasText: revoked.username }).getByRole('button', { name: 'Revoke', exact: true }).click();
  expect(await call(page, 'preview', { token: revoked.token }).then(() => false, () => true)).toBe(true);
  const pending = await create('pending');
  data.playerInvitation.pending = { id: (await call(page, 'list')).find(row => row.username === pending.username)._id, token: pending.token };
  writeFileSync(fixturePath, JSON.stringify(data), { mode: 0o600 });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('player-invitations-settings-phone.png'), fullPage: true, animations: 'disabled' });
  const anonymousContext = await browser.newContext();
  try { const anonymous = await anonymousContext.newPage(); await anonymous.goto(url('sign-in')); await closed(anonymous); }
  finally { await anonymousContext.close(); }
});

test('Player invitation retained after backup restore', async ({ page, browser }) => {
  test.skip(!process.env.DICECLOUD_VERIFY_RESTORE || !fixturePath, 'Requires restored private fixture');
  const data = JSON.parse(readFileSync(fixturePath, 'utf8'));
  test.skip(!data.playerInvitation, 'Invitation workflow runs after initial closed-registration check');
  await login(page, data.owner);
  expect((await call(page, 'status')).canInvite).toBe(true);
  expect((await call(page, 'list')).some(row => row._id === data.playerInvitation.pending.id && row.state === 'pending')).toBe(true);
  expect((await call(page, 'preview', { token: data.playerInvitation.pending.token })).username).toBeTruthy();
  const context = await browser.newContext();
  try { const friend = await context.newPage(); await login(friend, data.playerInvitation.accepted); expect((await call(friend, 'status')).canInvite).toBe(false); }
  finally { await context.close(); }
});
