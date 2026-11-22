import base64
import copy
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET
from aurora.builtin import load_builtin, PACK_VERSION
from aurora.content import CompendiumQuery
from aurora.secure import ImportErrorDetail

def upload(body, name='private.xml'):
    return dict(name=name, data=base64.b64encode(body).decode())

class ReferenceTests(unittest.TestCase):
    def test_builtin_requires_no_upload_and_records_provenance(self):
        result = CompendiumQuery([]).result()
        self.assertEqual(result['elementCount'], 161)
        self.assertEqual(result['builtin']['version'], PACK_VERSION)
        self.assertEqual(result['builtin']['scope'], 'builtin')
        self.assertEqual(result['builtin']['licence'], 'CC-BY-4.0')
        self.assertEqual(result['files'], [])
        self.assertEqual(result, CompendiumQuery([]).result())

    def test_real_definitions_not_empty_stubs(self):
        query = CompendiumQuery([])
        stat = query.quick_query_id('ID_INTERNAL_ASI_STRENGTH').find('./rules/stat')
        self.assertEqual(stat.attrib, dict(name='strength', value='1'))
        stat = query.quick_query_id('ID_PROFICIENCY_SKILL_ATHLETICS').find('./rules/stat')
        self.assertEqual(stat.get('value'), 'proficiency')
        self.assertIsNone(query.quick_query_id('ID_UNKNOWN_COMMERCIAL_FEATURE'))

    def test_conflicting_user_definition_rejected(self):
        body=b'<elements><element id="ID_INTERNAL_ASI_STRENGTH" name="Changed"><rules><stat name="strength" value="99"/></rules></element></elements>'
        with self.assertRaises(ImportErrorDetail) as error: CompendiumQuery([upload(body)])
        self.assertEqual(error.exception.diagnostic['code'], 'BUILTIN_ELEMENT_CONFLICT')

    def test_default_rogue_and_private_override(self):
        key = 'ID_WOTC_PHB_CLASS_ROGUE'
        defaults = CompendiumQuery([])
        self.assertEqual(defaults.read_setter(defaults.quick_query_id(key), 'hd'), 'd8')
        body = f'<elements><element id="{key}" name="Private Rogue"><setters><set name="hd">d10</set></setters></element></elements>'.encode()
        private = CompendiumQuery([upload(body)])
        self.assertEqual(private.read_setter(private.quick_query_id(key), 'hd'), 'd10')
        self.assertNotEqual(defaults.hash, private.hash)

    def test_site_defaults_are_fingerprinted_and_private_packs_win(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'defaults.xml'
            with patch('aurora.builtin.SITE_PACK_PATH', path):
                base = CompendiumQuery([])
                path.write_text('<elements><element id="ID_TEST_RULE" name="Site"/></elements>')
                site = CompendiumQuery([])
                self.assertNotEqual(base.hash, site.hash)
                self.assertEqual(site.quick_query_id('ID_TEST_RULE').get('name'), 'Site')
                private = CompendiumQuery([upload(b'<elements><element id="ID_TEST_RULE" name="Private"/></elements>')])
                self.assertEqual(private.quick_query_id('ID_TEST_RULE').get('name'), 'Private')

    def test_exact_duplicate_deduplicated(self):
        root=ET.Element('elements')
        root.append(copy.deepcopy(CompendiumQuery([]).quick_query_id('ID_INTERNAL_ASI_STRENGTH')))
        result=CompendiumQuery([upload(ET.tostring(root))]).result()
        self.assertEqual(result['elementCount'],161)
        self.assertNotEqual(result['hash'],CompendiumQuery([]).hash)

    def test_private_content_supplements_but_not_mutates_builtin(self):
        body=b'<elements><element id="ID_HOME_TEST" name="Test" type="Feature"><rules><stat name="hp" value="2"/></rules></element></elements>'
        private=CompendiumQuery([upload(body)]).result()
        base=CompendiumQuery([]).result()
        self.assertEqual(private['elementCount'],162)
        self.assertEqual(private['builtin'],base['builtin'])
        self.assertNotEqual(private['hash'],base['hash'])
        self.assertEqual(len(CompendiumQuery([]).elements),161)

    def test_future_pack_changes_fingerprint(self):
        body, root, manifest=load_builtin()
        next_manifest=dict(manifest, version='2.0.0')
        with patch('aurora.content.load_builtin', return_value=(body,root,next_manifest)):
            newer=CompendiumQuery([]).hash
        self.assertNotEqual(newer,CompendiumQuery([]).hash)

    def test_private_duplicate_and_patches_fail_explicitly(self):
        for body,code in [(b'<elements><element id="ID_TEST"/><element id="ID_TEST"/></elements>','DUPLICATE_ELEMENT_ID'),(b'<elements><append id="ID_TEST"/></elements>','UNSUPPORTED_CONTENT_PATCH')]:
            with self.assertRaises(ImportErrorDetail) as error:CompendiumQuery([upload(body)])
            self.assertEqual(error.exception.diagnostic['code'],code)

    def test_unsafe_names_rejected_even_without_archive(self):
        for name in ['../test.xml','/test.xml','C:test.xml','a\\test.xml']:
            with self.assertRaises(ImportErrorDetail):CompendiumQuery([upload(b'<elements/>',name)])

if __name__ == '__main__':unittest.main()
