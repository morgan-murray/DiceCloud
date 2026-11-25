export const sessionPages = {
  recap: { title: '01 · Last session recap', kind: 'Session recap', tags: ['pinned', 'recap'] },
  schedule: { title: '02 · Next arranged game', kind: 'Session arrangements', tags: ['pinned', 'schedule'] },
  tracker: { title: 'Quest tracker', kind: 'Quest log', tags: ['quests'] },
};

export function sessionPageRole(page) {
  if (page.type !== 'journal' || page.deleted || page.visibility !== 'shared' || page.restricted) return;
  const title = page.title.replace(/^\d+\s*[·.-]\s*/, '').trim().toLowerCase();
  if (title === 'last session recap' || (page.tags.includes('pinned') && page.tags.includes('recap'))) return 'recap';
  if (title === 'next arranged game' || (page.tags.includes('pinned') && page.tags.includes('schedule'))) return 'schedule';
  if (title === 'quest tracker' || page.kind === 'Quest log') return 'tracker';
  if (page.tags.includes('quests') || /\bquest\b/i.test(page.kind)) return 'quest';
}
