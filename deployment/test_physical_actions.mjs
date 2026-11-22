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
