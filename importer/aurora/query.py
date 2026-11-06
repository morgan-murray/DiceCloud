# SPDX-License-Identifier: MPL-2.0
# Headless adaptation of Flare Query's stat/bonus and variable model, 3905811.
# Replaces implicit zeroes, mutable globals, filesystem parsing and unbounded logic.
import math
import re
from collections import defaultdict
from .content import ID
from .logic import LogicSolver
from .secure import fail, number, text

ABILITIES = ['strength','dexterity','constitution','intelligence','wisdom','charisma']
SKILLS = {'athletics':'strength','acrobatics':'dexterity','sleight of hand':'dexterity','stealth':'dexterity','arcana':'intelligence','history':'intelligence','investigation':'intelligence','nature':'intelligence','religion':'intelligence','animal handling':'wisdom','insight':'wisdom','medicine':'wisdom','perception':'wisdom','survival':'wisdom','deception':'charisma','intimidation':'charisma','performance':'charisma','persuasion':'charisma'}

class Query:
    def __init__(self, root, content):
        self.root, self.compendium = root, content
        self.terms, self.cache, self.active, self.contributions = defaultdict(list), {}, set(), {}
        self.ids = set()
        self.classes, self.class_context = {}, {}
        self.level = number(text(root.find('./display-properties/level')), 'level', 1, 20)
        self.base = {a:number(text(root.find('./build/abilities/'+a)), a, 1, 30) for a in ABILITIES}
        self.base.update({a+':max':20 for a in ABILITIES})
        self.base.update({a+':score:set':0 for a in ABILITIES})
        self.base.update(level=self.level, proficiency=2+(self.level-1)//4)
        for name in ['hp','ac:misc','ac:shield','initiative:misc','speed:misc','attunement:max']:
            self.base[name] = 0
        for name in ABILITIES:
            self.base[name+':save:proficiency'] = self.base[name+':save:misc'] = 0
        for name in SKILLS:
            self.base[name+':proficiency'] = self.base[name+':misc'] = self.base[name+':passive'] = 0
        self._levels()
        selected = list(root.findall('./build/sum/element'))
        self.equipment = list(root.findall('./equipment/item'))
        for node in selected + self.equipment + list(root.findall('./magic//spell')):
            key = node.get('id')
            if key and not ID.fullmatch(key): fail('INVALID_ELEMENT_ID','character','Character element ID is invalid.')
            if key: self.ids.add(key)
        for item in self.equipment:
            for adorn in item.findall('./items/adorner'):
                if adorn.get('id'): self.ids.add(adorn.get('id'))
        self.equipped = {item.get('id') for item in self.equipment if text(item.find('./equipped')).lower() == 'true'}
        self.attuned = {item.get('id') for item in self.equipment if text(item.find('./attunement')).lower() == 'true'}
        self._rules(selected)
        self._movement()

    def _movement(self):
        # Aurora stores innate movement; its desktop engine creates final speed.
        # Reconstruct the formula explicitly instead of silently returning zero.
        for suffix in ['', ':climb', ':fly', ':swim', ':burrow']:
            innate='innate speed'+suffix
            final='speed'+suffix
            if innate not in self.terms and innate not in self.base: continue
            if not any(t['value'] in [innate, innate+':calculation'] for t in self.terms.get(final,[])):
                self.terms[final].append(dict(value=innate,bonus='base',maximum=None,minimum=None,requirements=None,equipped=None,source='builtin:movement'))
                for extra in [innate+':misc', final+':misc']:
                    if extra in self.terms and not any(t['value']==extra for t in self.terms[final]):
                        self.terms[final].append(dict(value=extra,bonus=None,maximum=None,minimum=None,requirements=None,equipped=None,source='builtin:movement'))

    def _levels(self):
        levels = self.root.findall('./build/elements/element[@type="Level"]')
        if not levels or len(levels) != self.level: fail('BUILD_LEVELS','level','Build levels must agree with the displayed character level.')
        main = None
        self.rolls = {}
        for index, node in enumerate(levels, 1):
            if number(node.get('name'), 'build.level', 1, 20) != index: fail('BUILD_LEVELS','level','Build level order is ambiguous.')
            first = node.find('./element[@type="Class"]')
            if index == 1:
                main = first.get('registered', first.get('id')) if first is not None else None
                if not main: fail('BUILD_CLASS','class','First level must identify a class.')
            key = node.get('class') if node.get('multiclass') == 'true' else main
            if not key or not ID.fullmatch(key): fail('BUILD_CLASS','class','Invalid class reference.')
            self.classes[key] = self.classes.get(key, 0) + 1
            if node.get('rndhp'):
                self.rolls[key] = [number(v,'hitPoints.roll',1,100) for v in node.get('rndhp').split(',')]
            def visit(child, context):
                if child.get('type') in ['Class','Multiclass']:
                    context = child.get('registered',child.get('id',context))
                selected_id = child.get('registered', child.get('id'))
                if selected_id:
                    old = self.class_context.get(selected_id)
                    if old is not None and old != context: self.class_context[selected_id] = 'ambiguous'
                    else: self.class_context[selected_id] = context
                for inner in child: visit(inner, context)
            visit(node, key)
        self.main_class = main
        for key, count in self.classes.items():
            entry = self.compendium.quick_query_id(key)
            if entry is None: fail('MISSING_CONTENT','content','Missing class element: '+key)
            name = entry.get('name','').lower()
            self.base['level:'+name] = count
            self.base['level:'+key] = count

    def _rules(self, selected):
        seen = set()
        for source in selected + self.equipment:
            key = source.get('id')
            is_item = source in self.equipment
            if is_item and text(source.find('./equipped')).lower() != 'true': continue
            if not key or (key in seen and source.get('type') != 'Ability Score Improvement'): continue
            seen.add(key)
            node = self.compendium.quick_query_id(key)
            if node is None:
                if source.get('type') in ['Alignment','Size','Language','Vision'] or key == 'ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP': continue
                fail('MISSING_CONTENT','content','Missing selected element: '+key)
            is_item = source in self.equipment
            if is_item and key not in self.equipped: continue
            entries = [(key,node)]
            if is_item:
                for adorn in source.findall('./items/adorner'):
                    ident=adorn.get('id'); entry=self.compendium.quick_query_id(ident)
                    if entry is None: fail('MISSING_CONTENT','equipment','Missing item adorner: '+str(ident))
                    entries.append((ident,entry))
            for ident, entry in entries:
                if is_item and (self.compendium.read_setter(entry,'attunement') or '').lower() in ['true','required'] and text(source.find('./attunement')).lower() != 'true': continue
                context = self.class_context.get(key)
                for rule in entry.findall('./rules/stat'):
                    allowed={'name','value','bonus','maximum','minimum','level','requirements','equipped','inline','merge','alt'}
                    if set(rule.attrib)-allowed: fail('UNSUPPORTED_RULE','rules','Unsupported numeric rule attributes in '+ident)
                    name, value = rule.get('name'), rule.get('value')
                    if name and not name.startswith('level:ID_'): name=name.lower()
                    if not name or not value or len(name)>150 or len(value)>150: fail('UNSUPPORTED_RULE','rules','Invalid numeric rule in '+ident)
                    if rule.get('inline') == 'true':
                        # Inline values describe strings rather than numeric totals.
                        continue
                    if rule.get('level'):
                        if context == 'ambiguous': fail('AMBIGUOUS_CLASS_CONTEXT','rules','A level-gated feature belongs to multiple classes.')
                        count = self.classes.get(context,self.level)
                        if number(rule.get('level'),'rules.level',1,20)>count: continue
                    self.terms[name].append(dict(value=value,bonus=rule.get('bonus'),maximum=rule.get('maximum'),minimum=rule.get('minimum'),requirements=rule.get('requirements'),equipped=rule.get('equipped'),source=ident))

    def requirement(self, expression):
        expression=expression.replace('||',' or ').replace('&&',' and ').replace(',',' and ').replace('!',' not ')
        expression=re.sub(r'ID_[A-Za-z0-9_]+',lambda m:str(m.group(0) in self.ids),expression)
        short=dict(zip(['str','dex','con','int','wis','cha'],ABILITIES))
        def condition(match):
            name,value=match.group(1),match.group(2)
            if name.startswith('type:'):
                return str(any(x.get('type')==name[5:] for x in self.root.iter('element')))
            var=short.get(name,name)
            if var in ABILITIES: var+=':score'
            return str(self.get_variable_value(var)>=number(value,'requirements',-1000,1000))
        expression=re.sub(r'\[([A-Za-z :_-]+):([+-]?\d+)\]',condition,expression)
        expression=re.sub(r'\[type:([A-Za-z ]+)\]',lambda m:str(any(n.get('type')==m.group(1) for n in self.root.iter('element'))),expression)
        return LogicSolver.solve_expression(expression)

    def equipped_requirement(self, expression):
        expression=expression.replace('||',' or ').replace('&&',' and ').replace(',',' and ').replace('!',' not ')
        armor=[]; shield=[]; weapons=[]
        for key in self.equipped:
            node=self.compendium.quick_query_id(key)
            if node is None: continue
            kind=(self.compendium.read_setter(node,'armor') or '').lower()
            if kind=='shield': shield.append(node)
            elif node.get('type')=='Armor': armor.append(kind)
            elif node.get('type')=='Weapon': weapons.append(node)
        def condition(m):
            kind,condition=m.group(1).lower(),m.group(2).lower()
            values=armor if kind=='armor' else shield if kind=='shield' else weapons
            if kind not in ['armor','shield','primary','secondary']: fail('UNSUPPORTED_REQUIREMENT','equipment','Unknown equipment requirement.')
            if kind in ['primary','secondary']: fail('UNSUPPORTED_REQUIREMENT','equipment','Primary/secondary weapon conditions require explicit hand placement and manual resolution.')
            return str(not values if condition=='none' else bool(values) if condition=='any' else condition in values)
        return LogicSolver.solve_expression(re.sub(r'\[([a-z]+):([a-z -]+)\]',condition,expression))

    def get_variable_value(self, name):
        name=name.strip()
        if not name.startswith('level:ID_'): name=name.lower()
        if re.fullmatch(r'[+-]?\d+',name): return number(name,'rules.value',-100000,100000)
        if len(name)>150 or len(self.active)>40: fail('EXPRESSION_LIMIT','rules','Numeric dependency limit exceeded.')
        if name.startswith('-'): return -self.get_variable_value(name[1:])
        if name.startswith('+'): return self.get_variable_value(name[1:])
        if name.endswith(':half:up'): return math.ceil(self.get_variable_value(name[:-8])/2)
        if name.endswith(':half'): return math.floor(self.get_variable_value(name[:-5])/2)
        if name in self.cache: return self.cache[name]
        if name in self.active: fail('CYCLIC_RULE','rules','Cyclic numeric dependency: '+name)
        self.active.add(name)
        try:
            if name.endswith(':modifier') and name[:-9] in ABILITIES:
                value=(self.get_variable_value(name[:-9]+':score')-10)//2
            elif name.endswith(':score') and name[:-6] in ABILITIES:
                ability=name[:-6];value=max(min(self.get_variable_value(ability),self.get_variable_value(ability+':max')),self.get_variable_value(ability+':score:set'))
            else:
                if name not in self.base and name not in self.terms: fail('UNRESOLVED_STAT','rules','Unresolved numeric reference: '+name)
                value=self.base.get(name,0); groups={}; contributions=[]
                if name.endswith(':max') and name[:-4] in ABILITIES and any(t['value']=='20' for t in self.terms.get(name,[])): value=0
                for term in self.terms.get(name,[]):
                    if term['requirements'] and not self.requirement(term['requirements']): continue
                    if term['equipped'] and not self.equipped_requirement(term['equipped']): continue
                    v=self.get_variable_value(term['value'])
                    if term['maximum']: v=min(v,self.get_variable_value(term['maximum']))
                    if term['minimum']: v=max(v,self.get_variable_value(term['minimum']))
                    if term['bonus'] is None: value+=v
                    else: groups[term['bonus']]=max(groups.get(term['bonus'],-1000000),v)
                    contributions.append(dict(source=term['source'],value=v,bonus=term['bonus']))
                value+=sum(groups.values());self.contributions[name]=contributions
            if not -100000 <= value <= 1000000: fail('INVALID_NUMBER','rules','Computed total is out of range.')
            self.cache[name]=value
            return value
        finally: self.active.remove(name)

    def hp(self):
        con=self.get_variable_value('constitution:modifier');total=0;dice=[]
        average='ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP' in self.ids
        for key,count in self.classes.items():
            node=self.compendium.quick_query_id(key)
            size=self.compendium.read_setter(node,'hd') or self.compendium.read_setter(node,'hitDice')
            size=number((size or '').lower().lstrip('d'),'hitDice',4,12)
            if size not in [4,6,8,10,12]: fail('HIT_DICE','hitDice','Unsupported hit die size.')
            rolls=self.rolls.get(key,[])
            if average:
                points=(size if key==self.main_class else size//2+1)+(count-1)*(size//2+1)
                total+=max((size if key==self.main_class else size//2+1)+con,1)+(count-1)*max(size//2+1+con,1)
            else:
                if len(rolls)!=count or any(roll>size for roll in rolls): fail('HP_ROLLS','hitPoints','Saved hit-point rolls are absent or inconsistent with class levels.')
                total+=sum(max(1,r+con) for r in rolls)
            dice.append(dict(name=node.get('name',key),count=count,size='d'+str(size),remaining=None))
        return total+self.get_variable_value('hp'),dice

    def ac(self):
        dex=self.get_variable_value('dexterity:modifier');armors=[];shields=[]
        for item in self.equipment:
            key=item.get('id')
            if text(item.find('./equipped')).lower() != 'true': continue
            node=self.compendium.quick_query_id(key)
            if node is None or node.get('type')!='Armor': continue
            kind=(self.compendium.read_setter(node,'armor') or '').lower()
            if kind=='shield': shields.append(node)
            elif kind in ['light','medium','heavy']: armors.append((kind,node))
            else: fail('ARMOR_KIND','armorClass','Unknown equipped armor category.')
        if len(armors)>1 or len(shields)>1: fail('ARMOR_AMBIGUOUS','armorClass','Equipped armor/shield selection is ambiguous.')
        def display_base(node):
            value=self.compendium.read_setter(node,'armorClass') or self.compendium.read_setter(node,'ac')
            # Display text is never evaluated; only these known SRD forms parse.
            match=re.fullmatch(r'([+]?[0-9]{1,2})(?: \+ Dex modifier(?: \(max 2\))?)?',value or '',re.I)
            if not match: fail('ARMOR_AC','armorClass','Armor needs numeric rules or a supported armorClass setter.')
            return number(match.group(1),'armorClass',0,50)
        base=10+dex
        if armors:
            kind,node=armors[0]
            armor=self.get_variable_value('ac:armored:armor') if 'ac:armored:armor' in self.terms else display_base(node)
            cap=self.get_variable_value('ac:armored:dexterity:cap') if 'ac:armored:dexterity:cap' in self.terms else 2
            armor_dex=self.get_variable_value('ac:armored:dexterity') if 'ac:armored:dexterity' in self.terms else (dex if kind=='light' else min(dex,cap) if kind=='medium' else 0)
            base=armor+armor_dex
            for extra in ['ac:armored:enhancement','ac:armored:misc']:
                if extra in self.terms: base+=self.get_variable_value(extra)
        # A baseline competes with class-specific calculation bonuses rather than
        # being added to them. Invalid cyclic references still fail closed.
        self.terms['ac:calculation'].append(dict(value=str(base),bonus='calculation',maximum=None,minimum=None,requirements=None,equipped=None,source='builtin:armor'))
        self.cache.pop('ac:calculation',None)
        for term in self.terms['ac:calculation']:
            if term['value'] in ['ac:shield','ac:misc']:
                fail('UNSUPPORTED_ARMOR_ENGINE','armorClass','Legacy combined armor-engine definitions conflict with the built-in calculation.')
        calculation=self.get_variable_value('ac:calculation')
        shield=self.get_variable_value('ac:shield') if 'ac:shield' in self.terms else (display_base(shields[0]) if shields else 0)
        misc=self.get_variable_value('ac:misc')
        if 'ac' in self.terms:
            if any(t['value'].lower()=='ac:calculation' for t in self.terms['ac']):
                fail('UNSUPPORTED_ARMOR_ENGINE','armorClass','A second final armor engine is not supported; use the built-in calculation.')
            return calculation+shield+misc+self.get_variable_value('ac')
        return calculation+shield+misc
