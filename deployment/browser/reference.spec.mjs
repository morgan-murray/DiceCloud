import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const base=(process.env.DICECLOUD_TEST_URL||'http://127.0.0.1:31080').replace(/\/?$/,'/');
const fixture=process.env.DICECLOUD_TEST_FIXTURE;
const url=p=>new URL(p,base).href;
const call=(page,name,arg)=>page.evaluate(({name,arg})=>window.Meteor.callAsync('rulesReference.'+name,...(arg===undefined?[]:[arg])),{name,arg});
async function login(page,owner){await page.goto(url('sign-in'));await page.getByLabel('Username or email').fill(owner.username);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.waitForFunction(()=>!!window.Meteor?.userId());await page.getByRole('button',{name:'Archive characters',exact:true}).first().waitFor();}
const title=page=>page.locator('.reference-article > h2');

test('Rules reference workflow: full corpus, body search, tables, links and private sharing',async({page,browser},info)=>{
 test.skip(!fixture,'Requires workflow account');test.setTimeout(180000);
 const data=JSON.parse(readFileSync(fixture,'utf8'));const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await login(page,data.owner);await page.goto(url('rules'));await expect(page.getByRole('heading',{name:'Rules Reference',exact:true})).toBeVisible();
 if(!(await call(page,'list')).length){await page.getByRole('button',{name:'Add 2014 rules to my library',exact:true}).click();}
 await expect.poll(async()=> (await call(page,'list')).length,{timeout:90000}).toBeGreaterThan(0);
 const book=(await call(page,'list')).find(b=>b.canManage);expect(book.entryCount).toBe(1000);
 expect((await call(page,'install',{})).unchanged).toBe(true);
 const search=page.getByRole('textbox',{name:'Search rules and descriptions',exact:true});await search.fill('Bless');
 await page.locator('.reference-result').filter({has:page.locator('strong').filter({hasText:/^Bless$/})}).click();
 await expect(title(page)).toHaveText('Bless');await expect(page.locator('.reference-body')).toContainText('Concentration, up to 1 minute');
 const bless=(await call(page,'search',{packId:book.id,query:'Bless'})).results[0];expect(bless.title).toBe('Bless');
 for(const query of ['difficult terrain','concentration','long rest','opportunity attack']){expect((await call(page,'search',{packId:book.id,query})).total).toBeGreaterThan(0);}
 await search.fill('Grappled');await page.locator('.reference-result').filter({has:page.locator('strong').filter({hasText:/^Grappled$/})}).click();
 await expect(title(page)).toHaveText('Grappled');await page.locator('.reference-related').getByRole('button',{name:'Incapacitated',exact:true}).click();await expect(title(page)).toHaveText('Incapacitated');
 await search.fill('Cleric');await page.locator('.reference-result').filter({has:page.locator('strong').filter({hasText:/^Cleric$/})}).click();await expect(title(page)).toHaveText('Cleric');await expect(page.locator('.reference-body table').first()).toBeVisible();
 await page.screenshot({path:info.outputPath('reference-desktop-light.png'),fullPage:true});
 await page.evaluate(()=>window.Meteor.callAsync('users.setDarkMode',{darkMode:true}));await expect(page.locator('.lance-chronicle')).toHaveClass(/v-theme--dark/);await page.screenshot({path:info.outputPath('reference-desktop-dark.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('reference-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:900});
 const anonymous=await browser.newContext();try{const p=await anonymous.newPage();await p.goto(url(''));const denied=await call(p,'list').then(()=>false,()=>true);expect(denied).toBe(true);}finally{await anonymous.close();}
 if(!process.env.PUBLIC_VERIFICATION){
  const context=await browser.newContext();try{
   const other=await context.newPage(),username='rr-reader-'+Date.now(),password=randomBytes(20).toString('hex');await other.goto(url(''));
   await other.evaluate(({username,password})=>new Promise((resolve,reject)=>window.Accounts.createUser({username,password},e=>e?reject(new Error(e.reason)):resolve())),{username,password});await other.waitForFunction(()=>!!window.Meteor.userId());
   expect(await call(other,'list')).toEqual([]);expect(await call(other,'entry',{packId:book.id,key:bless.key}).then(()=>false,()=>true)).toBe(true);
   await call(page,'share',{packId:book.id,username});expect((await call(other,'list')).length).toBe(1);expect((await call(other,'entry',{packId:book.id,key:bless.key})).title).toBe('Bless');
   await call(page,'share',{packId:book.id,username,remove:true});expect(await call(other,'entry',{packId:book.id,key:bless.key}).then(()=>false,()=>true)).toBe(true);
   await other.evaluate(()=>window.Meteor.callAsync('users.deleteMyAccount'));
  }finally{await context.close();}
 }
 data.reference={id:book.id,blessKey:bless.key,entryCount:book.entryCount};writeFileSync(fixture,JSON.stringify(data),{mode:0o600});expect(errors).toEqual([]);
});

test('Rules reference retained after restart and backup restore',async({page})=>{
 test.skip(!fixture||!process.env.DICECLOUD_VERIFY_RESTORE,'Runs on retained fixture');
 const {owner,reference}=JSON.parse(readFileSync(fixture,'utf8'));expect(reference).toBeTruthy();await login(page,owner);
 const books=await call(page,'list');expect(books.find(b=>b.id===reference.id)?.entryCount).toBe(reference.entryCount);
 expect((await call(page,'entry',{packId:reference.id,key:reference.blessKey})).markdown).toContain('Concentration, up to 1 minute');
 expect((await call(page,'search',{packId:reference.id,query:'difficult terrain'})).total).toBeGreaterThan(0);
});
