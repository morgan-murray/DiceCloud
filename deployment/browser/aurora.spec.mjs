import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const baseURL=(process.env.DICECLOUD_TEST_URL || 'http://127.0.0.1:31080').replace(/\/?$/, '/');
const url=path=>new URL(path.replace(/^\//,''),baseURL).href;
const fixturePath=process.env.DICECLOUD_TEST_FIXTURE;
async function ready(page,path='/') { await page.goto(url(path)); await page.waitForFunction(()=>window.Meteor?.status().connected); }
async function login(page,owner) {
  await ready(page,'/sign-in');
  await page.getByLabel('Username or email').fill(owner.username);
  await page.getByLabel('Password',{exact:true}).fill(owner.password);
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>!!window.Meteor.userId());
}
async function call(page,name,argument) { return page.evaluate(({name,argument})=>window.Meteor.callAsync(name,argument),{name,argument}); }
async function verify(page,creatureId) {
  await ready(page,`/character/${creatureId}`);
  await page.waitForFunction(id=>window.Mongo?.getCollection('creatureProperties')?.findOne({'root.id':id,variableName:'hitPoints'})?.total===28,creatureId);
  const result=await page.evaluate(id=>{
    const props=window.Mongo.getCollection('creatureProperties').find({'root.id':id}).fetch();
    const value=name=>props.find(p=>p.variableName===name);
    return {hp:value('hitPoints').total,ac:value('armor').total,strength:value('strength').total,athletics:value('athletics').value,record:props.find(p=>p.name==='Aurora import record')?.description.text};
  },creatureId);
  expect(result).toMatchObject({hp:28,ac:16,strength:16,athletics:5});
  expect(result.record).toContain('aurora-core-2014');
  expect(result.record).toContain('SNAPSHOT');
}

test('Aurora workflow: built-in reference, private pack, explicit preview and native reload',async({page})=>{
  test.skip(!fixturePath || !!process.env.DICECLOUD_VERIFY_RESTORE,'Initial enabled stack only');
  test.setTimeout(120000);
  const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await login(page,fixture.owner);
  const status=await call(page,'aurora.status');expect(status.enabled).toBe(true);expect(status.builtin.id).toBe('aurora-core-2014');
  await page.getByRole('button',{name:'Import Aurora character',exact:true}).click();
  const dialog=page.locator('.dialog-stack .dialog');
  await expect(dialog.getByText(/Built in:/)).toBeVisible();
  await dialog.getByText('Manage private content and import history',{exact:true}).click();
  await dialog.getByLabel('Private pack name').fill('Synthetic browser content');
  await dialog.locator('input[type=file][multiple]').setInputFiles(new URL('../../importer/fixtures/content.xml',import.meta.url).pathname);
  await dialog.getByRole('button',{name:'Save private pack',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Delete pack',exact:true})).toBeVisible();
  await dialog.locator('input[type=file]:not([multiple])').setInputFiles(new URL('../../importer/fixtures/martial.dnd5e',import.meta.url).pathname);
  await dialog.getByRole('button',{name:'Preview character',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'martial',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Import this snapshot',exact:true})).toBeDisabled();
  await dialog.getByLabel('I have reviewed the warnings and agree to initialize HP and resources to full.').check();
  await dialog.getByRole('button',{name:'Import this snapshot',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.waitForFunction(()=>/\/character\//.test(location.pathname));
  const creatureId=new URL(page.url()).pathname.split('/character/')[1].split('/')[0];
  await verify(page,creatureId);await page.reload();await verify(page,creatureId);
  fixture.aurora={creatureId};writeFileSync(fixturePath,JSON.stringify(fixture),{mode:0o600});
  expect(errors).toEqual([]);
});

test('Aurora retained fixture survives disabled import, restart and restore',async({page})=>{
  test.skip(!process.env.DICECLOUD_VERIFY_RESTORE || !fixturePath,'Restart/restore phase only');
  const fixture=JSON.parse(readFileSync(fixturePath,'utf8'));
  expect(fixture.aurora?.creatureId).toBeTruthy();
  await login(page,fixture.owner);await verify(page,fixture.aurora.creatureId);
});
