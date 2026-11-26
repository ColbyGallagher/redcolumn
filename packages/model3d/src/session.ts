import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import type { ConvertReply, ConvertRequest } from './convert.worker.ts';
import { boxPlanes, directionOffset, INITIAL_STATE, orientationOf, padBox, type ModelAction, type ModelControls, type ModelState, type ModelTool, type ViewDirection } from './controls.ts';

type Measurer = OBF.LengthMeasurement | OBF.AreaMeasurement | OBF.AngleMeasurement | OBF.VolumeMeasurement;
type MeasureTool = 'length' | 'area' | 'angle' | 'volume';
const GHOST_OPACITY = 0.12;

/** Where the viewer's own files are served (the fragments worker and web-ifc's wasm), e.g. `/model3d/`. */
export interface ModelAssets {
  /** The fragments worker module, which holds loaded models and builds their geometry. */
  fragmentsWorker: string;
  /** web-ifc's wasm, used to read IFC files. */
  webIfcWasm: string;
}

export interface LoadProgress {
  /** 'convert': reading the IFC into fragments (the slow part); 'load': drawing them. */
  stage: 'convert' | 'load';
  /** 0..1 */
  fraction: number;
}

export interface LoadOptions {
  /** Fragments from an earlier conversion of the same file, which skip converting it again. */
  fragments?: Uint8Array | null;
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
}

/**
 * One 3D view: a That Open world (scene, camera, renderer) drawn into a container element, with
 * the models loaded into it. Rendering stops while the view is hidden, and dispose() frees the
 * WebGL context, the workers and the models.
 */
export class ModelSession implements ModelControls {
  readonly components: OBC.Components;
  readonly world: OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>;
  readonly fragments: OBC.FragmentsManager;
  private readonly assets: ModelAssets;
  private disposed = false;
  private readonly resize: ResizeObserver;
  private readonly container: HTMLElement;
  private current: ModelState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private highlighter: OBF.Highlighter | null = null;
  private grid: OBC.SimpleGrid | null = null;
  private boxPlaneIds: string[] = [];
  private hidden: OBC.ModelIdMap | null = null;
  private readonly measurers = new Map<MeasureTool, Measurer>();
  private readonly offs: (() => void)[] = [];

  private constructor(container: HTMLElement, assets: ModelAssets) {
    this.assets = assets;
    this.components = new OBC.Components();
    const worlds = this.components.get(OBC.Worlds);
    this.world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    this.world.scene = new OBC.SimpleScene(this.components);
    this.world.scene.setup();
    this.world.scene.three.background = null;
    // With a 2D layer, so measurement labels and markers show over the model.
    this.world.renderer = new OBF.RendererWith2D(this.components, container);
    this.world.camera = new OBC.OrthoPerspectiveCamera(this.components);
    this.components.init();

    this.fragments = this.components.get(OBC.FragmentsManager);
    this.fragments.init(assets.fragmentsWorker);
    // Each model draws with the world's camera; moving the camera asks the worker for the detail it now needs.
    this.fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(this.world.camera.three);
      this.world.scene.three.add(model.object);
      void this.fragments.core.update(true);
    });
    this.world.camera.controls.addEventListener('rest', () => void this.fragments.core.update(true));
    this.world.camera.projection.onChanged.add(() => {
      for (const model of this.fragments.list.values()) model.useCamera(this.world.camera.three);
    });
    this.resize = new ResizeObserver(() => this.world.renderer?.resize());
    this.resize.observe(container);
    this.container = container;
    // Every camera move redraws the view cube.
    this.world.camera.controls.addEventListener('update', () => this.emit());
    this.components.get(OBC.Clipper).enabled = false;
    this.listen(container, 'dblclick', () => void this.place());
    this.listen(window, 'keydown', (e) => this.key(e as KeyboardEvent));
  }

  // --- what the ribbon reads and runs (ModelControls) ---

  state(): ModelState {
    return this.current;
  }

  /** Called whenever the state or the camera changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  orientation() {
    const dir = this.world.camera.three.getWorldDirection(new THREE.Vector3());
    return orientationOf([dir.x, dir.y, dir.z]);
  }

  run(action: ModelAction): void {
    if (this.disposed) return;
    void this.apply(action).catch((err: unknown) => console.warn('3D view:', err));
  }

  private async apply(a: ModelAction): Promise<void> {
    const camera = this.world.camera;
    switch (a.type) {
      case 'nav':
        // Plan looks straight down with a parallel projection; first person needs perspective.
        if (a.mode === 'Plan') await camera.projection.set('Orthographic');
        if (a.mode === 'FirstPerson') await camera.projection.set('Perspective');
        camera.set(a.mode);
        if (a.mode === 'Plan') {
          await this.look('top');
          await this.fitAll();
        }
        return this.update({ nav: a.mode, projection: camera.projection.current });
      case 'projection':
        if (this.current.nav !== 'Orbit') camera.set('Orbit');
        await camera.projection.set(a.projection);
        return this.update({ projection: a.projection, nav: 'Orbit' });
      case 'fitAll':
        return this.fitAll();
      case 'fitSelection': {
        const box = await this.boxOf(this.selection());
        if (box) await camera.controls.fitToSphere(box.getBoundingSphere(new THREE.Sphere()), true);
        return;
      }
      case 'direction':
        return this.look(a.direction);
      case 'tool':
        return this.setTool(a.tool);
      case 'grid':
        if (!this.grid) this.grid = this.components.get(OBC.Grids).create(this.world);
        else this.grid.visible = !this.grid.visible;
        return this.update({ grid: this.grid.visible });
      case 'ghost':
        this.update({ ghost: !this.current.ghost });
        return this.showHidden();
      case 'sectionBox':
        return this.toggleSectionBox();
      case 'clearClips':
        this.components.get(OBC.Clipper).deleteAll();
        this.boxPlaneIds = [];
        return this.update({ clipPlanes: 0, sectionBox: false });
      case 'isolate':
      case 'hide': {
        const sel = this.selection();
        if (!sel) return;
        const hider = this.components.get(OBC.Hider);
        if (a.type === 'isolate') await hider.isolate(sel);
        else await hider.set(false, sel);
        this.hidden = await this.invisibleItems();
        await this.highlighter?.clear('select');
        return this.showHidden();
      }
      case 'showAll':
        for (const model of this.fragments.list.values()) await model.resetOpacity(undefined);
        await this.components.get(OBC.Hider).set(true);
        this.hidden = null;
        await this.fragments.core.update(true);
        return this.update({ hidden: false });
      case 'clearSelection':
        await this.highlighter?.clear('select');
        return this.update({ selected: 0 });
      case 'openView': {
        const views = this.components.get(OBC.Views);
        if (a.id) views.open(a.id);
        else views.close();
        return this.update({ openView: a.id });
      }
      case 'clearMeasurements':
        for (const m of this.measurers.values()) m.list.clear();
        return this.update({ measurements: 0 });
    }
  }

  private update(patch: Partial<ModelState>): void {
    this.current = { ...this.current, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void) {
    target.addEventListener(type, fn);
    this.offs.push(() => target.removeEventListener(type, fn));
  }

  /** Looks at what the camera is looking at from a direction (top, front, ...), keeping the distance. */
  private async look(direction: ViewDirection): Promise<void> {
    const controls = this.world.camera.controls;
    const target = controls.getTarget(new THREE.Vector3());
    const [x, y, z] = directionOffset(direction, Math.max(controls.distance, 1));
    await controls.setLookAt(target.x + x, target.y + y, target.z + z, target.x, target.y, target.z, true);
  }

  /** The elements selected, or null. */
  private selection(): OBC.ModelIdMap | null {
    const sel = this.highlighter?.selection.select;
    return sel && Object.values(sel).some((ids) => ids.size) ? sel : null;
  }

  /** The bounds of some elements, or of every model; null if empty. */
  private async boxOf(items: OBC.ModelIdMap | null): Promise<THREE.Box3 | null> {
    const boxer = this.components.get(OBC.BoundingBoxer);
    boxer.list.clear();
    if (items) await boxer.addFromModelIdMap(items);
    else boxer.addFromModels();
    const box = boxer.get();
    boxer.list.clear();
    return box.isEmpty() ? null : box;
  }

  private async invisibleItems(): Promise<OBC.ModelIdMap> {
    const map: OBC.ModelIdMap = {};
    for (const [id, model] of this.fragments.list) map[id] = new Set(await model.getItemsByVisibility(false));
    return map;
  }

  /** Hidden elements are either gone or, with Ghost on, shown faintly for context. */
  private async showHidden(): Promise<void> {
    const hidden = this.hidden;
    for (const [id, model] of this.fragments.list) {
      const ids = [...(hidden?.[id] ?? [])];
      if (!ids.length) continue;
      if (this.current.ghost) {
        await model.setVisible(ids, true);
        await model.setOpacity(ids, GHOST_OPACITY);
      } else {
        await model.resetOpacity(ids);
        await model.setVisible(ids, false);
      }
    }
    await this.fragments.core.update(true);
    this.update({ hidden: !!hidden && Object.values(hidden).some((s) => s.size) });
  }

  /** Six clipping planes around the selection (or everything), each one draggable; again to remove them. */
  private async toggleSectionBox(): Promise<void> {
    const clipper = this.components.get(OBC.Clipper);
    if (this.boxPlaneIds.length) {
      for (const id of this.boxPlaneIds) await clipper.delete(this.world, id);
      this.boxPlaneIds = [];
      return this.update({ sectionBox: false, clipPlanes: clipper.list.size });
    }
    const box = await this.boxOf(this.selection());
    if (!box) return;
    const [min, max] = padBox(box.min.toArray(), box.max.toArray());
    clipper.enabled = true;
    this.boxPlaneIds = boxPlanes(min, max).map(({ normal, point }) =>
      clipper.createFromNormalAndCoplanarPoint(this.world, new THREE.Vector3(...normal), new THREE.Vector3(...point)),
    );
    clipper.enabled = this.current.tool === 'clip';
    this.update({ sectionBox: true, clipPlanes: clipper.list.size });
  }

  private setTool(tool: ModelTool): void {
    this.components.get(OBC.Clipper).enabled = tool === 'clip';
    for (const [t, m] of this.measurers) if (t !== tool) m.enabled = false;
    if (tool === 'length' || tool === 'area' || tool === 'angle' || tool === 'volume') this.measurer(tool).enabled = true;
    if (this.highlighter) this.highlighter.enabled = tool === 'select';
    this.update({ tool });
  }

  private measurer(tool: MeasureTool): Measurer {
    let m = this.measurers.get(tool);
    if (!m) {
      const c = this.components;
      m = tool === 'length' ? c.get(OBF.LengthMeasurement) : tool === 'area' ? c.get(OBF.AreaMeasurement) : tool === 'angle' ? c.get(OBF.AngleMeasurement) : c.get(OBF.VolumeMeasurement);
      m.world = this.world;
      m.color = new THREE.Color('#e03131');
      const count = () => this.update({ measurements: this.measurementCount() });
      m.list.onItemAdded.add(count);
      m.list.onItemDeleted.add(count);
      this.measurers.set(tool, m);
    }
    return m;
  }

  private measurementCount(): number {
    let n = 0;
    for (const m of this.measurers.values()) n += m.list.size;
    return n;
  }

  /** A double-click places what the tool makes: a clipping plane, or the next measurement point. */
  private async place(): Promise<void> {
    const tool = this.current.tool;
    if (tool === 'clip') {
      const clipper = this.components.get(OBC.Clipper);
      await clipper.create(this.world);
      return this.update({ clipPlanes: clipper.list.size });
    }
    if (tool !== 'select') this.measurer(tool).create();
  }

  private key(e: KeyboardEvent): void {
    // Only while the pointer is over this view: other panes and dialogs keep their keys.
    if (!this.container.matches(':hover')) return;
    const tool = this.current.tool;
    if (tool === 'select') return;
    if (tool === 'clip') {
      if (e.key !== 'Delete') return;
      const clipper = this.components.get(OBC.Clipper);
      void clipper.delete(this.world).then(() => this.update({ clipPlanes: clipper.list.size }));
      return;
    }
    const m = this.measurer(tool);
    if (e.key === 'Enter') m.endCreation();
    else if (e.key === 'Escape') m.cancelCreation();
    else if (e.key === 'Delete') m.delete();
  }

  /** Clicking an element selects it (with the Select tool). */
  private setupSelection(): void {
    if (!this.highlighter) {
      const h = this.components.get(OBF.Highlighter);
      h.setup({ world: this.world, selectMaterialDefinition: { color: new THREE.Color('#2f9bff'), opacity: 1, transparent: false, renderedFaces: 0 } });
      h.zoomToSelection = false;
      const count = () => this.update({ selected: Object.values(h.selection.select ?? {}).reduce((n, s) => n + s.size, 0) });
      h.events.select?.onHighlight.add(count);
      h.events.select?.onClear.add(count);
      h.enabled = this.current.tool === 'select';
      this.highlighter = h;
    }
  }

  /** Storey plans (from IfcBuildingStorey) and elevations around the models, for the Views list. */
  private async makeViews(): Promise<void> {
    const views = this.components.get(OBC.Views);
    views.world = this.world;
    const storeys = await views.createFromIfcStoreys().catch(() => []);
    let elevations: OBC.View[] = [];
    try {
      elevations = views.createElevations({ combine: true });
    } catch {
      // No bounds to make elevations from.
    }
    this.update({
      views: [
        ...storeys.map((v) => ({ id: v.id, label: v.id, kind: 'storey' as const })),
        ...elevations.map((v) => ({ id: v.id, label: v.id, kind: 'elevation' as const })),
      ],
    });
  }

  /** A new, empty 3D view in the container. */
  static create(container: HTMLElement, assets: ModelAssets): ModelSession {
    return new ModelSession(container, assets);
  }

  /**
   * Loads an IFC file. Converting it to fragments runs in a worker, so the window stays responsive;
   * the fragments are returned so they can be kept and the next opening skips the conversion.
   */
  async loadIfc(ifc: Uint8Array, modelId: string, options: LoadOptions = {}): Promise<Uint8Array> {
    const frags = options.fragments ?? (await this.convert(ifc, options));
    if (this.disposed) throw new DOMException('The view was closed.', 'AbortError');
    options.onProgress?.({ stage: 'load', fraction: 0 });
    // The worker takes the buffer it is given, so keep our own copy to return.
    await this.fragments.core.load(frags.slice(), { modelId, camera: this.world.camera.three });
    options.onProgress?.({ stage: 'load', fraction: 1 });
    await this.fitAll();
    this.setupSelection();
    // Storey plans and elevations follow; the model is usable while they are made.
    void this.makeViews().catch((err: unknown) => console.warn('3D view: no storey plans or elevations:', err));
    return frags;
  }

  private convert(ifc: Uint8Array, { onProgress, signal }: LoadOptions): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module', name: 'model3d-convert' });
      const stop = () => {
        worker.terminate();
        reject(new DOMException('Opening the model was cancelled.', 'AbortError'));
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener('abort', stop, { once: true });
      worker.onmessage = (e: MessageEvent<ConvertReply>) => {
        const m = e.data;
        if (m.type === 'progress') return onProgress?.({ stage: 'convert', fraction: m.fraction });
        signal?.removeEventListener('abort', stop);
        worker.terminate();
        if (m.type === 'done') resolve(m.fragments);
        else reject(new Error(m.message));
      };
      worker.onerror = (e) => {
        signal?.removeEventListener('abort', stop);
        worker.terminate();
        reject(new Error(e.message || 'The model could not be read.'));
      };
      const request: ConvertRequest = { ifc, wasm: this.assets.webIfcWasm };
      worker.postMessage(request, [ifc.buffer]);
    });
  }

  /** Frames every loaded model. */
  async fitAll(): Promise<void> {
    const box = new THREE.Box3();
    for (const model of this.fragments.list.values()) box.union(model.box);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    await this.world.camera.controls.fitToSphere(sphere, true);
  }

  /** Stops drawing while the view is not on screen (another tab in front, or the window hidden), and starts again. */
  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.components.enabled = visible;
    if (visible) {
      this.world.renderer?.resize();
      void this.fragments.core.update(true);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resize.disconnect();
    for (const off of this.offs) off();
    this.listeners.clear();
    this.components.dispose();
  }
}
