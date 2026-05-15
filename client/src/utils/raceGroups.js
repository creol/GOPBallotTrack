// Preconfigured race groups, in the order they should appear in the sidebar.
// Custom groups (any other string) appear after these, alphabetically.
export const PRECONFIGURED_GROUPS = [
  'County',
  'State',
  'State School Board',
  'House',
  'Senate',
  'Federal',
  'Other',
];

export const DEFAULT_GROUP = 'Other';

export function normalizeGroup(g) {
  if (typeof g !== 'string') return DEFAULT_GROUP;
  const t = g.trim();
  return t || DEFAULT_GROUP;
}

// Build the dropdown option list: preconfigured ∪ any custom values currently in use.
export function buildGroupOptions(racesOrGroups = []) {
  const set = new Set(PRECONFIGURED_GROUPS);
  for (const item of racesOrGroups) {
    const v = typeof item === 'string' ? item : item?.race_group;
    const g = normalizeGroup(v);
    set.add(g);
  }
  return sortGroupNames([...set]);
}

// Preconfigured order first; everything else alphabetized after.
export function sortGroupNames(groups) {
  const idx = (g) => {
    const i = PRECONFIGURED_GROUPS.indexOf(g);
    return i === -1 ? PRECONFIGURED_GROUPS.length : i;
  };
  return [...groups].sort((a, b) => {
    const ai = idx(a), bi = idx(b);
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}
