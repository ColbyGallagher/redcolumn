import { useEffect, useRef } from 'react';
import { MarkupStore } from '@nb/markup';
import { syncTopic, type SyncSheet } from './bcfSync';
import { subscribeModelLibrary, updateModelLibrary } from './library';

/**
 * Keeps the open models' issues and their markups on the open sheets in step, whenever either
 * changes: an issue edited in the 3D panel, or its markups edited on a sheet. A moment after the
 * last change, so a drag or a run of typing syncs once.
 */
export function useIssueSync(modelHashes: readonly string[], sheets: readonly SyncSheet[]): void {
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const hashes = [...new Set(modelHashes)].sort().join('|');
  const keys = sheets.map((s) => s.key).join('|');
  useEffect(() => {
    if (!hashes) return;
    let timer = 0;
    const run = () => {
      timer = 0;
      const now = sheetsRef.current;
      updateModelLibrary((lib) => {
        let issues = lib.issues;
        for (const hash of hashes.split('|')) {
          const list = issues[hash];
          if (!list?.length) continue;
          const next = list.map((t) => syncTopic(t, now, MarkupStore.author));
          if (next.some((t, i) => t !== list[i])) issues = { ...issues, [hash]: next };
        }
        return issues === lib.issues ? lib : { ...lib, issues };
      });
    };
    const schedule = () => {
      if (!timer) timer = window.setTimeout(run, 120);
    };
    schedule();
    const offs = [...new Set(sheetsRef.current.map((s) => s.store))].map((store) => store.subscribe(schedule));
    offs.push(subscribeModelLibrary(schedule));
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [hashes, keys]);
}
