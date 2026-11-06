import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBasePath, rootConfiguration, withBasePath, characterApiUrl, accountLink } from '../app/imports/api/utility/urlPaths.mjs';

test('root and nested prefixes normalize consistently', () => {
  assert.equal(normalizeBasePath(''), '/');
  assert.equal(normalizeBasePath('/'), '/');
  assert.equal(normalizeBasePath('/dnd'), '/dnd/');
  assert.equal(normalizeBasePath('/games/dnd/'), '/games/dnd/');
  assert.deepEqual(rootConfiguration('https://example.invalid/dnd'), { rootUrl:'https://example.invalid/dnd/', basePath:'/dnd/', prefix:'/dnd' });
});
test('rejects ambiguous or unsafe deployment configuration', () => {
  for (const value of ['dnd', '//dnd', '/a//b', '/a/../b', '/%2f/', '/a?b', '/a#b', '/a\\b', '/a b']) assert.throws(() => normalizeBasePath(value));
  for (const value of ['', 'file:///dnd', 'https://u:p@example.invalid/dnd', 'https://example.invalid/dnd?q=1', 'https://example.invalid/dnd#x', 'https://example.invalid/a/../dnd']) assert.throws(() => rootConfiguration(value));
});
test('retains encoded segments, query and hash without double prefixes', () => {
  assert.equal(withBasePath('/character/a%20b?tab=spells#slot', '/dnd'), '/dnd/character/a%20b?tab=spells#slot');
  assert.equal(withBasePath('/dnd/character/id', '/dnd/'), '/dnd/character/id');
  assert.equal(withBasePath('?tab=1', '/dnd/'), '/dnd/?tab=1');
  assert.equal(withBasePath('/api/status', '/'), '/api/status');
  assert.equal(withBasePath('', '/dnd/'), '/dnd/');
});
test('preserves intentional external URLs and local fragments', () => {
  for (const value of ['https://example.invalid/a','//cdn.example.invalid/a','mailto:test@example.invalid','#section']) assert.equal(withBasePath(value,'/dnd/'),value);
});
test('account links use the configured root and encode opaque tokens', () => {
  for (const root of ['https://example.invalid/', 'https://example.invalid/dnd/']) {
    assert.equal(accountLink(root,'resetPassword','a/b?c'),root+'reset-password/a%2Fb%3Fc');
    assert.equal(accountLink(root,'enrollAccount','token'),root+'reset-password/token');
    assert.equal(accountLink(root,'verifyEmail','token'),root+'verify-email/token');
  }
});
test('native cross-instance character import retains host, port and prefix', () => {
  assert.equal(characterApiUrl('https://example.invalid:8443/dnd/character/a%20b/name?x=1#tab'),'https://example.invalid:8443/dnd/api/creature/a%20b');
  assert.equal(characterApiUrl('https://example.invalid/character/id'),'https://example.invalid/api/creature/id');
  assert.throws(() => characterApiUrl('https://example.invalid/not-a-character'));
  assert.throws(() => characterApiUrl('file:///character/id'));
});
