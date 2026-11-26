import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { commonActions, commonAction, weaponProfile, weaponNumbers, recordedAttack, weaponAction, sheetWeaponAction, weaponProficiency, abilityFor } from '../app/imports/client/ui/properties/actionPresets/physicalActions.mjs';
const catalog = JSON.parse(readFileSync(new URL('../app/imports/client/ui/properties/actionPresets/weapons2014.json', import.meta.url)));
const vars = { strength: { modifier: -1 }, dexterity: { modifier: 4 }, proficiencyBonus: { value: 3 } };
test('Seven editable normal actions, with live walking speed when available and literal Ready details', () => {
  for (const name of Object.keys(commonActions)) assert.equal(commonAction(name).actionType, 'action');
  assert.equal(Object.keys(commonActions).length, 7);
  assert.match(commonAction('Dash', { speed: { value: 0 } }).summary.text, /\{speed\}/);
  assert.doesNotMatch(commonAction('Dash').summary.text, /\{/);
  assert.doesNotMatch(commonAction('Ready', {}, '{trigger}', 'act').summary.text, /[{}]/);
});
test('Pick up a saved attack without adding the character modifier or proficiency twice', () => {
  const note = recordedAttack({ _id: 'n', name: 'Rapier +1', description: { text: '+9 vs AC\n1d8+5 piercing\n5 ft' } });
  const item = { _id: 'w', name: 'Rapier +1' };
  const action = weaponAction(item, note.bonus, note.damage, note.range);
  assert.match(action.summary.text, /d20 \+9.*1d8\+5 piercing/);
  assert.equal(action.attackRoll, undefined);
  assert.equal(recordedAttack({ description: { text: 'Meeting notes' } }), undefined);
});
test('2014 weapon profiles, variable bonuses, proficiency, two-handed dice and exceptions', () => {
  assert.equal(Object.keys(catalog).length, 37);
  const rapier = weaponProfile('Rapier + 1', catalog);
  assert.equal(abilityFor(rapier, vars), 'dexterity');
  assert.equal(weaponProficiency('Rapier +1', rapier, []), null);
  assert.equal(weaponProficiency('Rapier +1', rapier, [{ name:'Martial weapons', proficiency:1 }]), true);
  assert.deepEqual(weaponNumbers(rapier,'dexterity',true,vars,false), {bonus:8,damage:'1d8+5 piercing',range:'5 ft'});
  assert.equal(weaponNumbers(rapier,'dexterity',null,vars,false).bonus, undefined);
  assert.equal(weaponNumbers(weaponProfile('Quarterstaff',catalog),'strength',false,vars,true).damage,'1d8-1 bludgeoning');
  assert.equal(weaponProfile('Light crossbow',catalog).range, '80/320 ft');
  assert.equal(weaponProfile('Net',catalog).damage, '');
  assert.equal(weaponProfile('Homebrew sword',catalog), undefined);
  const action = sheetWeaponAction({_id:'w',name:'Rapier +1'},8,'1d8+5 piercing','5 ft',rapier,'dexterity',true,vars,false);
  assert.match(action.summary.text,/\{dexterity\.modifier \+ 1 \+ proficiencyBonus\}/);
  assert.match(action.summary.text,/1d8 piercing, adding \{dexterity\.modifier \+ 1\}/);
});

import { classLevel, sheetAbilities, smiteDice, sneakDice, poolFor, validCost } from '../app/imports/api/classAbilities/physical.mjs';
test('2014 class abilities use class levels and the existing sheet pools', () => {
  const imported = [{type:'note',name:'Aurora import record',description:{text:'Level: 12\nRogue 10\nMonk 2'}}];
  assert.equal(classLevel({},imported,'rogue'),10);
  assert.equal(classLevel({advancement:{className:'rogue',level:11}},imported,'rogue'),11);
  assert.deepEqual(sheetAbilities({},imported).map(a=>a.name), ['Cunning Action','Sneak Attack','Step of the Wind']);
  assert.equal(sneakDice(10,false),5); assert.equal(sneakDice(10,true),10);
  assert.equal(smiteDice(1,false,false),2); assert.equal(smiteDice(3,true,true),10); assert.equal(smiteDice(9,true,true),12);
  for (const [name,id] of [['Step of the Wind','kiPoints'],['Lay on Hands','layOnHands']]) {
    const pool={type:'attribute',attributeType:'resource',variableName:id};
    assert.ok(poolFor(name,pool)); assert.equal(poolFor(name,{...pool,inactive:true}),false);
    assert.equal(poolFor(name,{...pool,variableName:'auroragold'}),false);
    assert.ok(poolFor(name,{...pool,variableName:'customCounter',tags:[id]}));
  }
  assert.ok(validCost('Lay on Hands',50,50));
  for(const n of [0,51,1.5,-1])assert.equal(validCost('Lay on Hands',n,50),false);
  assert.equal(validCost('Step of the Wind',2,10),false);
  assert.equal(validCost('Cunning Action',1,10),false);
});

import { affinityDamage, slotCosts } from '../app/imports/api/classAbilities/physical.mjs';
test('Sorcerer choices share their sorcery pool and use the 2014 costs', () => {
  const record = {type: 'note', name: 'Aurora import record', description: { text: 'Sorcerer 10' }};
  const features = ['Quickened Spell', 'Heightened Spell', 'Elemental Affinity', 'Red Dragon'].map(name => ({type: 'feature', name}));
  assert.deepEqual(sheetAbilities({}, [record]).map(a => a.name), ['Font of Magic']);
  assert.equal(affinityDamage(features), 'fire');
  const pool = {type: 'attribute', attributeType: 'resource', variableName: 'custom', tags: ['sorceryPoints']};
  for (const [ability, cost] of [['Quickened Spell', 2], ['Heightened Spell', 3], ['Elemental Affinity', 1]]) {
    assert.ok(sheetAbilities({}, [record, ...features]).some(a => a.name === ability));
    assert.ok(poolFor(ability, pool));
    assert.ok(validCost(ability, cost, cost));
    assert.equal(validCost(ability, cost, cost-1), false);
    assert.equal(validCost(ability, cost+1, 10), false);
    assert.equal(poolFor(ability, {...pool, tags: ['kiPoints']}), false);
  }
  assert.equal(validCost('Font of Magic', 1, 10), false);
  assert.deepEqual(slotCosts.slice(1), [2, 3, 5, 6, 7]);
});

test('Ranger hunter choices are opt-in and Primeval Awareness spends exactly one levelled slot', () => {
  const ranger = {type: 'class', variableName: 'ranger', level: 10};
  assert.deepEqual(sheetAbilities({}, [ranger]).map(a => a.name), ['Primeval Awareness', 'Extra Attack', 'Hide in Plain Sight']);
  const picks = ['Horde Breaker', 'Multiattack Defense'].map(name => ({type: 'feature', name}));
  assert.equal(sheetAbilities({}, [ranger, ...picks]).length, 5);
  assert.equal(sheetAbilities({}, [{type: 'feature', name: 'Extra Attack'}]).length, 0);
  const slot = {type: 'attribute', name: 'Second level', attributeType: 'spellSlot', spellSlotLevel: {value: 2}};
  assert.ok(poolFor('Primeval Awareness', slot));
  assert.equal(poolFor('Primeval Awareness', {...slot, name:'Pact Magic'}), false);
  assert.equal(poolFor('Primeval Awareness', {...slot, spellSlotLevel:{value:0}}), false);
  assert.ok(validCost('Primeval Awareness', 1, 3));
  assert.equal(validCost('Primeval Awareness', 2, 3), false);
});
