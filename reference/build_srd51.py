"""Build the pinned SRD 5.1 reference package. Network-free, reproducible."""
from pathlib import Path
import hashlib,json,re,unicodedata,collections,sys
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'reference/srd51/markdown';OUT=ROOT/'app/private/rules-reference/srd51.json'
PDF_HASH='2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0'
UPSTREAM='f1f5060fd975aa2ffc3e4b336560ded479934d80'
CATS=['Core Rules','Character Options','Spells','Equipment','Magic Items','Monsters and DM Reference']
CHAR={'Character','Races','Classes','Feats','Backgrounds'};CORE={'Abilities','Combat','Conditions','Spellcasting','Resting','Movement','Time','Environment','Between Adventures','Sources'}
def category(path):
 top=path.parts[0]
 return ('Character Options' if top in CHAR else 'Core Rules' if top in CORE else 'Spells' if top=='Spells' else 'Equipment' if top=='Equipment' else 'Magic Items' if top=='Magic Items' else 'Monsters and DM Reference')
def words(s):return re.findall(r'[a-z0-9]+',unicodedata.normalize('NFKD',s).lower())
def plain(s):
 s=re.sub(r'!\[[^\]]*\]\([^)]*\)','',s)
 s=re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',s)
 return re.sub(r'\s+',' ',re.sub(r'[*_#|`\\]',' ',s)).strip()
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def stats(md):
 lines=md.splitlines();changes=[]
 for i,line in list(enumerate(lines)):
  if not re.match(r'^\|\s*\*\*Saving Throw\*\*',line):continue
  mods=next((x for x in lines[max(0,i-3):i] if '**Modifier**' in x),None)
  if not mods:raise ValueError('Saving throw row without modifiers')
  values=[x.strip() for x in line.strip('|').split('|')][1:];base=[x.strip() for x in mods.strip('|').split('|')][1:]
  if len(values)!=6 or len(base)!=6:raise ValueError('Malformed ability table')
  saves=[f'{n} {v}' for n,v,b in zip(['Str','Dex','Con','Int','Wis','Cha'],values,base) if v!=b and v not in ['','-','—']]
  lines[i]=''
  # Add the explicit proficient saves below the table, as in the official stat block.
  if saves:lines[i]='\n- **Saving Throws** '+', '.join(saves)+'\n'
  changes.append('Restore explicit saving throws; remove inferred non-proficient save row')
 return '\n'.join(lines).strip()+'\n',changes
pdf=ROOT/'reference/srd51/source.pdf'
assert hashlib.sha256(pdf.read_bytes()).hexdigest()==PDF_HASH
page_file=ROOT/'reference/srd51/canonical-pages.json';pages=json.loads(page_file.read_text())
index=collections.defaultdict(set);pagewords=[words(p)for p in pages]
for n,ww in enumerate(pagewords,1):
 for i in range(len(ww)-4):index[tuple(ww[i:i+5])].add(n)
heading_index=collections.defaultdict(set)
slug=lambda t:re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',t).lower())
for h in json.loads((ROOT/'reference/srd51/pdf-headings.json').read_text()):heading_index[slug(h['title'])].add(h['page'])
files=sorted(SRC.rglob('*.md'));paths={p.relative_to(SRC).as_posix():digest(p.relative_to(SRC).as_posix())[:24]for p in files};entries=[];unresolved=[];low=[];corrections=[]
for p in files:
 rel=p.relative_to(SRC);raw=p.read_text();title=re.search(r'^#\s+(.+)',raw,re.M).group(1).strip();md,changes=stats(raw)
 if 'thunder-wave' in md:md=md.replace('thunder-wave','thunderwave');changes.append('Join PDF line-wrap hyphen in thunderwave')
 text=plain(md);ww=words(text);scores=collections.Counter()
 for i in range(0,max(0,len(ww)-4),2):
  hits=index.get(tuple(ww[i:i+5]),set())
  if len(hits)<=8:scores.update(hits)
 selected=sorted(n for n,s in scores.items()if s>=max(2,max(scores.values(),default=0)*.12))
 # Include matching tail pages contiguous with the entry's main source pages.
 while selected:
  extended=sorted(set(selected)|{n for n,v in scores.items()if v>=1 and any(abs(n-a)==1 for a in selected)})
  if extended==selected:break
  selected=extended
 if not selected:
  tw=' '.join(words(title));selected=[i for i,pg in enumerate(pagewords,1)if tw and tw in ' '.join(pg)]
  low.append({'path':rel.as_posix(),'method':'heading','pages':selected})
 if not selected:unresolved.append(rel.as_posix())
 heading_pages=heading_index.get(slug('Armor and Shields' if title=='Armor' else title),set())
 if not heading_pages:
  heading_pages={n for h,ns in heading_index.items() if len(slug(title))>8 and h.endswith(slug(title)) for n in ns}
 anchor=max(heading_pages,key=lambda n:scores[n]) if heading_pages else max(scores,key=scores.get)
 if changes:corrections.append({'path':rel.as_posix(),'changes':changes})
 assert len(md)<49000 and len(title)<128,(str(rel),len(md),title)
 entries.append({'key':paths[rel.as_posix()],'title':title,'category':category(rel),'section':' / '.join(rel.parts[:-1]),'sourcePath':rel.as_posix(),'pages':[anchor],'coveragePages':selected,'markdown':md,'text':text,'tags':[category(rel),rel.parts[0],'2014','SRD 5.1'],'contentHash':digest(md),'links':[]})
by_path={e['sourcePath']:e for e in entries};by_title=collections.defaultdict(list)
for e in entries:by_title[e['title'].casefold()].append(e)
# Related references never rewrite the official prose. Only unambiguous, explicitly curated terms are used.
terms=['blinded','charmed','deafened','frightened','grappled','incapacitated','invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious','exhaustion']
for e in entries:
 for term in terms:
  target=by_path.get('Conditions/'+term.title()+'.md')
  if target and target['key']!=e['key'] and re.search(r'\b'+term+r'\b',e['text'],re.I):e['links'].append({'key':target['key'],'title':target['title']})
 if e['sourcePath']=='Conditions/Grappled.md':
  for target in by_title.get('thunderwave',[]):e['links'].append({'key':target['key'],'title':target['title']})
 if e['category']=='Spells' and re.search(r'\bconcentration\b',e['text'],re.I):
  t=by_path['Spellcasting/Casting a Spell.md'];e['links'].append({'key':t['key'],'title':'Spellcasting and concentration'})
about='''# About this reference\n\nThis is the 2014 System Reference Document 5.1, not the complete commercial fifth-edition books. Rules are descriptive reference material; importing this collection does not change character calculations.\n\nThis work includes material taken from the System Reference Document 5.1 (\"SRD 5.1\") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.\n\nThe Markdown formatting is adapted from your5e/5e-srd-markdown (CC-BY-4.0), pinned at '''+UPSTREAM+'''. Class tables combine multiple header rows; monster ability tables are reformatted. Explicit saving-throw proficiencies have been restored and inferred non-proficient saving-throw rows omitted. Line-wrap hyphenation in thunderwave is joined. Related-reference links are supplied separately and do not modify the rules prose.\n\nPersonal notes belong in your own libraries; managed source pages are read-only. Source updates preserve the previous revision.\n'''
entries.insert(0,{'key':'about-sources','title':'About and Sources','category':'Core Rules','section':'Sources','sourcePath':'About','pages':[1],'coveragePages':[1],'markdown':about,'text':plain(about),'tags':['2014','SRD 5.1','attribution'],'contentHash':digest(about),'links':[]})
coverage={'sourceEntries':len(files),'upstreamSplitEntries':994,'supplementedIntroductions':5,'packEntries':len(entries),'categories':dict(collections.Counter(e['category']for e in entries)),'canonicalPages':len(pages),'sourcePdfHash':PDF_HASH,'intermediaryCommit':UPSTREAM,'headingOnlyMatches':low,'unresolvedEntries':unresolved,'formattingCorrections':corrections,'mappedPages':sorted({n for e in entries for n in e['coveragePages']})}
assert not unresolved,unresolved
bundle={'id':'srd-2014-5.1','name':'D&D 2014 — Rules Reference','edition':'2014','version':'1.0.0','sourceUrl':'https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf','sourceHash':PDF_HASH,'upstreamCommit':UPSTREAM,'categories':CATS,'coverage':coverage,'entriesHash':digest(json.dumps(entries,ensure_ascii=False,separators=(',',':'))),'entries':entries}
OUT.write_text(json.dumps(bundle,ensure_ascii=False,separators=(',',':'))+'\n');(ROOT/'reference/srd51/coverage.json').write_text(json.dumps(coverage,indent=2)+'\n')
print(json.dumps({k:v for k,v in coverage.items()if k not in ['formattingCorrections','headingOnlyMatches','mappedPages']}));print('heading-only',len(low),'mapped pages',len(coverage['mappedPages']))
