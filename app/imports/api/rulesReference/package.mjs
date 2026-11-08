import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function validatePackage(pack) {
  if (pack?.id !== 'srd-2014-5.1' || pack.edition !== '2014' || !Array.isArray(pack.entries) || pack.entries.length > 2000 || !pack.entries.length) throw new Error('Invalid reference package');
  if (hash(JSON.stringify(pack.entries)) !== pack.entriesHash) throw new Error('Reference package checksum mismatch');
  const keys = new Set();
  for (const entry of pack.entries) {
    if (!/^[a-z0-9-]{1,48}$/.test(entry.key) || keys.has(entry.key) || typeof entry.title !== 'string' || entry.title.length > 128 || !pack.categories.includes(entry.category) || typeof entry.markdown !== 'string' || entry.markdown.length > 49000 || hash(entry.markdown) !== entry.contentHash || !Array.isArray(entry.pages) || entry.pages.some(n => !Number.isInteger(n) || n < 1 || n > 403)) throw new Error('Invalid reference entry');
    keys.add(entry.key);
  }
  for (const entry of pack.entries) for (const link of entry.links) if (!keys.has(link.key)) throw new Error('Broken reference link');
  return pack;
}
export function snippet(text, query = '') {
  const term = query.toLowerCase().match(/[a-z0-9]{3,}/)?.[0];
  const at = term ? text.toLowerCase().indexOf(term) : 0;
  const start = Math.max(0, at - 55);
  return (start ? '…' : '') + text.slice(start, start + 220) + (text.length > start + 220 ? '…' : '');
}
