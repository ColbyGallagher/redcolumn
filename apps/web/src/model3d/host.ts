/**
 * The web app's only way into the 3D viewer (@nb/model3d). The viewer, three.js and web-ifc are
 * loaded with a dynamic import() the first time a model opens, so opening and working with PDFs
 * never downloads or runs any of them (scripts/check-bundle.mjs checks this on every build).
 */
import { msg } from '@nb/i18n';
import { modelGeoreference } from './onDrawing';
import type { ModelView } from '../documents/openTabs';
import type { StoredFile } from '../storage/fileStore';
import { model3dDisplayPrefs, model3dNavPrefs, settings } from '../settings/settings';
import { readFragments, writeFragments } from './fragCache';

/** Where the viewer's worker and web-ifc's wasm are served (copied there by vite.config.ts). */
export function modelAssets() {
  const base = new URL(import.meta.env.BASE_URL, location.href);
  return {
    fragmentsWorker: new URL('model3d/fragments-worker.mjs', base).href,
    webIfcWasm: new URL('model3d/web-ifc.wasm', base).href,
  };
}

/** What the status line over the view says while a model loads. */
export function statusText(stage: 'start' | 'convert' | 'load', fraction = 0): string {
  if (stage === 'start') return 'Opening the 3D viewer…';
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return stage === 'convert' ? `Reading the model… ${pct}%` : 'Drawing the model…';
}

/**
 * A 3D view of an IFC file. It starts loading straight away and draws into `element`, which the
 * stage shows while the model's tab is in front. `data-state` on the element says how far it got
 * (loading, ready or error), for the status line and the tests.
 */
export function openModelView(file: StoredFile, bytes: ArrayBuffer): ModelView {
  const element = document.createElement('div');
  element.className = 'model-view';
  element.dataset.state = 'loading';
  const canvasHost = document.createElement('div');
  canvasHost.className = 'model-canvas';
  const status = document.createElement('div');
  status.className = 'model-status';
  status.setAttribute('role', 'status');
  status.textContent = statusText('start');
  element.append(canvasHost, status);

  const abort = new AbortController();
  let session: import('@nb/model3d').ModelSession | null = null;
  let disposed = false;
  let wanted = false;
  let ready = false;
  let federateSeq = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const apply = () => session?.setVisible(wanted && document.visibilityState === 'visible');
  const applyPrefs = () => {
    const s = settings.get();
    session?.setNavigationPrefs(model3dNavPrefs(s));
    session?.setDisplayPrefs(model3dDisplayPrefs(s));
  };
  const offSettings = settings.subscribe(applyPrefs);
  document.addEventListener('visibilitychange', apply);

  void (async () => {
    const [{ ModelSession }, cached] = await Promise.all([import('@nb/model3d'), readFragments(file.hash)]);
    if (disposed) return;
    session = ModelSession.create(canvasHost, modelAssets());
    applyPrefs();
    // The renderer makes a container it finds unpositioned 'relative', which it is while its tab is
    // not on screen (not yet in the page), and that collapses it: it is placed by the stylesheet.
    canvasHost.style.removeProperty('position');
    session.subscribe(emit);
    // Development and test builds: the session, for debugging and the end-to-end tests.
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1') (element as unknown as { session: unknown }).session = session;
    apply();
    const fragments = await session.loadIfc(new Uint8Array(bytes), file.id, {
      fragments: cached,
      name: file.name,
      signal: abort.signal,
      onProgress: (p) => (status.textContent = statusText(p.stage, p.fraction)),
    });
    if (!cached) void writeFragments(file.hash, fragments);
    element.dataset.state = 'ready';
    status.hidden = true;
    ready = true;
    emit();
    // Where it lies on the map, read from the IFC apart from the viewer, so sheets can be shown in it.
    const geo = await modelGeoreference(file).catch(() => null);
    if (geo?.georeferenced && !disposed) session.run({ type: 'georeference', modelId: file.id, matrix: geo.matrix });
  })().catch((err: unknown) => {
    if (disposed) return;
    element.dataset.state = 'error';
    status.textContent = `This model could not be opened: ${err instanceof Error ? err.message : String(err)}`;
  });

  return {
    element,
    controls: () => (ready ? session : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async addModel(extra, extraBytes, onProgress) {
      if (disposed || !session || !ready) throw new Error(msg('The 3D view is not ready yet.'));
      onProgress?.(statusText('start'));
      const cached = await readFragments(extra.hash);
      if (disposed || !session) return;
      const existing = new Set(session.models().map((m) => m.id));
      const modelId = existing.has(extra.id) ? `${extra.id}#${++federateSeq}` : extra.id;
      const fragments = await session.loadIfc(new Uint8Array(extraBytes), modelId, {
        fragments: cached,
        name: extra.name,
        fit: false,
        signal: abort.signal,
        onProgress: (p) => onProgress?.(statusText(p.stage, p.fraction)),
      });
      if (!cached) void writeFragments(extra.hash, fragments);
      const geo = await modelGeoreference(extra).catch(() => null);
      if (geo?.georeferenced && !disposed && session) {
        session.run({ type: 'georeference', modelId, matrix: geo.matrix });
      }
      emit();
    },
    setVisible(visible) {
      wanted = visible;
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      abort.abort();
      offSettings();
      document.removeEventListener('visibilitychange', apply);
      session?.dispose();
      session = null;
      // Emptied as well as removed: a stale reference to the element (an old render's closure) then
      // holds nothing of the view.
      delete (element as unknown as { session?: unknown }).session;
      element.replaceChildren();
      element.remove();
    },
  };
}
