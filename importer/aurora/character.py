"""Versioned, inert current-sheet extraction. Required numeric gaps are fatal."""
import re
from . import VERSION, SCHEMA_VERSION
from .content import CompendiumQuery
from .query import Query, ABILITIES, SKILLS
from .secure import CHAR_LIMIT, decode, digest, fail, number, text, xml

def bounded(value, field, limit=10000):
    if len(value)>limit:fail('TEXT_LIMIT',field,'Imported text exceeds its supported length.')
    return value

def extract(source, files):
    body=decode(source, CHAR_LIMIT)
    root=xml(body,'character')
    if root.tag!='character':fail('CHARACTER_ROOT','character','Choose an Aurora character XML file.')
    content=CompendiumQuery(files)
    q=Query(root,content)
    warnings=[]
    def warn(code,field,message):
        warning=dict(severity='warning',code=code,field=field,message=message)
        if warning not in warnings:warnings.append(warning)
    name=bounded(text(root.find('./display-properties/name')),'name',128)
    if not name:fail('MISSING_NAME','name','The character has no saved name.')
    # No 2024 library is silently treated as 2014.
    marker=root.get('rulesVersion',root.get('rules-version','2014'))
    if marker!='2014':fail('UNSUPPORTED_RULES_VERSION','rulesVersion','Only 2014 snapshot semantics are supported.')
    hp,dice=q.hp()
    if hp<1:fail('INVALID_HP','hitPoints','Maximum hit points must be positive.')
    abilities={a:q.get_variable_value(a+':score') for a in ABILITIES}
    saves={a:(q.get_variable_value(a+':save') if a+':save' in q.terms else q.get_variable_value(a+':modifier')+q.get_variable_value(a+':save:proficiency')+q.get_variable_value(a+':save:misc')) for a in ABILITIES}
    skills={}
    for skill,ability in SKILLS.items():
        bonus=q.get_variable_value(skill) if skill in q.terms else q.get_variable_value(ability+':modifier')+q.get_variable_value(skill+':proficiency')+q.get_variable_value(skill+':misc')
        skills[skill]=dict(bonus=bonus,passive=10+bonus+q.get_variable_value(skill+':passive'))
    movement={}
    for mode in ['walk','climb','fly','swim','burrow']:
        key='speed' if mode=='walk' else 'speed:'+mode
        if key in q.terms or key in q.base:movement[mode]=q.get_variable_value(key)
    if 'walk' not in movement:fail('UNRESOLVED_STAT','movement','Walking speed requires an explicit content definition.')
    inventory=[]
    for item in q.equipment:
        element=content.quick_query_id(item.get('id'))
        if element is None:fail('MISSING_CONTENT','equipment','Missing inventory element: '+str(item.get('id')))
        inventory.append(dict(id=item.get('id'),name=bounded(text(item.find('./details/name')) or element.get('name','Item'),'inventory.name',128),
            quantity=number(item.get('amount','1'),'inventory.quantity',0,100000),equipped=text(item.find('./equipped')).lower()=='true',
            attuned=text(item.find('./attunement')).lower()=='true',description=bounded(content.describe(element),'inventory.description'),
            notes=bounded(text(item.find('./details/notes')),'inventory.notes')))
    currency={}
    for key in ['copper','silver','electrum','gold','platinum']:
        raw=text(root.find('./build/input/currency/'+key))
        currency[key]=number(raw or '0','currency.'+key,0,1000000)
    attacks=[]
    for attack in root.findall('./attacks/attack'):
        attacks.append(dict(name=bounded(attack.get('name','Attack'),'attacks.name',128),
            attack=bounded(attack.get('attack',''),'attacks.attack',512),damage=bounded(attack.get('damage',''),'attacks.damage',512),
            range=bounded(attack.get('range',''),'attacks.range',512),description=bounded(text(attack.find('description')),'attacks.description')))
    if attacks:warn('MANUAL_ATTACKS','attacks','Attack and damage text is preserved for manual use; no arbitrary source formula is executed.')
    casters=[];resources=[]
    for index,caster in enumerate(root.findall('./magic/spellcasting')):
        title=bounded(caster.get('name','Spellcasting'),'spellcasting.name',128)
        ability=caster.get('ability','').lower()
        if ability not in ABILITIES:fail('SPELLCASTING_ABILITY','spellcasting','Spellcasting ability is absent or unsupported.')
        # Aurora stores final values; do not add proficiency a second time.
        attack=number(caster.get('attack'),'spellcasting.attack',-20,50)
        dc=number(caster.get('dc'),'spellcasting.dc',0,50)
        spells=[]
        for spell in caster.findall('.//spell'):
            element=content.quick_query_id(spell.get('id'))
            if element is None:fail('MISSING_CONTENT','spells','Missing spell element: '+str(spell.get('id')))
            flags={}
            for attr in ['prepared','known','always-prepared']:
                raw=spell.get(attr)
                if raw not in [None,'true','false']:fail('SPELL_FLAG','spells','Preparation flags must be explicit booleans.')
                flags[attr]=None if raw is None else raw=='true'
            if any(v is None for v in flags.values()):warn('UNKNOWN_PREPARATION','spells','Some spell preparation/known flags are not saved; review them after import.')
            rawlevel=spell.get('level') or content.read_setter(element,'level')
            school=(content.read_setter(element,'school') or '').lower()
            if school not in ['abjuration','conjuration','divination','enchantment','evocation','illusion','necromancy','transmutation']:
                fail('SPELL_SCHOOL','spells','Spell school is missing or unsupported; the importer will not invent one.')
            spells.append(dict(id=spell.get('id'),name=bounded(element.get('name','Spell'),'spell.name',128),level=number(rawlevel,'spell.level',0,9),
                school=school,prepared=flags['prepared'],known=flags['known'],alwaysPrepared=flags['always-prepared'],description=bounded(content.describe(element),'spell.description')))
        slots=caster.find('slots')
        if slots is not None:
            pool=caster.get('pool')
            if pool not in ['spellcasting','pact']:
                # Separate multiple casters may duplicate shared totals. Never guess.
                if len(root.findall('./magic/spellcasting'))>1:fail('AMBIGUOUS_SLOTS','spellcasting','Multiple casting sources require explicit spellcasting/pact pool labels.')
                pool='spellcasting'
            for level in range(1,10):
                raw=slots.get('s'+str(level))
                if raw is None:continue
                count=number(raw,'slots',0,30)
                if count:resources.append(dict(name=title+' — level '+str(level),pool=pool,level=level,total=count,current=None,reset='shortRest' if pool=='pact' else 'longRest'))
        casters.append(dict(name=title,ability=ability,attack=attack,dc=dc,spells=spells))
    if len({(r['pool'],r['level']) for r in resources})!=len(resources):fail('AMBIGUOUS_SLOTS','slots','Shared spell slot pools must occur only once.')
    features=[]
    for source_node in root.findall('./build/sum/element'):
        node=content.quick_query_id(source_node.get('id'))
        if node is None:continue
        if node.get('type') in ['Feature','Class Feature','Racial Trait','Feat','Condition','Vision','Ability Score Improvement','Proficiency','Language','Alignment','Size']:
            features.append(dict(id=source_node.get('id'),name=bounded(node.get('name','Feature'),'features.name',128),description=bounded(content.describe(node),'features.description')))
            if node.get('type') not in ['Ability Score Improvement','Proficiency','Language','Alignment','Size']:
                warn('MANUAL_FEATURES','features','Feature descriptions, conditions and senses require manual use; unrecognized active effects/resources are not automated.')
    notes=[bounded(text(n),'notes') for n in root.findall('./build/input/notes/note') if text(n)]
    warn('SNAPSHOT_ONLY','character','This is a 2014 current-sheet snapshot. Level-up, equipment changes and ongoing conditional effects require manual review.')
    warn('PLAY_STATE_UNKNOWN','resources','Aurora does not reliably save current damage/resource use. Import initializes HP, hit dice and slots to full, with zero temporary HP.')
    result=dict(schemaVersion=SCHEMA_VERSION,rulesVersion='2014',identity=dict(name=name,level=q.level,
        race=bounded(text(root.find('./display-properties/race')),'race',128),classes=[dict(id=k,name=content.quick_query_id(k).get('name',k),level=v) for k,v in q.classes.items()]),
        abilities=abilities,saves=saves,skills=skills,armorClass=q.ac(),initiative=q.get_variable_value('initiative') if 'initiative' in q.terms else q.get_variable_value('dexterity:modifier')+q.get_variable_value('initiative:misc'),
        proficiency=q.get_variable_value('proficiency'),movement=movement,hitPoints=dict(maximum=hp,current=None,temporary=None),hitDice=dice,
        attacks=attacks,inventory=inventory,currency=currency,spellcasting=casters,resources=resources,features=features,notes=notes,
        provenance=dict(parserVersion=VERSION,sourceHash=digest(body),contentHash=content.hash,builtin=content.builtin,privateFiles=content.manifest,contributions=q.contributions),diagnostics=warnings)
    return result
