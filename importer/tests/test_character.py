import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest
from aurora.character import extract
from aurora.secure import ImportErrorDetail, xml

ROOT=Path(__file__).resolve().parent.parent

def upload(body,name):return dict(name=name,data=base64.b64encode(body).decode())
def fixture(name):return upload((ROOT/'fixtures'/(name+'.dnd5e')).read_bytes(),name+'.dnd5e')
def pack():return [upload((ROOT/'fixtures/content.xml').read_bytes(),'content.xml')]

class CharacterTests(unittest.TestCase):
    def test_embedded_portrait_is_omitted_with_warning_and_original_hash(self):
        from aurora.secure import digest
        f=fixture('martial');body=base64.b64decode(f['data']).replace(b'</display-properties>',b'<portrait><local>portrait.png</local><base64>'+b'A'*280000+b'</base64></portrait></display-properties>')
        result=extract(upload(body,'portrait.dnd5e'),pack())
        self.assertEqual(result['hitPoints']['maximum'],28)
        self.assertEqual(result['armorClass'],16)
        self.assertEqual(result['provenance']['sourceHash'],digest(body))
        self.assertIn('PORTRAIT_NOT_IMPORTED',[d['code'] for d in result['diagnostics']])
        self.assertNotIn('A'*100,json.dumps(result))
        from aurora.secure import CHAR_LIMIT
        oversized=body.replace(b'A'*280000,b'A'*CHAR_LIMIT)
        with self.assertRaises(ImportErrorDetail) as error:extract(upload(oversized,'large-portrait.dnd5e'),pack())
        self.assertEqual(error.exception.diagnostic['code'],'SIZE_LIMIT')

    def test_native_build_sections_preserve_inventory_spells_slots_and_attacks(self):
        from xml.etree import ElementTree as ET
        for name in ['martial','caster','multiclass','equipment']:
            f=fixture(name);root=ET.fromstring(base64.b64decode(f['data']));build=root.find('build')
            for section in ['equipment','magic']:
                node=root.find(section)
                if node is not None:root.remove(node);build.append(node)
            input_node=build.find('input')
            if input_node is None:input_node=ET.SubElement(build,'input')
            attacks=ET.SubElement(input_node,'attacks')
            attack=ET.SubElement(attacks,'attack',name='Training weapon',attack='+5',damage='1d8 + 3',range='5 ft')
            ET.SubElement(attack,'description').text='Synthetic manual attack.'
            actual=extract(upload(ET.tostring(root),'nested.dnd5e'),pack());expected=extract(f,pack())
            for key in ['armorClass','abilities','inventory','spellcasting','resources']:
                self.assertEqual(actual[key],expected[key],(name,key))
            self.assertEqual(actual['attacks'][0]['name'],'Training weapon')

    def test_duplicate_native_and_legacy_sections_are_not_silently_combined(self):
        from xml.etree import ElementTree as ET
        for section in ['equipment','magic','attacks']:
            f=fixture('martial');root=ET.fromstring(base64.b64decode(f['data']));build=root.find('build')
            if root.find(section) is None:ET.SubElement(root,section)
            parent=build
            if section=='attacks':parent=ET.SubElement(build,'input')
            ET.SubElement(parent,section)
            with self.assertRaises(ImportErrorDetail) as error:extract(upload(ET.tostring(root),'ambiguous.dnd5e'),pack())
            self.assertEqual(error.exception.diagnostic['code'],'AMBIGUOUS_SECTION')

    def test_independent_expected_totals(self):
        expected=json.loads((ROOT/'fixtures/expected.json').read_text())
        for name,e in expected.items():
            with self.subTest(name=name):
                result=extract(fixture(name),pack())
                self.assertEqual(result['hitPoints']['maximum'],e['hp'])
                self.assertEqual(result['armorClass'],e['ac'])
                self.assertEqual(result['abilities']['strength'],e['strength'])
                skill='athletics' if 'athletics' in e else 'arcana'
                self.assertEqual(result['skills'][skill]['bonus'],e[skill])
                self.assertEqual(result,extract(fixture(name),pack()))
                self.assertEqual(result['provenance']['builtin']['id'],'aurora-core-2014')
                self.assertIsNone(result['hitPoints']['current'])

    def test_aurora_movement_and_armor_conventions(self):
        result=extract(fixture('martial'),pack())
        self.assertEqual(result['movement']['walk'],30)
        self.assertEqual(result['armorClass'],16)  # 14 armor + 2 shield once
        self.assertEqual(extract(fixture('equipment'),pack())['armorClass'],20)

    def test_display_armor_fallback_and_class_calculation(self):
        content=pack()
        raw=base64.b64decode(content[0]['data']).replace(b'<stat name="ac:armored:armor" value="14" />',b'')
        raw=raw.replace(b'<stat name="ac:shield" value="2" />',b'')
        content[0]['data']=base64.b64encode(raw).decode()
        self.assertEqual(extract(fixture('martial'),content)['armorClass'],16)

    def test_innate_speed_combines_with_additive_speed(self):
        content=pack()
        raw=base64.b64decode(content[0]['data']).replace(b'<stat name="innate speed" value="30" />',b'<stat name="innate speed" value="30" /><stat name="speed" value="5" />')
        content[0]['data']=base64.b64encode(raw).decode()
        self.assertEqual(extract(fixture('martial'),content)['movement']['walk'],35)

    def test_alternative_armor_calculation_competes_with_baseline(self):
        content=pack()
        raw=base64.b64decode(content[0]['data']).replace(b'<stat name="innate speed" value="30" />',b'<stat name="innate speed" value="30" /><stat name="ac:calculation" value="17" bonus="calculation" equipped="[armor:none]" />')
        content[0]['data']=base64.b64encode(raw).decode()
        self.assertEqual(extract(fixture('caster'),content)['armorClass'],17)
        self.assertEqual(extract(fixture('martial'),content)['armorClass'],16)

    def test_duplicate_inventory_ids_preserve_each_equipped_state(self):
        from xml.etree import ElementTree as ET
        f=fixture('martial');root=ET.fromstring(base64.b64decode(f['data']))
        first=ET.Element('item',id='ID_TEST_ARMOR',amount='1');ET.SubElement(first,'equipped').text='false'
        root.find('equipment').insert(0,first)
        result=extract(upload(ET.tostring(root),'duplicates.dnd5e'),pack())
        self.assertEqual(result['armorClass'],16)
        self.assertEqual([i['equipped'] for i in result['inventory']],[False,True,True])

    def test_pact_and_ordinary_resources_separate(self):
        result=extract(fixture('multiclass'),pack())
        self.assertEqual([(r['pool'],r['level'],r['total'],r['reset']) for r in result['resources']], [('spellcasting',1,4,'longRest'),('spellcasting',2,2,'longRest'),('pact',1,2,'shortRest')])
        self.assertEqual([d['count'] for d in result['hitDice']],[3,2])

    def test_asi_pack_is_automatically_used_and_instances_preserved(self):
        f=fixture('martial');body=base64.b64decode(f['data']).replace(b'</sum>',b'<element id="ID_INTERNAL_ASI_STRENGTH" type="Ability Score Improvement"/><element id="ID_INTERNAL_ASI_STRENGTH" type="Ability Score Improvement"/></sum>')
        self.assertEqual(extract(upload(body,'asi.dnd5e'),pack())['abilities']['strength'],18)

    def test_unattuned_effect_inactive(self):
        f=fixture('equipment');body=base64.b64decode(f['data']).replace(b'<attunement>true</attunement>',b'<attunement>false</attunement>')
        self.assertEqual(extract(upload(body,'equipment.dnd5e'),pack())['armorClass'],19)

    def test_missing_content_does_not_create_zero_totals(self):
        with self.assertRaises(ImportErrorDetail) as error:extract(fixture('martial'),[])
        self.assertEqual(error.exception.diagnostic['code'],'MISSING_CONTENT')

    def test_unsafe_and_malformed_xml(self):
        for body in [b'<!DOCTYPE character [<!ENTITY x SYSTEM "file:///etc/passwd">]><character>&x;</character>',b'<a>'*65+b'</a>'*65,b'<character>',b'<x:include xmlns:x="http://www.w3.org/2001/XInclude" href="https://example.com"/>']:
            with self.assertRaises(ImportErrorDetail):xml(body)

    def test_worker_protocol(self):
        request=dict(schemaVersion=1,operation='character',character=fixture('martial'),files=pack())
        result=subprocess.run([sys.executable,'-I','-B',str(ROOT/'worker.py')],input=json.dumps(request).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        parsed=json.loads(result.stdout)
        self.assertTrue(parsed['ok'],parsed)
        self.assertEqual(parsed['result']['hitPoints']['maximum'],28)
        self.assertEqual(result.stderr,b'')

if __name__=='__main__':unittest.main()
