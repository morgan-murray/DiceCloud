<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { Meteor } from 'meteor/meteor';
import { useRoute, useRouter } from 'vue-router';
import MarkdownText from '/imports/client/ui/components/MarkdownText.vue';

type Book = { id: string; name: string; version: string; edition: string; counts: Record<string, number>; categories: string[]; canManage: boolean; previous: boolean; entryCount: number; sourceUrl: string; libraryId: string };
type Page = { key: string; title: string; category: string; section: string; markdown: string; pages: number[]; links: { key: string; title: string }[] };
const route = useRoute(), router = useRouter();
const books = ref<Book[]>([]), catalog = ref<any>(null), busy = ref(false), loading = ref(false), error = ref(''), notice = ref(''), entry = ref<Page | null>(null), results = ref<any[]>([]), total = ref(0), readers = ref<any[]>([]), shareOpen = ref(false), readerName = ref('');
const query = ref(String(route.query.q || '')), category = ref(String(route.query.category || ''));
const selected = computed(() => books.value.find(b => b.id === route.query.pack) || books.value[0]);
const page = computed(() => Math.max(0, Number(route.query.page) || 0));
const categories = computed(() => [{ title: 'All categories', value: '' }, ...(selected.value?.categories || []).map(c => ({ title: `${c} (${selected.value?.counts[c] || 0})`, value: c }))]);
let timer: ReturnType<typeof setTimeout> | undefined, request = 0;
async function call(name: string, arg?: unknown): Promise<any> { return Meteor.callAsync('rulesReference.' + name, ...(arg === undefined ? [] : [arg])); }
function navigate(change: Record<string, any>) { return router.push({ name: 'rulesReference', query: { ...route.query, ...change } }); }
async function refresh() {
  [catalog.value, books.value] = await Promise.all([call('catalog'), call('list')]);
  if (books.value.length && !books.value.some(b => b.id === route.query.pack)) await router.replace({ name: 'rulesReference', query: { ...route.query, pack: books.value[0].id } });
}
async function load() {
  const n = ++request, book = selected.value;
  if (!book) { results.value = []; entry.value = null; return; }
  loading.value = true; error.value = '';
  try {
    const [found, opened] = await Promise.all([
      call('search', { packId: book.id, query: String(route.query.q || ''), category: String(route.query.category || ''), page: page.value }),
      route.query.entry ? call('entry', { packId: book.id, key: String(route.query.entry) }) : Promise.resolve(null),
    ]);
    if (n !== request) return;
    results.value = found.results; total.value = found.total; entry.value = opened;
  } catch (e: any) { if (n === request) { error.value = e.reason || e.message; results.value = []; entry.value = null; total.value = 0; } }
  finally { if (n === request) loading.value = false; }
}
async function mutate(name: string, arg?: unknown) {
  busy.value = true; error.value = ''; notice.value = '';
  try { const result = await call(name, arg); await refresh(); await load();
    if (name === 'install') notice.value = result.unchanged ? 'Your reference library is up to date.' : `${result.changes.added} pages added, ${result.changes.changed} updated, ${result.changes.removed} removed.`;
  }
  catch (e: any) { error.value = e.reason || e.message; }
  finally { busy.value = false; }
}
function search() { clearTimeout(timer); timer = setTimeout(() => { void navigate({ q: query.value || undefined, category: category.value || undefined, page: undefined }); }, 250); }
async function showSharing() {
  if (!selected.value?.canManage) return;
  try { readers.value = await call('readers', { packId: selected.value.id }); shareOpen.value = true; }
  catch (e: any) { error.value = e.reason || e.message; }
}
async function share(username: string, remove = false) {
  busy.value = true;
  try { await call('share', { packId: selected.value!.id, username, remove }); readers.value = await call('readers', { packId: selected.value!.id }); readerName.value = ''; }
  catch (e: any) { error.value = e.reason || e.message; }
  finally { busy.value = false; }
}
function remove() { if (window.confirm('Remove this managed reference collection and its retained versions? Your characters and personal libraries will remain.')) void mutate('remove', { packId: selected.value!.id }); }
watch(() => route.fullPath, () => { query.value = String(route.query.q || ''); category.value = String(route.query.category || ''); void load(); });
onMounted(async () => { try { await refresh(); await load(); } catch (e: any) { error.value = e.reason || e.message; } });
onBeforeUnmount(() => { clearTimeout(timer); request++; });
</script>

<template>
  <v-container fluid class="rules-reference">
    <div class="reference-header">
      <div><h1>Rules Reference</h1><p>D&amp;D 2014 · System Reference Document 5.1</p></div>
      <v-btn v-if="!selected?.canManage" color="primary" :loading="busy" :disabled="busy || !catalog?.enabled" @click="mutate('install', {})">Add 2014 rules to my library</v-btn>
      <div v-else class="reference-actions">
        <v-btn variant="outlined" :disabled="busy" @click="showSharing">Share</v-btn>
        <v-btn variant="outlined" :loading="busy" :disabled="busy || !catalog?.enabled" @click="mutate('install', {})">Check for updates</v-btn>
        <v-btn v-if="selected.previous" variant="text" :disabled="busy" @click="mutate('rollback', { packId: selected.id })">Previous version</v-btn>
        <v-btn variant="text" :disabled="busy" @click="remove">Remove</v-btn>
      </div>
    </div>
    <v-alert v-if="error" type="error" class="mb-4" role="alert">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" class="mb-4" role="status">{{ notice }}</v-alert>
    <v-alert v-if="busy" type="info" class="mb-4">Preparing your private reference library. This can take a moment; your characters are unchanged.</v-alert>
    <v-card v-if="!selected" class="pa-6">
      <h2>D&amp;D 2014 — Rules Reference</h2>
      <p class="my-4">Add {{ catalog?.entryCount || 'the' }} reference pages covering core rules, character options, spells, equipment, magic items and monsters. Browse the source text and search inside descriptions.</p>
      <p>This is the Creative Commons SRD 5.1. It does not include every option from the commercial books and does not change character calculations.</p>
    </v-card>
    <template v-else>
      <v-select v-if="books.length > 1" label="Reference collection" :model-value="selected.id" :items="books.map(b => ({ title: b.name + (b.canManage ? ' · Yours' : ' · Shared'), value: b.id }))" @update:model-value="navigate({ pack: $event, entry: undefined, page: undefined })" />
      <div class="reference-layout">
        <aside aria-label="Find rules">
          <v-card class="pa-4">
            <v-text-field v-model="query" label="Search rules and descriptions" prepend-inner-icon="mdi-magnify" clearable hide-details @update:model-value="search" @keydown.enter="search" />
            <v-select v-model="category" label="Category" :items="categories" class="mt-3" hide-details @update:model-value="search" />
            <p class="mt-3" aria-live="polite">{{ total }} reference pages<span v-if="loading"> · Searching…</span></p>
            <v-progress-linear v-if="loading" indeterminate class="mt-2" />
            <nav class="reference-results" aria-label="Reference pages">
              <button v-for="result in results" :key="result.key" class="reference-result" :class="{ 'reference-selected': entry?.key === result.key }" @click="navigate({ pack: selected.id, entry: result.key })">
                <strong>{{ result.title }}</strong><small>{{ result.category }}</small><span>{{ result.snippet }}</span>
              </button>
            </nav>
            <div class="reference-pagination">
              <v-btn variant="text" :disabled="!page || loading" @click="navigate({ page: page - 1 || undefined })">Previous</v-btn>
              <span>{{ page + 1 }}</span>
              <v-btn variant="text" :disabled="(page + 1) * 25 >= total || loading" @click="navigate({ page: page + 1 })">Next</v-btn>
            </div>
          </v-card>
        </aside>
        <main class="reference-reading" aria-label="Rule text">
          <v-card v-if="entry" class="pa-5 reference-article">
            <p class="reference-breadcrumb">2014 SRD / {{ entry.category }} / {{ entry.section }}</p>
            <h2>{{ entry.title }}</h2>
            <p class="my-3">Reference text · Library version {{ selected.version }}<span v-if="entry.pages.length"> · PDF pages {{ entry.pages.join(', ') }}</span></p>
            <v-btn variant="outlined" size="small" :href="selected.sourceUrl + '#page=' + (entry.pages[0] || 1)" target="_blank" rel="noopener noreferrer">View official source</v-btn>
            <markdown-text class="reference-body mt-5" :markdown="entry.markdown" />
            <div v-if="entry.links.length" class="reference-related mt-5"><h3>Related references</h3><v-btn v-for="link in entry.links" :key="link.key" variant="text" @click="navigate({ entry: link.key })">{{ link.title }}</v-btn></div>
          </v-card>
          <v-card v-else class="pa-6">
            <h2>{{ selected.name }}</h2>
            <p class="my-4">{{ selected.entryCount }} reference pages · Read-only reference material</p>
            <p>Choose a category or search for a rule, spell, condition, item or creature. You can also search words inside descriptions, such as “difficult terrain” or “concentration”.</p>
            <div class="reference-category-grid my-5"><v-btn v-for="c in selected.categories" :key="c" variant="outlined" @click="category = c; search()">{{ c }} · {{ selected.counts[c] || 0 }}</v-btn></div>
            <v-btn variant="text" @click="navigate({ entry: 'about-sources' })">About this reference and its sources</v-btn>
            <p class="mt-5">Keep personal notes in your own libraries. Source updates do not overwrite them. These pages describe rules; they do not apply effects to your characters.</p>
          </v-card>
        </main>
      </div>
      <p class="reference-attribution">This work includes material taken from the System Reference Document 5.1 (SRD 5.1) by Wizards of the Coast LLC, available at <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noopener noreferrer">dnd.wizards.com/resources/systems-reference-document</a>. SRD 5.1 is licensed under <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener noreferrer">CC-BY-4.0</a>.</p>
    </template>
    <v-dialog v-model="shareOpen" max-width="540"><v-card title="Share this reference"><v-card-text><v-alert v-if="error" type="error" class="mb-3">{{ error }}</v-alert><p>Give an existing account read access. Managed source pages remain read-only.</p><v-text-field v-model="readerName" label="Account username" class="mt-4" /><v-btn :disabled="busy || !readerName.trim()" @click="share(readerName)">Add reader</v-btn><v-list><v-list-item v-for="reader in readers" :key="reader._id" :title="reader.username"><template #append><v-btn variant="text" :disabled="busy" @click="share(reader.username, true)">Revoke</v-btn></template></v-list-item></v-list></v-card-text><v-card-actions><v-btn @click="shareOpen = false">Close</v-btn></v-card-actions></v-card></v-dialog>
  </v-container>
</template>

<style scoped>
.rules-reference { max-width: 1720px; margin: auto; padding: 24px; }
.reference-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
.reference-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.reference-layout { display: grid; grid-template-columns: minmax(270px, 340px) minmax(0, 1fr); gap: 24px; align-items: start; }
.reference-results { max-height: 65vh; overflow-y: auto; margin-top: 12px; }
.reference-result { display: block; text-align: left; width: 100%; color: inherit; padding: 14px 10px; border-bottom: 1px solid var(--chronicle-rule, #aaa); cursor: pointer; }
.reference-result strong, .reference-result small, .reference-result span { display: block; }
.reference-result small { margin: 4px 0; opacity: .8; }
.reference-result span { font-size: .85rem; line-height: 1.45; }
.reference-result:hover, .reference-selected { background: #b99b6422; }
.reference-result:focus-visible { outline: 2px solid currentColor; outline-offset: -3px; }
.reference-reading { min-width: 0; }
.reference-article h2 { font-size: 2rem; }
.reference-body { font-size: 1.05rem; line-height: 1.75; overflow-wrap: anywhere; }
.reference-body :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; max-width: 100%; margin: 20px 0; font-size: .9rem; }
.reference-body :deep(th), .reference-body :deep(td) { padding: 8px 12px; border: 1px solid var(--chronicle-line, #999); }
.reference-body :deep(th) { background: #b99b6426; }
.reference-body :deep(h1:first-child) { display: none; }
.reference-body :deep(h2), .reference-body :deep(h3) { margin: 24px 0 10px; }
.reference-body :deep(ul), .reference-body :deep(ol) { padding-left: 25px; margin: 12px 0; }
.reference-body :deep(p) { margin-bottom: 14px; }
.reference-category-grid { display: flex; gap: 10px; flex-wrap: wrap; }
.reference-pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
.reference-attribution { margin: 24px 0; font-size: .85rem; line-height: 1.6; }
.reference-attribution a { color: inherit; text-decoration: underline; }
.reference-breadcrumb { font-size: .85rem; margin-bottom: 8px; }
@media(max-width: 850px) { .rules-reference { padding: 12px; } .reference-layout { grid-template-columns: 1fr; } .reference-results { max-height: 35vh; } .reference-article { padding: 16px !important; } }
</style>
