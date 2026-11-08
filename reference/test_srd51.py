from pathlib import Path
import unittest,json,hashlib,re,unicodedata
R=Path(__file__).resolve().parents[1];S=R/'reference/srd51'
def norm(t):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',t).lower())
class CorpusTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.p=json.loads((R/'app/private/rules-reference/srd51.json').read_text());cls.e=cls.p['entries']
 def test_official_source_and_complete_page_inventory(self):
  self.assertEqual(hashlib.sha256((S/'source.pdf').read_bytes()).hexdigest(),self.p['sourceHash'])
  self.assertEqual(set(self.p['coverage']['mappedPages']),set(range(1,404))-{2})
  self.assertFalse(self.p['coverage']['unresolvedEntries'])
 def test_every_substantive_converted_paragraph_and_table_accounted_for(self):
  corpus=norm(' '.join(p.read_text()for p in (S/'markdown').rglob('*.md')))
  for para in (S/'converted.md').read_text().split('\n\n'):
   text=norm(para)
   if len(text)>=10 and not re.fullmatch(r'#{1,6}\s+[^\n]+',para.strip()):self.assertIn(text,corpus,para[:100])
 def test_manifest_hashes_unique_identifiers_and_description_limits(self):
  self.assertEqual(len(self.e),1000);self.assertEqual(len({e['key']for e in self.e}),len(self.e))
  self.assertEqual(hashlib.sha256(json.dumps(self.e,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),self.p['entriesHash'])
  for e in self.e:
   self.assertLess(len(e['markdown']),49000);self.assertEqual(hashlib.sha256(e['markdown'].encode()).hexdigest(),e['contentHash'])
 def test_tables_statistics_and_curated_links(self):
  by={e['title']:e for e in self.e};g=by['Goblin']['markdown']
  self.assertIn('7 (2d6)',g);self.assertIn('Stealth +6',g);self.assertNotIn('**Saving Throw**',g)
  self.assertIn('| Level',by['Cleric']['markdown']);self.assertIn('Concentration, up to 1 minute',by['Bless']['markdown'])
  self.assertIn(by['Incapacitated']['key'],[x['key']for x in by['Grappled']['links']]);self.assertIn(by['Thunderwave']['key'],[x['key']for x in by['Grappled']['links']])
  for e in self.e:
   for link in e['links']:self.assertTrue(any(x['key']==link['key']for x in self.e))
 def test_attribution_and_edition(self):
  self.assertEqual(self.p['edition'],'2014');self.assertIn('Creative Commons Attribution 4.0',self.e[0]['markdown']);self.assertIn('Wizards of the Coast LLC',self.e[0]['markdown'])
if __name__=='__main__':unittest.main()
