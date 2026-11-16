<script setup lang="ts">
import {ref,computed,watch} from 'vue';
import {Meteor} from 'meteor/meteor';
import {abilities,isAsi,table,catalog,mod} from '/imports/api/advancement/rules.mjs';
const props=defineProps<{modelValue:boolean;creatureId:string}>();
const emit=defineEmits(['update:modelValue']);
const context=ref<any>(null),error=ref(''),busy=ref(false),preview=ref<any>(null),notice=ref('');
const profile=ref<any>({}),choices=ref<any>({}),reviewed=ref(false);
const close=()=>emit('update:modelValue',false);
const classNames=['paladin','ranger','sorcerer','rogue','monk'];
const armorOptions=[{title:'Fixed AC (for example heavy armor)',value:'fixed'},{title:'Add Dexterity modifier (light or no armor)',value:'dex'},{title:'Dexterity modifier capped at +2 (medium armor)',value:'medium'},{title:'Monk: Dexterity + Wisdom, unarmored movement',value:'monk'}];
const profOptions=[{title:'Not proficient',value:0},{title:'Half proficiency (round down)',value:0.5},{title:'Proficient',value:1},{title:'Expertise',value:2}];
const nextLevel=computed(()=>(context.value?.state?.level||context.value?.baseline.level||1)+1);
const className=computed(()=>context.value?.state?.className||profile.value.className||'paladin');
const asi=computed(()=>isAsi(className.value,nextLevel.value));
const next=computed(()=>nextLevel.value<=20?table(className.value,nextLevel.value):null);
const eligibleSpells=computed(()=>{const max=next.value?.slots.reduce((n:number,count:number,i:number)=>count?i+1:n,0)||0;return (context.value?.spells||[]).filter((s:any)=>s.level<=max&&(choices.value.allowExtraSpells||s.classes.includes(className.value))&&!context.value?.baseline.spells.some((old:any)=>old.name===s.name)).map((s:any)=>({title:`${s.name} (${s.level||'cantrip'})`,value:s.name}));});
async function load(){busy.value=true;error.value='';preview.value=null;reviewed.value=false;try{
 context.value=await Meteor.callAsync('advancement.context',{creatureId:props.creatureId});const b=context.value.baseline,s=context.value.state;
 profile.value=s?{...s,skills:s.skills.map((x:any)=>({...x,reviewed:true}))}:{className:'paladin',subclass:'',armorMode:'fixed',skills:b.skills.map((x:any)=>({...x,reviewed:true})),casting:b.casting.map((x:any)=>({...x}))};
 choices.value={hpMode:'average',hpRoll:1,asiMode:'abilities',increases:Object.fromEntries(abilities.map((a:string)=>[a,0])),feat:{name:'',description:''},choices:'',allowExtraSpells:false,replaceSpells:[],spells:[],adjustments:[],resourceSpent:0,subclass:s?.subclass||''};
 }catch(e:any){error.value=e.reason||e.message;}finally{busy.value=false;}}
watch(()=>props.modelValue,open=>{if(open){context.value=null;notice.value='';void load();}});
watch(()=>profile.value.className,name=>{if(context.value?.state||!name)return;const saves:any={paladin:['wisdom','charisma'],ranger:['strength','dexterity'],sorcerer:['constitution','charisma'],rogue:['dexterity','intelligence'],monk:['strength','dexterity']};for(const s of profile.value.skills||[])if(s.save)s.multiplier=saves[name].includes(s.ability)?1:0;for(const caster of profile.value.casting||[])caster.ability=catalog.classes[name].castingAbility||caster.ability;});
async function makePreview(){busy.value=true;error.value='';try{const input={...choices.value,reviewed:reviewed.value,subclass:choices.value.subclass||profile.value.subclass};if(!asi.value||choices.value.asiMode!=='feat')delete input.feat;if(!asi.value)input.increases={};preview.value=await Meteor.callAsync('advancement.preview',{creatureId:props.creatureId,profile:profile.value,choices:input});}catch(e:any){error.value=e.reason||e.message;}finally{busy.value=false;}}
async function apply(){busy.value=true;error.value='';try{const result=await Meteor.callAsync('advancement.commit',{previewId:preview.value.previewId,confirmed:true});await load();notice.value=`Level ${result.level} applied. Your character and campaign links are preserved.`;}catch(e:any){error.value=e.reason||e.message;}finally{busy.value=false;}}
async function undo(){if(!window.confirm('Undo only the latest level-up? Its added features will become inactive. Existing notes, equipment and character links stay in place.'))return;busy.value=true;error.value='';try{await Meteor.callAsync('advancement.undo',{creatureId:props.creatureId,revision:context.value.state.revision});await load();notice.value='Latest level-up undone.';}catch(e:any){error.value=e.reason||e.message;}finally{busy.value=false;}}
</script>
<template>
<v-dialog :model-value="modelValue" max-width="1000" scrollable persistent @update:model-value="emit('update:modelValue',$event)">
<v-card title="Level up your character"><v-card-text>
 <v-alert v-if="error" type="error" class="mb-4">{{error}}</v-alert><v-alert v-if="notice" type="success" class="mb-4">{{notice}}</v-alert><v-progress-linear v-if="busy" indeterminate/>
 <template v-if="context">
 <p class="mb-4">2014 rules · single-class progression. Each level is previewed before it changes your sheet. Race, inventory, notes and existing feature descriptions stay with your character.</p>
 <template v-if="preview">
 <h2>Review level {{preview.summary.from}} → {{preview.summary.to}}</h2>
 <p class="my-4">Maximum HP: {{context.baseline.hp}} → {{preview.totals.hp}} · Proficiency: +{{preview.totals.proficiency}}</p>
 <v-table><thead><tr><th>Change</th><th>Gain</th></tr></thead><tbody><tr v-for="(change,i) in preview.changes" :key="i"><td>{{change.name}}</td><td>{{change.delta>0?'+':''}}{{change.delta}} <span v-if="change.newCounter">(new counter)</span></td></tr></tbody></v-table>
 <h3 class="mt-4">Class features</h3><p>{{preview.features.join(', ')||'No new named base-class feature at this level.'}}</p>
 <p class="my-4">Existing damage, spent spell slots and used hit dice are retained. New counters use the spent amount you entered. Descriptive attacks, conditional features and custom choices require manual resolution.</p>
 <v-alert type="info">Apply this only when your DM has awarded the level and you have reviewed any subclass, feat, spell and other choices.</v-alert>
 </template>
 <template v-else>
 <div class="advance-grid"><v-select v-model="profile.className" label="Class" :items="classNames" :disabled="!!context.state"/><v-text-field v-model="choices.subclass" label="Subclass (any published or custom option)" placeholder="For example Oath of Glory" hint="Your subclass is never restricted to the bundled SRD options." persistent-hint/></div>
 <v-expansion-panels class="my-4"><v-expansion-panel title="Review current proficiencies and ability-based bonuses"><v-expansion-panel-text>
 <p class="mb-4">Imported totals do not fully describe which bonuses were proficiency, expertise, armor or magic. Check these once so future ability and proficiency increases are applied correctly. Your current totals will not be replaced.</p>
 <v-select v-model="profile.armorMode" label="How your current armor uses abilities" :items="armorOptions" :disabled="!!context.state"/>
 <div v-for="s in profile.skills" :key="s.id" class="advance-grid"><p>{{s.name}} · current {{context.baseline.skills.find((x:any)=>x.id===s.id)?.value}}</p><v-select v-model="s.multiplier" :label="s.name+' proficiency'" :items="profOptions" :disabled="!!context.state"/></div>
 <v-select v-for="caster in profile.casting" :key="caster.id" v-model="caster.ability" :label="caster.name+' spellcasting ability'" :items="abilities" :disabled="!!context.state"/>
 </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
 <template v-if="next">
 <h2>Level {{context.baseline.level}} → {{nextLevel}}</h2><p class="my-3">{{next.features.join(', ')||'Hit points, resources and progression totals.'}}</p>
 <div class="advance-grid"><v-select v-model="choices.hpMode" label="Hit-point increase" :items="[{title:'Use fixed average',value:'average'},{title:'Enter a die roll',value:'roll'}]"/><v-text-field v-if="choices.hpMode==='roll'" v-model.number="choices.hpRoll" label="Hit die roll (before Constitution)" type="number" min="1" :max="catalog.classes[className].hitDie"/></div>
 <p class="mb-4">Constitution is added automatically. A Constitution modifier increase also updates HP for earlier levels.</p>
 <template v-if="asi"><v-select v-model="choices.asiMode" label="Ability improvement or feat" :items="[{title:'Two ability points',value:'abilities'},{title:'A feat (any published or custom option)',value:'feat'}]"/><div class="advance-grid"><v-text-field v-for="a in abilities" :key="a" v-model.number="choices.increases[a]" :label="a+' increase'" type="number" min="0" max="2"/></div><template v-if="choices.asiMode==='feat'"><v-text-field v-model="choices.feat.name" label="Feat name"/><v-textarea v-model="choices.feat.description" label="Feat benefits and choices" hint="Enter a granted ability point above; use approved adjustments below for numeric benefits." persistent-hint/></template></template>
 <v-switch v-if="context.baseline.casting.length" v-model="choices.allowExtraSpells" label="Include additional subclass, feat or DM-approved spells" hint="This permits other class lists and additional spells known; check your rules source." persistent-hint/>
 <v-select v-if="['sorcerer','ranger'].includes(className)" v-model="choices.replaceSpells" label="Replace one existing known spell (optional)" :items="context.baseline.spells.filter((s:any)=>s.level>0).map((s:any)=>({title:s.name,value:s.id}))" multiple clearable/>
 <v-autocomplete v-if="context.baseline.casting.length" v-model="choices.spells" label="Add SRD spells or cantrips" :items="eligibleSpells" multiple chips clearable/>
 <p v-if="context.baseline.casting.length" class="mb-4">Spell slots after this level: {{next.slots.join(' / ')}}.<span v-if="next.known"> Base-class spells known: {{next.known}}.</span> Choose spells allowed by your class and subclass. Other spell sources remain available through the sheet’s normal spell editor.</p>
 <v-textarea v-model="choices.choices" label="Subclass features, spells, expertise, metamagic and other choices" hint="Record your selected options and how conditional benefits work. Custom rules are recorded explicitly; their mechanics are not guessed." persistent-hint rows="4"/>
 <v-expansion-panels class="my-4"><v-expansion-panel title="Additional approved numeric benefits"><v-expansion-panel-text><p>Use for a feat or subclass benefit that changes an existing statistic. Do not repeat increases already shown in the preview.</p><div v-for="(a,i) in choices.adjustments" :key="i" class="advance-grid"><v-text-field v-model="a.name" label="Benefit name"/><v-select v-model="a.variable" label="Statistic" :items="context.baseline.targets.map((t:any)=>({title:t.name,value:t.variable}))"/><v-text-field v-model.number="a.delta" label="Increase or decrease" type="number"/><v-btn @click="choices.adjustments.splice(i,1)">Remove benefit</v-btn></div><v-btn @click="choices.adjustments.push({name:'',variable:'',delta:0})">Add benefit</v-btn></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
 <v-text-field v-if="['paladin','monk','sorcerer'].includes(className)" v-model.number="choices.resourceSpent" label="If a class-resource counter is new: points already spent" type="number" min="0" hint="Lay on Hands, ki or sorcery points. Existing counters retain their usage." persistent-hint/>
 <v-checkbox v-model="reviewed" label="I reviewed the current proficiencies, level choices and resource usage with my rules or DM."/>
 </template><v-alert v-else type="info">This character has reached level 20.</v-alert>
 <template v-if="context.state?.history.length"><h3 class="mt-5">Level-up history</h3><p v-for="step in context.state.history" :key="step.bundleId">Level {{step.level}} · +{{step.hpGain}} maximum HP · {{new Date(step.createdAt).toLocaleDateString()}}</p><v-btn class="mt-3" variant="outlined" :disabled="busy" @click="undo">Undo latest level-up</v-btn></template>
 </template></template>
</v-card-text><v-card-actions class="flex-wrap"><v-btn :disabled="busy" @click="close">Close</v-btn><v-spacer/><template v-if="preview"><v-btn :disabled="busy" @click="preview=null">Back to choices</v-btn><v-btn color="primary" :loading="busy" @click="apply">Apply level {{preview.summary.to}}</v-btn></template><v-btn v-else-if="context&&next" color="primary" :disabled="busy||!reviewed" @click="makePreview">Preview level-up</v-btn></v-card-actions></v-card>
</v-dialog>
</template>
<style scoped>.advance-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:center}@media(max-width:650px){.advance-grid{grid-template-columns:1fr}}</style>
