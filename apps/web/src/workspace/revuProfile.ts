import { parseBpx } from '@nb/markup';
import { layoutFromBpx } from '../columns/bpxLayout';
import { BUILT_IN_COLUMNS } from '../columns/listColumns';
import { DEFAULT_STATUSES } from '@nb/markup';
import { profiles, type Profile } from './profiles';

/**
 * A Bluebeam Revu profile (.bpx) as a new profile: a copy of the current workspace with the markup
 * list laid out as Revu's was (the columns, their order, widths and what is hidden), and its custom
 * columns added to the profile's column template. Revu's other panel layouts are left out.
 */
export function importBpxProfile(text: string, fileName: string, activate: boolean): { profile: Profile; skipped: string[]; columns: number } {
  const bpx = parseBpx(text, fileName.replace(/\.bpx$/i, ''));
  const { layout, custom, skipped } = layoutFromBpx(bpx, () => crypto.randomUUID());
  if (!layout.length) throw new Error('This profile has no markup list columns we can show.');
  // Our columns the profile does not mention stay out of the list (a layout lacking one would show it).
  for (const c of BUILT_IN_COLUMNS) if (c.key !== 'seq' && !layout.some((l) => l.key === c.key)) layout.push({ key: c.key, width: c.defaultWidth, hidden: true });
  const base = structuredClone(profiles.active().state);
  const template = base.columnTemplate;
  const profile = profiles.add(
    bpx.name,
    {
      ...base,
      list: { ...base.list, columns: layout, sort: null },
      ...(custom.length ? { columnTemplate: { columns: [...(template?.columns ?? []), ...custom], statuses: template?.statuses ?? DEFAULT_STATUSES.map((s) => ({ ...s })) } } : {}),
    },
    activate,
  );
  return { profile, skipped, columns: layout.filter((c) => !c.hidden).length };
}
