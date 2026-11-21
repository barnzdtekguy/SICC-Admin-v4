// Regenerates server/data/lists.json from the frontend constants so the API
// validates against exactly the same departments, KDF areas and statuses.
// Run: node scripts/export-lists.mjs
import { writeFileSync } from 'node:fs';
import { DEPARTMENTS, KDF_AREAS, AFFINITY_GROUPS, MEMBER_STATUSES, SPIRITUAL_STATUSES, SERVICE_TYPES, FOLLOWUP_METHODS, FOLLOWUP_STATUSES } from '../src/data/constants.js';

const areaName = a => (typeof a === 'string' ? a : a.name);
const out = {
  departments: DEPARTMENTS.map((d, i) => ({ name: d.name, color: d.color || null, sort_order: i + 1 })),
  kdfAreas: KDF_AREAS.map((a, i) => ({ name: areaName(a), sort_order: i + 1 })),
  affinityGroups: AFFINITY_GROUPS,
  memberStatuses: MEMBER_STATUSES,
  spiritualStatuses: SPIRITUAL_STATUSES,
  serviceTypes: SERVICE_TYPES,
  followupMethods: FOLLOWUP_METHODS,
  followupStatuses: FOLLOWUP_STATUSES,
};
writeFileSync(new URL('../server/data/lists.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`departments=${out.departments.length} kdfAreas=${out.kdfAreas.length}`);
