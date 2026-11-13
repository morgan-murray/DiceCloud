import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const base=(process.env.DICECLOUD_TEST_URL||'http://127.0.0.1:31080').replace(/\/?$/,'/');
const fixture=process.env.DICECLOUD_TEST_FIXTURE;
const call=(p,name,arg)=>p.evaluate(({name,arg})=>window.Meteor.callAsync(name,arg),{name,arg});
test('Character tabs: grouped proficiencies and language details',async({page},info)=>{
 test.skip(!fixture,'Requires a workflow account');test.setTimeout(120000);
 const {owner}=JSON.parse(readFileSync(fixture,'utf8')),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(new URL('sign-in',base).href);await page.getByLabel('Username or email').fill(owner.username);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('button',{name:'Archive characters',exact:true}).first().waitFor();
 let id;
 try{
  id=await call(page,'creatures.insertCreature',{name:'Grouped feature review',startingLevel:1,allowedLibraries:[],allowedLibraryCollections:[]});
  const names=['Armor Proficiency (Light Armor)','Armour Proficiency: Plate','Weapon Proficiency (Longsword)','Common','Moon Speech','Armor of Agathys','Language of the Woods'];
  const created=[];
  for(const name of names){created.push(await call(page,'creatureProperties.insert',{creatureProperty:{type:'feature',name,tags:name==='Moon Speech'?['language']:[],description:{text:'Detail for '+name+'. Apply its benefits and limitations as described.'},root:{collection:'creatures',id}}}));await page.waitForTimeout(1100);}
  await page.evaluate(id=>document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/character/'+id),id);await page.locator('.character-sheet').waitFor();await page.getByRole('tab',{name:'Features',exact:true}).click();
  const group=key=>page.locator(`[data-id="feature-group-${key}"]`);
  for(const key of ['armor','weapons','languages']){await expect(group(key)).toBeVisible();await expect(group(key)).toHaveJSProperty('open',false);}
  await expect(group('armor').locator('summary')).toContainText('2');await expect(group('languages').locator('summary')).toContainText('2');
  await expect(page.locator(`.toolbar-card[data-id="${created[5]}"]`)).toBeVisible();await expect(page.locator(`.toolbar-card[data-id="${created[6]}"]`)).toBeVisible();
  const before=await page.evaluate(id=>window.Mongo.getCollection('creatureProperties').find({'root.id':id}).fetch().map(p=>({id:p._id,name:p.name,parentId:p.parentId,description:p.description?.text})).sort((a,b)=>a.id.localeCompare(b.id)),id);
  for(const [key,name] of [['armor',names[0]],['weapons',names[2]],['languages',names[3]],['languages',names[4]]]){
   if(!await group(key).evaluate(e=>e.open)){await group(key).locator('summary').focus();await group(key).locator('summary').press('Enter');}
   const entry=group(key).getByRole('button',{name:'Open feature: '+name,exact:true});await expect(entry).toBeVisible();await entry.click();const dialog=page.locator('.dialog-stack .dialog').last();await expect(dialog).toContainText('Detail for '+name+'.');await expect(page.locator('.dialog-stack .dialog')).toHaveCount(1);await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.dialog-stack .dialog')).toHaveCount(0);await expect(group(key)).toHaveJSProperty('open',true);
  }
  await page.screenshot({path:info.outputPath('feature-groups-light.png'),animations:'disabled'});await page.evaluate(()=>window.Meteor.callAsync('users.setDarkMode',{darkMode:true}));await page.screenshot({path:info.outputPath('feature-groups-dark.png'),animations:'disabled'});await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('feature-groups-mobile.png'),animations:'disabled',fullPage:true});
  await group('armor').locator('summary').focus();await group('armor').locator('summary').press('Enter');await expect(group('armor')).toHaveJSProperty('open',false);await expect(group('armor').getByRole('button',{name:'Open feature: '+names[0],exact:true})).not.toBeVisible();
  const after=await page.evaluate(id=>window.Mongo.getCollection('creatureProperties').find({'root.id':id}).fetch().map(p=>({id:p._id,name:p.name,parentId:p.parentId,description:p.description?.text})).sort((a,b)=>a.id.localeCompare(b.id)),id);expect(after).toEqual(before);expect(errors).toEqual([]);
 }finally{if(id)await call(page,'Creatures.methods.removeCreature',{charId:id});}
});
