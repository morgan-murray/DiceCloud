import json,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
classes={}
for name,die,ability in [('Paladin',10,'charisma'),('Ranger',10,'wisdom'),('Sorcerer',6,'charisma'),('Rogue',8,None),('Monk',8,None)]:
 text=(root/f'reference/srd51/markdown/Classes/{name}/{name}.md').read_text()
 rows=[]
 headers=None
 for line in text.splitlines():
  if line.startswith('| Level '): headers=[s.strip() for s in line.strip('|').split('|')];continue
  if headers and len(rows)<20 and re.match(r'\| \d+(st|nd|rd|th)',line):
   cells=[s.strip() for s in line.strip('|').split('|')]; row=dict(zip(headers,cells));level=int(re.match(r'\d+',cells[0])[0]);data={'level':level,'proficiency':int(row['Proficiency Bonus']),'features':[] if row['Features']=='—' else row['Features'].split(', '),'slots':[]}
   start=next((i for i,h in enumerate(headers) if h.startswith('Spell Slots')),None)
   if start is not None:data['slots']=[0 if s=='—' else int(s) for s in cells[start:]]
   for key,label in [('known','Spells Known'),('cantrips','Cantrips Known')]:
    if label in row:data[key]=0 if row[label]=='—' else int(row[label])
   rows.append(data)
 assert len(rows)==20,(name,len(rows))
 sections={}
 for m in re.finditer(r'^### (.+)\n(.*?)(?=^### |\Z)',text,re.M|re.S):sections[m[1]]=m[2].strip()
 classes[name.lower()]={'name':name,'hitDie':die,'castingAbility':ability,'levels':rows,'descriptions':sections}
spell_classes={}
# Read canonical PDF lines: the older Markdown conversion omits some apostrophe names.
normalize=lambda text:text.lower().replace('’', "'").strip()
pdf_text='\n'.join(json.loads((root/'reference/srd51/canonical-pages.json').read_text()))
for name,next_name in [('Paladin','Ranger'),('Ranger','Sorcerer'),('Sorcerer','Warlock')]:
 section=pdf_text.split(name+' Spells\n',1)[1].split(next_name+' Spells\n',1)[0]
 for title in section.splitlines():
  title=title.strip()
  if not title or re.match(r'^(?:[1-9](?:st|nd|rd|th) Level|Cantrips)',title):continue
  spell_classes.setdefault(normalize(title),[]).append(name.lower())
spells=[]
for p in (root/'reference/srd51/markdown/Spells').rglob('*.md'):
 text=p.read_text();m=re.search(r'(?im)^(?:\*?\*?)(\d)[a-z-]*(?:-level| level)|^.*cantrip',text)
 # Catalog metadata is available from the converted entry's opening line.
 levelmatch=re.search(r'(?im)([1-9])(?:st|nd|rd|th)-level',text)
 level=int(levelmatch[1]) if levelmatch else 0
 spells.append({'name':p.stem,'classes':spell_classes.get(normalize(p.stem),[]),'level':level,'description':text[:18000]})
# Original SRD text is included only under its existing CC-BY attribution.
out={'schemaVersion':1,'rulesVersion':'2014','source':'https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf','classes':classes,'spells':spells}
(root/'app/imports/api/advancement/catalog.mjs').write_text('export default '+json.dumps(out,ensure_ascii=False,indent=2)+';\n')
print('Generated five 20-level class tables and',len(spells),'SRD spells.')
