import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import { SnappingClass, type FragmentsModel } from '@thatopen/fragments';
import type { ConvertReply, ConvertRequest } from './convert.worker.ts';
import {
  clampViewDistance,
  DEFAULT_DISPLAY_PREFS,
  directionOffset,
  framedRadius,
  INITIAL_STATE,
  nearFor,
  matchesCategory,
  orientationOf,
  padBox,
  searchable,
  densify,
  diffRevisions,
  walkMove,
  WALK,
  BY_CLASS,
  type ClassEntry,
  type QuantityRow,
  type QuantityTable,
  type RevisionDiff,
  type RevisionItem,
  type ItemMap,
  type ModelAction,
  type ModelControls,
  type ModelDisplayPrefs,
  type ModelInfo,
  type ModelNavPrefs,
  type ModelState,
  type ModelTool,
  type PlaceCamera,
  type PlanView,
  type ResolvedProfile,
  type SheetOverlay,
  type SavedView,
  type SearchSet,
  type SelectionInfo,
  type TreeNode,
  type ViewDirection,
} from './controls.ts';
import { attrText, flatProperties, groupKey, matchesProperty, propertyGroups, quantitiesOf, type RawItem } from './items.ts';
import { NavigationController } from './navigation.ts';
import { MeasureController, type MeasureKind, type SnapHit } from './measure.ts';
import { SectionBoxController } from './sectionBox.ts';

const isMeasureTool = (t: ModelTool): t is MeasureKind => t === 'length' || t === 'area' || t === 'angle' || t === 'volume';
/** How close (CSS px) the pointer has to be to an element's corner, or edge, to snap to it. */
const SNAP_VERTEX_PX = 12;
const SNAP_EDGE_PX = 8;
type Vec3 = [number, number, number];
const GHOST_OPACITY = 0.12;
/** Comparing revisions: what only this model has, what changed, and what only the other has. */
const COMPARE_COLOURS = { added: '#2fb344', changed: '#f59f00', removed: '#e03131' };
/** Keys that walk (lower case, as KeyboardEvent.key). */
const WALK_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
type Hit = { point: THREE.Vector3; modelId: string; localId: number; distance: number };
/** Elements asked for at a time when reading their data from the worker. */
const CHUNK = 2000;
/** Relations read for an element's properties: its property and quantity sets. */
const WITH_PSETS = { attributesDefault: true, relations: { IsDefinedBy: { attributes: true, relations: true }, DefinesOccurrence: { attributes: false, relations: false } } };

const toModelIdMap = (items: ItemMap): OBC.ModelIdMap => Object.fromEntries(Object.entries(items).map(([id, ids]) => [id, new Set(ids)]));
const isEmpty = (map: OBC.ModelIdMap | null) => !map || !Object.values(map).some((s) => s.size);

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
  /** The name the 3D panel shows for the model (its file name). */
  name?: string;
  /** Frame all models after loading (defaults to true for the first model, false when federating). */
  fit?: boolean;
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
  /** The section box: six clipping planes whose walls can be dragged. */
  private readonly sectionBox: SectionBoxController;
  /** Length, area, angle and volume measuring. */
  private readonly measure: MeasureController;
  /** Whether the view is on screen (see setVisible). */
  private visible = true;
  /** Elements a colour profile hides, kept apart from those hidden with Hide and Isolate. */
  private profileHidden: OBC.ModelIdMap = {};
  private readonly names = new Map<string, string>();
  private readonly elementCounts = new Map<string, number>();
  /** Grid (easting, northing, height) to scene, from the first georeferenced model. */
  private gridToScene: THREE.Matrix4 | null = null;
  /** IFC world origin of the first loaded model (for aligning non-georeferenced federated models). */
  private baseCoords: Vec3 | null = null;
  /** Sheets shown in the view, by overlay id. */
  private readonly sheets = new Map<string, { version: string; object: THREE.Object3D }>();
  private readonly sheetGroup = new THREE.Group();
  /** Goes up with each change of the sheets, so a slow drape left behind by a newer one stops. */
  private sheetRun = 0;
  private hidden: OBC.ModelIdMap | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly navigation: NavigationController;
  private displayPrefs: ModelDisplayPrefs = { ...DEFAULT_DISPLAY_PREFS };
  private skyTexture: THREE.CanvasTexture | null = null;
  /** The other revision loaded to compare with, while there is one. */
  private compareId: string | null = null;
  /** The comparison shown, to colour again what a selection's highlight took the colours off. */
  private compared: { diff: RevisionDiff; mine: FragmentsModel; other: FragmentsModel } | null = null;
  /** The mini-map: a camera looking straight down on the models, and the marker it shows the camera with. */
  private mini: { camera: THREE.OrthographicCamera; marker: THREE.Mesh; area: { left: number; top: number; size: number } | null } | null = null;
  /** Walking: the keys held, whether Shift (run) is, the last frame's time, and a step still working out where it lands. */
  private readonly walkKeys = new Set<string>();
  private walkRun = false;
  private walkLast = 0;
  private walkBusy = false;
  private walkFrame = 0;

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
      if (this.displayPrefs.wireframe) this.applyWireframe(model.object, true);
      void this.fragments.core.update(true);
    });
    this.world.camera.controls.addEventListener('rest', () => void this.fragments.core.update(true));
    this.world.camera.projection.onChanged.add(() => {
      for (const model of this.fragments.list.values()) model.useCamera(this.world.camera.three);
      this.navigation.syncCameraMode(this.current.nav, this.world.camera.projection.current);
    });
    // Resizing the canvas clears it until something draws again: each resize draws a frame at once,
    // so dragging a sidebar's edge never shows the view blank (the renderer's own observer resizes too).
    this.world.renderer!.onResize.add(() => this.redrawNow());
    this.resize = new ResizeObserver(() => this.world.renderer?.resize());
    this.resize.observe(container);
    this.container = container;
    this.navigation = new NavigationController({
      container,
      world: this.world,
      raycastAt: (clientX, clientY) => this.hitAtScreen(clientX, clientY),
      modelBounds: () => this.allBox(),
      isBlocked: (e) => !!this.onMiniMap(e),
      onRest: () => void this.fragments.core.update(true),
      onDoubleMiddle: () => void this.fitAll(),
    });
    const canvas = this.world.renderer!.three.domElement;
    this.measure = new MeasureController({
      container,
      canvas,
      camera: () => this.world.camera.three,
      snapAt: (x, y) => this.snapAt(x, y),
      volumeOf: (modelId, localId) => this.volumeOf(modelId, localId),
      isBlocked: (e) => !!this.onMiniMap(e),
      onChange: (measurements) => this.update({ measurements }),
    });
    this.sectionBox = new SectionBoxController({
      container,
      camera: () => this.world.camera.three,
      setPlane: (active, plane) => this.world.renderer?.setPlane(active, plane),
      onChange: () => this.emit(),
    });
    // The near and far clipping distances follow the camera, so close-ups are not cut and far models still show.
    this.world.camera.controls.addEventListener('update', () => this.updateClipRange());
    // Every camera move redraws the view cube.
    this.world.camera.controls.addEventListener('update', () => this.emit());
    this.components.get(OBC.Clipper).enabled = false;
    this.listen(container, 'dblclick', () => void this.placeClipPlane());
    this.listen(window, 'keydown', (e) => this.key(e as KeyboardEvent));
    // Walking keys go to the view before the app's shortcuts see them.
    this.listen(window, 'keydown', (e) => this.walkKey(e as KeyboardEvent, true), true);
    this.listen(window, 'keyup', (e) => this.walkKey(e as KeyboardEvent, false), true);
    this.listen(window, 'blur', () => this.walkKeys.clear());
    // A click on the mini-map moves the camera there, before the camera controls take it as a drag.
    this.listen(container, 'pointerdown', (e) => this.miniMapClick(e as PointerEvent), true);
    // ...and the rest of that click stays out of selecting.
    for (const type of ['pointerup', 'mouseup', 'click', 'dblclick'])
      this.listen(
        container,
        type,
        (e) => {
          if (this.onMiniMap(e as MouseEvent)) e.stopPropagation();
        },
        true,
      );
    this.world.renderer!.onAfterUpdate.add(() => {
      this.drawMiniMap();
      this.measure.draw();
      this.sectionBox.draw();
    });
    this.updateClipRange();
  }

  /** Draws a frame now (after a resize), instead of waiting for the next one. */
  private redrawNow(): void {
    if (this.disposed || !this.visible) return;
    const renderer = this.world.renderer;
    if (!renderer || !renderer.three.domElement.width || !renderer.three.domElement.height) return;
    this.world.camera.updateAspect();
    renderer.update();
  }

  /** The camera's near plane, set by how far it is from what it looks at, and its far plane, the view distance. */
  private updateClipRange(): void {
    if (this.disposed) return;
    const far = clampViewDistance(this.displayPrefs.viewDistance);
    const persp = this.world.camera.threePersp;
    const near = nearFor(this.world.camera.controls.distance);
    // Small changes are left alone, so the projection is not rebuilt on every frame of a move.
    if (persp.far !== far || Math.abs(persp.near - near) > near * 0.25) {
      persp.near = near;
      persp.far = far;
      persp.updateProjectionMatrix();
    }
    const ortho = this.world.camera.threeOrtho;
    if (ortho.far !== far) {
      ortho.far = far;
      ortho.updateProjectionMatrix();
    }
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

  setNavigationPrefs(prefs: Partial<ModelNavPrefs>): void {
    if (this.disposed) return;
    this.navigation.setPrefs(prefs);
  }

  setDisplayPrefs(patch: Partial<ModelDisplayPrefs>): void {
    if (this.disposed) return;
    const prev = this.displayPrefs;
    const next: ModelDisplayPrefs = { ...prev, ...patch };
    this.displayPrefs = next;

    // Background
    const scene = this.world.scene.three;
    if (next.background === 'theme') {
      scene.background = null;
    } else if (next.background === 'dark') {
      scene.background = new THREE.Color('#1c2026');
    } else if (next.background === 'light') {
      scene.background = new THREE.Color('#eef1f5');
    } else if (next.background === 'sky') {
      if (!this.skyTexture) this.skyTexture = makeSkyTexture();
      scene.background = this.skyTexture;
    } else {
      scene.background = new THREE.Color(next.backgroundColour || '#1c2026');
    }

    // Lighting
    const cfg = this.world.scene.config;
    cfg.ambientLight.intensity = Math.max(0, Math.min(4, next.ambientIntensity));
    cfg.directionalLight.intensity = Math.max(0, Math.min(5, next.sunIntensity));
    const az = THREE.MathUtils.degToRad(next.sunAzimuth);
    const el = THREE.MathUtils.degToRad(Math.max(5, Math.min(89, next.sunElevation)));
    const r = 100;
    cfg.directionalLight.position = new THREE.Vector3(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az));

    // Camera FOV
    const fov = Math.max(25, Math.min(95, next.fov));
    const persp = this.world.camera.threePersp;
    if (persp.fov !== fov) {
      persp.fov = fov;
      persp.updateProjectionMatrix();
    }

    // View distance (the far clipping plane)
    if (next.viewDistance !== prev.viewDistance) this.updateClipRange();

    // Wireframe
    if (next.wireframe !== prev.wireframe) {
      for (const model of this.fragments.list.values()) this.applyWireframe(model.object, next.wireframe);
    }

    // Ghost opacity
    if (next.ghostOpacity !== prev.ghostOpacity && this.current.ghost && this.hidden) {
      void this.showHidden();
    }
  }

  private applyWireframe(root: THREE.Object3D, wireframe: boolean): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = wireframe;
      }
    });
  }

  run(action: ModelAction): void {
    if (this.disposed) return;
    void this.apply(action).catch((err: unknown) => console.warn('3D view:', err));
  }

  private async apply(a: ModelAction): Promise<void> {
    const camera = this.world.camera;
    switch (a.type) {
      case 'nav':
        this.stopWalk();
        if (a.mode === 'Walk') {
          await this.startWalk();
          return;
        }
        // Plan looks straight down with a parallel projection; first person needs perspective.
        if (a.mode === 'Plan') await camera.projection.set('Orthographic');
        if (a.mode === 'FirstPerson') await camera.projection.set('Perspective');
        camera.set(a.mode);
        this.navigation.syncCameraMode(a.mode, camera.projection.current);
        if (a.mode === 'Plan') {
          await this.look('top');
          await this.fitAll();
        }
        return this.update({ nav: a.mode, projection: camera.projection.current });
      case 'projection':
        if (this.current.nav !== 'Orbit') camera.set('Orbit');
        await camera.projection.set(a.projection);
        this.navigation.syncCameraMode('Orbit', a.projection);
        return this.update({ projection: a.projection, nav: 'Orbit' });
      case 'fitAll':
        return this.fitAll();
      case 'fitSelection': {
        const box = await this.boxOf(this.selected());
        if (box) await this.frame(box);
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
        this.sectionBox.clear();
        return this.update({ clipPlanes: 0, sectionBox: false });
      case 'isolate':
      case 'hide': {
        const sel = this.selected();
        if (!sel) return;
        const hider = this.components.get(OBC.Hider);
        if (a.type === 'isolate') await hider.isolate(sel);
        else await hider.set(false, sel);
        this.hidden = await this.invisibleItems();
        await this.highlighter?.clear('select');
        return this.showHidden();
      }
      case 'showAll':
        return this.showAll();
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
        this.measure.clear();
        return this.update({ measurements: 0 });
      case 'modelVisible': {
        const model = this.fragments.list.get(a.modelId);
        if (!model) return;
        model.object.visible = a.visible;
        await this.fragments.core.update(true);
        return this.update({ modelsVersion: this.current.modelsVersion + 1 });
      }
      case 'fitModel': {
        const model = this.fragments.list.get(a.modelId);
        if (!model) return;
        const box = this.modelBox(model);
        if (!box.isEmpty()) await this.frame(box);
        return;
      }
      case 'removeModel':
        return this.removeModel(a.modelId);
      case 'selectItems': {
        const h = this.highlighter;
        if (!h) return;
        if (this.current.tool !== 'select') this.setTool('select');
        if (!Object.values(a.items).some((ids) => ids.length)) return void (await h.clear('select'));
        await h.highlightByID('select', toModelIdMap(a.items), true, false);
        if (a.fit) await this.apply({ type: 'fitSelection' });
        return;
      }
      case 'isolateItems':
      case 'itemsVisible': {
        const hider = this.components.get(OBC.Hider);
        const map = toModelIdMap(a.items);
        if (a.type === 'isolateItems') await hider.isolate(map);
        else await hider.set(a.visible, map);
        this.hidden = await this.invisibleItems();
        return this.showHidden();
      }
      case 'applyProfile':
        return this.applyProfile(a.id, a.profile);
      case 'applyView':
        return this.applyView(a.view, a.profile);
      case 'georeference':
        return this.georeference(a.modelId, a.matrix);
      case 'sheetOverlays':
        return this.showSheets(a.overlays);
      case 'lookAtPlace':
        return this.lookAtPlace(a.camera);
      case 'planView':
        return this.showPlan(a.view);
      case 'miniMap':
        return this.update({ miniMap: !this.current.miniMap });
      case 'endCompare':
        return this.endCompare();
      case 'navPrefs':
        this.navigation.setPrefs(a.prefs);
        return;
      case 'displayPrefs':
        this.setDisplayPrefs(a.prefs);
        return;
    }
  }

  // --- sheets in the model (where both are on the map) ---

  /**
   * Places a model on the map: `matrix` takes its IFC coordinates (Z up) to grid easting, northing
   * and height (column-major 4x4, from its IfcMapConversion). The first georeferenced model defines
   * `gridToScene`; subsequent georeferenced federated models are transformed into that shared frame.
   */
  private async georeference(modelId: string, matrix: number[]): Promise<void> {
    const model = this.fragments.list.get(modelId);
    if (!model) return;
    const [cx = 0, cy = 0, cz = 0] = await model.getCoordinates();
    const toGrid = new THREE.Matrix4().fromArray(matrix);
    if (Math.abs(toGrid.determinant()) < 1e-12) return;
    // Scene (x, y, z) = (X, Z, -Y) + the model's coordinates, from IFC (X, Y, Z).
    const swap = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    const localFromIfc = new THREE.Matrix4().makeTranslation(cx, cy, cz).multiply(swap);
    if (!this.gridToScene) {
      model.object.updateMatrixWorld(true);
      this.gridToScene = model.object.matrixWorld.clone().multiply(localFromIfc).multiply(toGrid.clone().invert());
    } else {
      const align = this.gridToScene.clone().multiply(toGrid).multiply(localFromIfc.clone().invert());
      align.decompose(model.object.position, model.object.quaternion, model.object.scale);
      model.object.updateMatrixWorld(true);
      await this.fragments.core.update(true);
    }
    this.update({ georeferenced: true, heights: this.computeHeights() });
  }

  private computeHeights(): [number, number] | null {
    if (!this.gridToScene) return null;
    const sceneToGrid = this.gridToScene.clone().invert();
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, model] of this.own()) {
      const box = this.modelBox(model);
      if (box.isEmpty()) continue;
      const z0 = new THREE.Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(sceneToGrid).z;
      const z1 = new THREE.Vector3(box.max.x, box.max.y, box.max.z).applyMatrix4(sceneToGrid).z;
      lo = Math.min(lo, z0, z1);
      hi = Math.max(hi, z0, z1);
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /** World-space bounding box of a model (accounting for any federation alignment transform). */
  private modelBox(model: FragmentsModel): THREE.Box3 {
    model.object.updateMatrixWorld(true);
    return model.box.clone().applyMatrix4(model.object.matrixWorld);
  }

  /** Removes a federated model from the view and disposes its GPU/worker resources. */
  private async removeModel(modelId: string): Promise<void> {
    if (modelId === this.compareId) return;
    const model = this.fragments.list.get(modelId);
    if (!model) return;
    if (this.compared?.mine === model) await this.endCompare();
    if (this.highlighter?.selection.select?.[modelId]?.size) await this.highlighter.clear('select');
    if (this.hidden) delete this.hidden[modelId];
    delete this.profileHidden[modelId];
    this.names.delete(modelId);
    this.elementCounts.delete(modelId);
    model.object.removeFromParent();
    await this.fragments.core.disposeModel(modelId);
    await this.fragments.core.update(true);
    if (!this.own().length) this.baseCoords = null;
    this.update({
      modelsVersion: this.current.modelsVersion + 1,
      heights: this.gridToScene ? this.computeHeights() : null,
      hidden: !!this.hidden && Object.values(this.hidden).some((s) => s.size),
    });
    void this.makeViews().catch(() => {});
  }

  private scenePoint(e: number, n: number, h: number): THREE.Vector3 {
    return new THREE.Vector3(e, n, h).applyMatrix4(this.gridToScene!);
  }

  /** Shows these sheets (and no others); an overlay whose version is unchanged is left as it is. */
  private async showSheets(overlays: SheetOverlay[]): Promise<void> {
    if (!this.gridToScene) return;
    if (!this.sheetGroup.parent) this.world.scene.three.add(this.sheetGroup);
    const run = ++this.sheetRun;
    const wanted = new Set(overlays.map((o) => o.id));
    for (const [id, shown] of this.sheets) {
      const next = overlays.find((o) => o.id === id);
      if (wanted.has(id) && next?.version === shown.version) continue;
      this.sheetGroup.remove(shown.object);
      disposeObject(shown.object);
      this.sheets.delete(id);
    }
    const drapes = overlays.filter((o) => !this.sheets.has(o.id) && o.mode === 'drape');
    for (const o of overlays) {
      if (this.sheets.has(o.id) || o.mode !== 'plane' || !o.image) continue;
      const object = this.planeOf(o);
      this.sheetGroup.add(object);
      this.sheets.set(o.id, { version: o.version, object });
    }
    this.update({ draping: drapes.length });
    for (const o of drapes) {
      const object = await this.drapeOf(o, run);
      if (run !== this.sheetRun || this.disposed) {
        if (object) disposeObject(object);
        return;
      }
      if (object) {
        this.sheetGroup.add(object);
        this.sheets.set(o.id, { version: o.version, object });
      }
      this.update({ draping: this.current.draping - 1 });
    }
  }

  /** A sheet's picture on a level plane at its height. */
  private planeOf(o: SheetOverlay): THREE.Object3D {
    const [tl, tr, br, bl] = o.corners.map(([e, n]) => this.scenePoint(e, n, o.height));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...bl!.toArray(), ...br!.toArray(), ...tr!.toArray(), ...tl!.toArray()], 3));
    // The canvas's top row is v = 1 (textures flip by default).
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const map = new THREE.CanvasTexture(o.image!);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      opacity: o.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `sheet:${o.id}`;
    mesh.renderOrder = 1;
    return mesh;
  }

  /** A sheet's markups laid over the model: each line's points dropped onto the surface below them. */
  private async drapeOf(o: SheetOverlay, run: number): Promise<THREE.Object3D | null> {
    const group = new THREE.Group();
    group.name = `sheet:${o.id}`;
    if (!this.world.renderer?.three.domElement) return null;
    const lift = 0.05;
    for (const line of o.lines) {
      const segments: THREE.Vector3[][] = [[]];
      for (const [e, n] of densify(line.points, 1, 600)) {
        if (run !== this.sheetRun || this.disposed) return null;
        const at = this.scenePoint(e, n, 0);
        const hit = await this.topHit(at.x, at.z);
        if (hit) segments[segments.length - 1]!.push(new THREE.Vector3(at.x, hit.point.y + lift, at.z));
        else if (segments[segments.length - 1]!.length) segments.push([]);
      }
      const material = new THREE.LineBasicMaterial({ color: new THREE.Color(line.colour), transparent: o.opacity < 1, opacity: o.opacity, depthTest: true });
      for (const pts of segments) if (pts.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material));
    }
    return group;
  }

  /** The highest element of the shown models straight below a scene point (x, z), looking down from well above them. */
  private async topHit(x: number, z: number): Promise<Hit | null> {
    if (!this.gridToScene) return null;
    return this.castRay(new THREE.Vector3(x, this.scenePoint(0, 0, 0).y + 10_000, z), new THREE.Vector3(0, -1, 0));
  }

  /** The nearest element of the shown models along a ray from `origin` in direction `dir`, within `far`. */
  private async castRay(origin: THREE.Vector3, dir: THREE.Vector3, far = 100_000): Promise<Hit | null> {
    const dom = this.world.renderer?.three.domElement;
    if (!dom) return null;
    // A pinhole camera at the origin looking along the ray: a raycast through its middle is the ray.
    const camera = new THREE.OrthographicCamera(-0.01, 0.01, 0.01, -0.01, 0.001, far);
    if (Math.abs(dir.y) > 0.99) camera.up.set(0, 0, -1);
    camera.position.copy(origin);
    camera.lookAt(origin.clone().add(dir));
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    // Raycasts go through the view's canvas: one asked for as its tab comes forward waits for it to show.
    for (let i = 0; i < 120 && !dom.getBoundingClientRect().width && !this.disposed; i++) await new Promise((r) => requestAnimationFrame(r));
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const mouse = new THREE.Vector2(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return this.nearestHit(camera, mouse, dom, origin, far);
  }

  /** The nearest element of the shown models under a screen point, seen by `camera`. */
  private async nearestHit(camera: THREE.Camera, mouse: THREE.Vector2, dom: HTMLCanvasElement, from: THREE.Vector3, far = Infinity): Promise<Hit | null> {
    let best: Hit | null = null;
    for (const [modelId, model] of this.fragments.list) {
      if (!model.object.visible) continue;
      const r = await model.raycast({ camera: camera as THREE.PerspectiveCamera, mouse, dom }).catch(() => null);
      if (!r) continue;
      const distance = r.point.distanceTo(from);
      if (distance <= far && (!best || distance < best.distance)) best = { point: r.point.clone(), modelId, localId: r.localId, distance };
    }
    return best;
  }

  /** Nearest visible surface point under screen coordinates (clientX, clientY), or null. */
  private async hitAtScreen(clientX: number, clientY: number): Promise<THREE.Vector3 | null> {
    const dom = this.world.renderer?.three.domElement;
    if (!dom || this.disposed) return null;
    const from = this.world.camera.controls.getPosition(new THREE.Vector3(), false);
    const hit = await this.nearestHit(this.world.camera.three, new THREE.Vector2(clientX, clientY), dom, from);
    return hit ? hit.point : null;
  }

  /** Shows every element again, at full strength and in its own colours (a colour profile goes too). */
  private async showAll(): Promise<void> {
    for (const model of this.fragments.list.values()) {
      await model.resetOpacity(undefined);
      await model.resetColor(undefined);
    }
    await this.components.get(OBC.Hider).set(true);
    this.hidden = null;
    this.profileHidden = {};
    await this.fragments.core.update(true);
    this.update({ hidden: false, profileId: null });
  }

  // --- what the 3D panel reads (ModelBrowser) ---

  /** The models opened in the view (not another revision loaded to compare with). */
  private own(): [string, FragmentsModel][] {
    return [...this.fragments.list].filter(([id]) => id !== this.compareId);
  }

  models(): ModelInfo[] {
    return this.own().map(([id, model]) => ({ id, name: this.names.get(id) ?? id, visible: model.object.visible, elements: this.elementCounts.get(id) ?? 0 }));
  }

  async tree(): Promise<TreeNode[]> {
    const out: TreeNode[] = [];
    for (const [id, model] of this.own()) {
      const root = await model.getSpatialStructure();
      type Spatial = typeof root;
      const ids: number[] = [];
      const collect = (n: Spatial) => {
        if (n.localId !== null) ids.push(n.localId);
        for (const c of n.children ?? []) collect(c);
      };
      collect(root);
      const names = new Map<number, string>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const data = (await model.getItemsData(part, { attributesDefault: false, attributes: ['Name', 'LongName'] })) as RawItem[];
        part.forEach((lid, j) => names.set(lid, attrText(data[j]?.Name) || attrText(data[j]?.LongName)));
      }
      // The structure groups items under their class (a node with a category and no id, holding nodes
      // with an id and no category): a group of one item reads as that item, of its class.
      const build = (n: Spatial, inherited = ''): TreeNode => {
        const kids = n.children ?? [];
        const only = kids[0];
        if (n.localId === null && n.category && kids.length === 1 && only && only.localId !== null && !only.category) return build(only, n.category);
        const category = n.category ?? inherited;
        return {
          modelId: id,
          localId: n.localId,
          category,
          name: (n.localId !== null ? names.get(n.localId) : '') || category,
          children: kids.map((c) => build(c, n.localId === null ? (n.category ?? '') : '')),
        };
      };
      out.push({ modelId: id, localId: null, category: 'MODEL', name: this.names.get(id) ?? id, children: [build(root)] });
    }
    return out;
  }

  async classes(): Promise<ClassEntry[]> {
    const by = new Map<string, ItemMap>();
    for (const [id, model] of this.own()) {
      for (const [category, ids] of Object.entries(await this.itemsByCategory(model))) {
        const entry = by.get(category) ?? {};
        entry[id] = ids;
        by.set(category, entry);
      }
    }
    return [...by]
      .map(([category, items]) => ({ category, items, count: Object.values(items).reduce((n, ids) => n + ids.length, 0) }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  /** A model's elements with geometry, by IFC class. */
  private async itemsByCategory(model: FragmentsModel): Promise<Record<string, number[]>> {
    const categories = [...new Set((await model.getItemsWithGeometryCategories()).filter((c): c is string => !!c))];
    if (!categories.length) return {};
    // IFC class names are letters, digits and underscores, so they need no escaping.
    return model.getItemsOfCategories(categories.filter((c) => /^\w+$/.test(c)).map((c) => new RegExp(`^${c}$`)));
  }

  async selection(): Promise<SelectionInfo> {
    const sel = this.selected();
    if (!sel) return { count: 0, first: null };
    const count = Object.values(sel).reduce((n, s) => n + s.size, 0);
    const [modelId, ids] = Object.entries(sel).find(([, s]) => s.size)!;
    const model = this.fragments.list.get(modelId);
    const localId = ids.values().next().value as number;
    if (!model) return { count, first: null };
    const [item] = (await model.getItemsData([localId], WITH_PSETS)) as RawItem[];
    if (!item) return { count, first: null };
    return {
      count,
      first: { modelId, localId, name: attrText(item.Name), category: attrText(item._category), guid: attrText(item._guid) || null, groups: propertyGroups(item) },
    };
  }

  async find(set: SearchSet): Promise<ItemMap> {
    const out: ItemMap = {};
    if (!searchable(set)) return out;
    for (const [id, model] of this.own()) {
      const candidates = Object.entries(await this.itemsByCategory(model))
        .filter(([category]) => matchesCategory(set, category))
        .flatMap(([, ids]) => ids);
      if (!set.property.trim()) {
        if (candidates.length) out[id] = candidates;
        continue;
      }
      const found: number[] = [];
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const part = candidates.slice(i, i + CHUNK);
        const data = (await model.getItemsData(part, WITH_PSETS)) as RawItem[];
        part.forEach((lid, j) => {
          const item = data[j];
          if (item && matchesProperty(set, propertyGroups(item))) found.push(lid);
        });
      }
      if (found.length) out[id] = found;
    }
    return out;
  }

  async capture(name: string, profileId: string | null): Promise<SavedView> {
    const controls = this.world.camera.controls;
    const hidden: Record<string, string[]> = {};
    for (const [id, ids] of Object.entries(this.hidden ?? {})) {
      const model = this.fragments.list.get(id);
      if (!model || !ids.size) continue;
      hidden[id] = (await model.getGuidsByLocalIds([...ids])).filter((g): g is string => !!g);
    }
    return {
      id: crypto.randomUUID(),
      name,
      camera: {
        position: controls.getPosition(new THREE.Vector3()).toArray(),
        target: controls.getTarget(new THREE.Vector3()).toArray(),
        projection: this.world.camera.projection.current,
      },
      sectionBox: this.sectionBox.corners(),
      hidden,
      ghost: this.current.ghost,
      profileId,
      thumbnail: this.snapshot(220),
    };
  }

  async selectionPlace(): Promise<[number, number, number] | null> {
    const sel = this.selected();
    if (!sel || !this.gridToScene) return null;
    const box = await this.boxOf(sel);
    if (!box) return null;
    const c = box.getCenter(new THREE.Vector3()).applyMatrix4(this.gridToScene.clone().invert());
    return [c.x, c.y, c.z];
  }

  async findAt(easting: number, northing: number): Promise<boolean> {
    if (!this.gridToScene || this.disposed) return false;
    const at = this.scenePoint(easting, northing, 0);
    const hit = await this.topHit(at.x, at.z);
    if (!hit) return false;
    await this.apply({ type: 'selectItems', items: { [hit.modelId]: [hit.localId] }, fit: true });
    return true;
  }

  cameraPlace(): PlaceCamera | null {
    if (!this.gridToScene) return null;
    const controls = this.world.camera.controls;
    const toGrid = this.gridToScene.clone().invert();
    const p = controls.getPosition(new THREE.Vector3()).applyMatrix4(toGrid);
    const t = controls.getTarget(new THREE.Vector3()).applyMatrix4(toGrid);
    const three = this.world.camera.three;
    return { position: p.toArray(), target: t.toArray(), projection: this.world.camera.projection.current, fov: three instanceof THREE.PerspectiveCamera ? three.fov : 60 };
  }

  planView(): PlanView | null {
    const cam = this.world.camera.three;
    const width = this.container.clientWidth;
    if (!this.gridToScene || this.current.nav !== 'Plan' || !(cam instanceof THREE.OrthographicCamera) || !width) return null;
    const toGrid = this.gridToScene.clone().invert();
    const target = this.world.camera.controls.getTarget(new THREE.Vector3());
    // Up on screen, laid flat: straight down, the camera's up is the heading.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).setY(0);
    if (up.lengthSq() < 1e-12) return null;
    up.normalize();
    const c = target.clone().applyMatrix4(toGrid);
    const a = target.clone().add(up).applyMatrix4(toGrid);
    const metresPerUnit = Math.hypot(a.x - c.x, a.y - c.y);
    if (!(metresPerUnit > 0)) return null;
    return {
      centre: [c.x, c.y],
      metresPerPixel: ((cam.right - cam.left) / cam.zoom / width) * metresPerUnit,
      up: [(a.x - c.x) / metresPerUnit, (a.y - c.y) / metresPerUnit],
    };
  }

  /** Looks straight down on a place at a scale and heading, in Plan navigation. */
  private async showPlan(v: PlanView): Promise<void> {
    const width = this.container.clientWidth;
    if (!this.gridToScene || !width || !(v.metresPerPixel > 0)) return;
    const camera = this.world.camera;
    if (this.current.nav !== 'Plan') {
      this.stopWalk();
      await camera.projection.set('Orthographic');
      camera.set('Plan');
      this.navigation.syncCameraMode('Plan', 'Orthographic');
      this.update({ nav: 'Plan', projection: 'Orthographic' });
    }
    const cam = camera.three;
    if (!(cam instanceof THREE.OrthographicCamera)) return;
    const controls = camera.controls;
    // The target keeps its height; the camera stands above it, a hair back from the heading so it keeps it.
    const height = controls.getTarget(new THREE.Vector3()).applyMatrix4(this.gridToScene.clone().invert()).z;
    const t = this.scenePoint(v.centre[0], v.centre[1], height);
    const u = this.scenePoint(v.centre[0] + v.up[0], v.centre[1] + v.up[1], height).sub(t);
    const unitsPerMetre = u.length();
    if (!(unitsPerMetre > 0)) return;
    u.normalize();
    const d = Math.max(controls.distance, 50);
    await Promise.all([
      controls.setLookAt(t.x - u.x * d * 1e-4, t.y + d, t.z - u.z * d * 1e-4, t.x, t.y, t.z, false),
      controls.zoomTo((cam.right - cam.left) / (width * v.metresPerPixel * unitsPerMetre), false),
    ]);
  }

  private async lookAtPlace(c: PlaceCamera): Promise<void> {
    if (!this.gridToScene) return;
    const camera = this.world.camera;
    if (this.current.nav !== 'Orbit') camera.set('Orbit');
    await camera.projection.set(c.projection);
    this.navigation.syncCameraMode('Orbit', c.projection);
    this.update({ nav: 'Orbit', projection: c.projection });
    const p = this.scenePoint(...c.position);
    const t = this.scenePoint(...c.target);
    await camera.controls.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, true);
  }

  snapshot(maxWidth: number): string | null {
    const renderer = this.world.renderer?.three;
    if (!renderer || this.disposed) return null;
    // Drawn now, so the picture is read before the browser clears the canvas.
    renderer.render(this.world.scene.three, this.world.camera.three);
    const src = renderer.domElement;
    if (!src.width || !src.height) return null;
    const k = Math.min(1, maxWidth / src.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * k));
    out.height = Math.max(1, Math.round(src.height * k));
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.8);
  }

  // --- review tools: comparing revisions, quantities, the mini-map and walking ---

  async compare(ifc: Uint8Array, name: string): Promise<RevisionDiff> {
    await this.endCompare();
    const [mine] = this.own();
    if (!mine) throw new Error('There is no model to compare with.');
    const frags = await this.convert(ifc, {});
    if (this.disposed) throw new DOMException('The view was closed.', 'AbortError');
    const otherId = `compare:${crypto.randomUUID()}`;
    this.compareId = otherId;
    const other = await this.fragments.core.load(frags, { modelId: otherId, camera: this.world.camera.three });
    const { diff, shift } = diffRevisions(await this.revisionItems(mine[1]), await this.revisionItems(other), { mine: mine[0], theirs: otherId, other: name });
    // Two conversions can place the same file differently: line the other up with this one.
    other.object.position.add(new THREE.Vector3(...shift));
    other.object.updateMatrixWorld(true);
    await this.showComparison(diff, mine[1], other);
    this.update({ comparing: name });
    return diff;
  }

  /** A model's elements with geometry, as compared: GlobalId, name, class, properties and bounds. */
  private async revisionItems(model: FragmentsModel): Promise<RevisionItem[]> {
    const out: RevisionItem[] = [];
    for (const [category, ids] of Object.entries(await this.itemsByCategory(model))) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const [data, boxes] = await Promise.all([model.getItemsData(part, WITH_PSETS) as Promise<RawItem[]>, model.getBoxes(part)]);
        part.forEach((localId, j) => {
          const item = data[j];
          const guid = attrText(item?._guid);
          if (!item || !guid) return;
          const box = boxes[j];
          out.push({
            guid,
            localId,
            name: attrText(item.Name) || category,
            category,
            props: flatProperties(propertyGroups(item)),
            box: box && !box.isEmpty() ? [box.min.toArray(), box.max.toArray()] : null,
          });
        });
      }
    }
    return out;
  }

  /** Colours a comparison: added and changed in this model, the rest faint, and of the other only what was removed, in red. */
  private async showComparison(diff: RevisionDiff, mine: FragmentsModel, other: FragmentsModel): Promise<void> {
    this.compared = { diff, mine, other };
    // What is selected keeps its highlight; the rest takes the comparison's colours.
    const sel = this.highlighter?.selection.select ?? {};
    const skip = (model: FragmentsModel) => sel[model.modelId] ?? new Set<number>();
    const [skipMine, skipOther] = [skip(mine), skip(other)];
    const ids = (list: { localId: number }[], skipped = skipMine) => list.map((e) => e.localId).filter((id) => !skipped.has(id));
    const all = Object.values(await this.itemsByCategory(mine)).flat().filter((id) => !skipMine.has(id));
    if (all.length) await mine.setOpacity(all, GHOST_OPACITY);
    for (const [list, colour] of [
      [diff.added, COMPARE_COLOURS.added],
      [diff.changed, COMPARE_COLOURS.changed],
    ] as const) {
      if (!ids(list).length) continue;
      await mine.resetOpacity(ids(list));
      await mine.setColor(ids(list), new THREE.Color(colour));
    }
    const theirs = Object.values(await this.itemsByCategory(other)).flat();
    const removed = diff.removed.map((e) => e.localId);
    if (theirs.length) await other.setVisible(theirs.filter((id) => !removed.includes(id)), false);
    if (removed.length) await other.setVisible(removed, true);
    if (ids(diff.removed, skipOther).length) await other.setColor(ids(diff.removed, skipOther), new THREE.Color(COMPARE_COLOURS.removed));
    await this.fragments.core.update(true);
  }

  private async endCompare(): Promise<void> {
    const id = this.compareId;
    if (!id) return;
    this.compareId = null;
    this.compared = null;
    const model = this.fragments.list.get(id);
    if (model) {
      await this.highlighter?.clear('select');
      model.object.removeFromParent();
      await this.fragments.core.disposeModel(id);
    }
    for (const [, m] of this.own()) {
      await m.resetColor(undefined);
      await m.resetOpacity(undefined);
    }
    await this.showHidden();
    this.update({ comparing: null, profileId: null });
  }

  async quantities(groupBy: string, scope: 'all' | 'selection'): Promise<QuantityTable> {
    const selected = scope === 'selection' ? this.selected() : null;
    const rows = new Map<string, QuantityRow>();
    const names = new Set<string>();
    for (const [id, model] of this.own()) {
      const pick = selected?.[id];
      for (const [category, all] of Object.entries(await this.itemsByCategory(model))) {
        const ids = scope === 'selection' ? all.filter((l) => pick?.has(l)) : all;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const part = ids.slice(i, i + CHUNK);
          const data = (await model.getItemsData(part, WITH_PSETS)) as RawItem[];
          part.forEach((localId, j) => {
            const item = data[j];
            if (!item) return;
            const groups = propertyGroups(item);
            for (const g of groups) if (!g.quantities) for (const [n] of g.rows) names.add(n);
            const key = groupKey(groups, category, groupBy);
            const q = quantitiesOf(groups);
            const row = rows.get(key) ?? { key, count: 0, length: 0, area: 0, volume: 0, items: {} };
            row.count++;
            row.length += q.length;
            row.area += q.area;
            row.volume += q.volume;
            (row.items[id] ??= []).push(localId);
            rows.set(key, row);
          });
        }
      }
    }
    // Where no quantity set gave a volume, measure the shapes.
    for (const row of rows.values()) {
      if (row.volume) continue;
      let v = 0;
      for (const [mid, ids] of Object.entries(row.items)) v += (await this.fragments.list.get(mid)?.getItemsVolume(ids).catch(() => 0)) ?? 0;
      if (v > 0) Object.assign(row, { volume: v, measuredVolume: true });
    }
    names.delete('GlobalId');
    return {
      groupBy,
      rows: [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
      properties: [BY_CLASS, ...[...names].sort((a, b) => a.localeCompare(b))],
    };
  }

  /** Where the mini-map is in the view (CSS pixels from the canvas's top left), while it shows. */
  miniMapArea(): { left: number; top: number; size: number } | null {
    return this.current.miniMap ? (this.mini?.area ?? null) : null;
  }

  /** The bounds of every model in the view. */
  private allBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const model of this.fragments.list.values()) if (model.object.visible) box.union(this.modelBox(model));
    return box;
  }

  /** After each frame, the mini-map in the bottom-right corner: the models from straight above, with the camera's place and heading. */
  private drawMiniMap(): void {
    if (!this.current.miniMap || this.disposed) return;
    const renderer = this.world.renderer?.three;
    const box = this.allBox();
    if (!renderer || box.isEmpty()) return;
    if (!this.mini) {
      const shape = new THREE.Shape([new THREE.Vector2(0, -1), new THREE.Vector2(0.6, 0.7), new THREE.Vector2(0, 0.3), new THREE.Vector2(-0.6, 0.7)]);
      const marker = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#e03131', depthTest: false, side: THREE.DoubleSide }));
      // The shape is drawn in x/y; lay it flat, pointing north (-z).
      marker.geometry.rotateX(Math.PI / 2);
      marker.renderOrder = 10;
      // Only the mini-map's camera sees layer 1.
      marker.layers.set(1);
      this.world.scene.three.add(marker);
      const camera = new THREE.OrthographicCamera();
      camera.layers.enable(1);
      camera.up.set(0, 0, -1);
      this.mini = { camera, marker, area: null };
    }
    const size = renderer.getSize(new THREE.Vector2());
    const side = Math.round(Math.min(180, size.x * 0.3, size.y * 0.4));
    if (side < 60) return void (this.mini.area = null);
    const [x, y] = [size.x - side - 10, 10];
    this.mini.area = { left: x, top: size.y - y - side, size: side };
    const { camera, marker } = this.mini;
    const centre = box.getCenter(new THREE.Vector3());
    const half = (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2) * 1.08 || 1;
    Object.assign(camera, { left: -half, right: half, top: half, bottom: -half, near: 0.1, far: box.max.y - box.min.y + 2000 });
    camera.position.set(centre.x, box.max.y + 1000, centre.z);
    camera.lookAt(centre.x, box.min.y, centre.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const eye = this.world.camera.controls.getPosition(new THREE.Vector3());
    marker.position.set(eye.x, box.max.y + 1, eye.z);
    marker.rotation.y = -this.orientation().yaw;
    marker.scale.setScalar(half / 14);
    const colour = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, side, side);
    renderer.setViewport(x, y, side, side);
    renderer.setClearColor('#20252b', 0.9);
    renderer.clear(true, true, false);
    renderer.render(this.world.scene.three, camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.setClearColor(colour, alpha);
  }

  /** Where a mouse event is on the mini-map (0..1 across and down), or null when it is not on it. */
  private onMiniMap(e: MouseEvent): [number, number] | null {
    const area = this.miniMapArea();
    const dom = this.world.renderer?.three.domElement;
    if (!area || !dom) return null;
    const rect = dom.getBoundingClientRect();
    const [u, v] = [(e.clientX - rect.left - area.left) / area.size, (e.clientY - rect.top - area.top) / area.size];
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v];
  }

  /** A press on the mini-map moves the camera over that spot (keeping how it looks), instead of turning the view. */
  private miniMapClick(e: PointerEvent): void {
    const uv = this.onMiniMap(e);
    if (!uv || !this.mini) return;
    const [u, v] = uv;
    e.stopPropagation();
    e.preventDefault();
    const at = new THREE.Vector3(u * 2 - 1, 1 - v * 2, 0).unproject(this.mini.camera);
    void this.moveOver(at.x, at.z);
  }

  private async moveOver(x: number, z: number): Promise<void> {
    const controls = this.world.camera.controls;
    const p = controls.getPosition(new THREE.Vector3());
    const t = controls.getTarget(new THREE.Vector3());
    const [dx, dz] = [x - t.x, z - t.z];
    if (this.current.nav === 'Walk') {
      // Walking: stand on whatever is there.
      const floor = await this.castRay(new THREE.Vector3(x, this.allBox().max.y + 100, z), new THREE.Vector3(0, -1, 0));
      const dy = floor ? floor.point.y + WALK.eye - p.y : 0;
      return void (await controls.setLookAt(x, p.y + dy, z, x + t.x - p.x, t.y + dy, z + t.z - p.z, false));
    }
    await controls.setLookAt(p.x + dx, p.y, p.z + dz, x, t.y, z, true);
  }

  /** Walking: from where the camera looks (the middle of the view), at eye height, looking level. */
  private async startWalk(): Promise<void> {
    const camera = this.world.camera;
    const dom = this.world.renderer?.three.domElement;
    await camera.projection.set('Perspective');
    const controls = camera.controls;
    const from = controls.getPosition(new THREE.Vector3());
    const look = camera.three.getWorldDirection(new THREE.Vector3());
    let ground: THREE.Vector3 | null = null;
    if (dom) {
      const rect = dom.getBoundingClientRect();
      ground = (await this.nearestHit(camera.three, new THREE.Vector2(rect.left + rect.width / 2, rect.top + rect.height / 2), dom, from))?.point ?? null;
    }
    if (!ground) {
      const t = controls.getTarget(new THREE.Vector3());
      ground = (await this.castRay(new THREE.Vector3(t.x, this.allBox().max.y + 100, t.z), new THREE.Vector3(0, -1, 0)))?.point ?? null;
    }
    const flat = new THREE.Vector3(look.x, 0, look.z);
    if (flat.lengthSq() < 1e-8) flat.set(0, 0, -1);
    flat.normalize();
    camera.set('FirstPerson');
    this.navigation.syncCameraMode('Walk', 'Perspective');
    const eye = ground ? ground.clone().setY(ground.y + WALK.eye) : from;
    await controls.setLookAt(eye.x, eye.y, eye.z, eye.x + flat.x, eye.y, eye.z + flat.z, false);
    this.update({ nav: 'Walk', projection: 'Perspective' });
    this.walkKeys.clear();
    this.walkLast = performance.now();
    this.walkFrame = requestAnimationFrame(this.walkTick);
  }

  private stopWalk(): void {
    cancelAnimationFrame(this.walkFrame);
    this.walkFrame = 0;
    this.walkKeys.clear();
  }

  private walkKey(e: KeyboardEvent, down: boolean): void {
    if (this.current.nav !== 'Walk') return;
    const k = e.key.toLowerCase();
    this.walkRun = e.shiftKey;
    if (!down) return void this.walkKeys.delete(k);
    // Only while the pointer is over this view, and not while typing in a box.
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (!WALK_KEYS.has(k) || typing || !this.container.matches(':hover')) return;
    this.walkKeys.add(k);
    e.preventDefault();
    e.stopPropagation();
  }

  private readonly walkTick = (now: number): void => {
    if (this.disposed || this.current.nav !== 'Walk') return;
    this.walkFrame = requestAnimationFrame(this.walkTick);
    // A step still finding where it lands: the time carries over to the next one.
    if (this.walkBusy) return;
    const dt = Math.min(0.25, (now - this.walkLast) / 1000);
    this.walkLast = now;
    const [dx, dz] = walkMove(this.walkKeys, this.orientation().yaw, dt, this.walkRun);
    if (!dx && !dz) return;
    this.walkBusy = true;
    void this.walkStep(dx, dz, dt)
      .catch((err: unknown) => console.warn('3D view: walking:', err))
      .finally(() => (this.walkBusy = false));
  };

  /** One stride: stopped short of walls (a ray ahead at knee height), then onto the floor below (a ray down). */
  private async walkStep(dx: number, dz: number, dt: number): Promise<void> {
    const controls = this.world.camera.controls;
    const pos = controls.getPosition(new THREE.Vector3());
    const ahead = controls.getTarget(new THREE.Vector3()).sub(pos);
    const move = new THREE.Vector3(dx, 0, dz);
    const length = move.length();
    const knee = pos.clone().setY(pos.y - WALK.eye + WALK.step + 0.05);
    const wall = await this.castRay(knee, move.clone().normalize(), length + WALK.reach);
    const next = wall ? pos.clone() : pos.clone().add(move);
    if (wall && wall.distance > WALK.reach) next.add(move.setLength(wall.distance - WALK.reach));
    // Steps up to knee height are climbed; with nothing below, the walker falls (9 m/s) or stays put.
    const floor = await this.castRay(next.clone().setY(next.y - WALK.eye + WALK.step), new THREE.Vector3(0, -1, 0), 10_000);
    if (floor) next.y = Math.max(floor.point.y + WALK.eye, Math.min(next.y, next.y - 9 * dt));
    if (this.disposed || this.current.nav !== 'Walk' || next.distanceTo(pos) < 1e-6) return;
    await controls.setLookAt(next.x, next.y, next.z, next.x + ahead.x, next.y + ahead.y, next.z + ahead.z, false);
  }

  /** Goes back to a saved view: its camera, section box, hidden elements and colour profile. */
  private async applyView(view: SavedView, profile: ResolvedProfile | null): Promise<void> {
    const camera = this.world.camera;
    if (this.current.nav !== 'Orbit') camera.set('Orbit');
    await camera.projection.set(view.camera.projection);
    this.navigation.syncCameraMode('Orbit', view.camera.projection);
    this.update({ nav: 'Orbit', projection: view.camera.projection });
    const [p, t] = [view.camera.position, view.camera.target];
    await camera.controls.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], true);
    const clipper = this.components.get(OBC.Clipper);
    clipper.deleteAll();
    this.sectionBox.clear();
    if (view.sectionBox) this.makeSectionBox(...view.sectionBox);
    else this.update({ sectionBox: false, clipPlanes: this.clipCount() });
    await this.showAll();
    const hide: OBC.ModelIdMap = {};
    for (const [id, guids] of Object.entries(view.hidden)) {
      const model = this.fragments.list.get(id);
      if (!model || !guids.length) continue;
      hide[id] = new Set((await model.getLocalIdsByGuids(guids)).filter((l): l is number => l !== null));
    }
    if (!isEmpty(hide)) await this.components.get(OBC.Hider).set(false, hide);
    this.hidden = isEmpty(hide) ? null : hide;
    this.update({ ghost: view.ghost });
    await this.showHidden();
    await this.applyProfile(view.profileId, profile);
  }

  /** Shows a colour profile (its sets already searched), taking off the one before; null shows none. */
  private async applyProfile(id: string | null, profile: ResolvedProfile | null): Promise<void> {
    for (const [mid, ids] of Object.entries(this.profileHidden)) {
      const model = this.fragments.list.get(mid);
      const stillHidden = this.hidden?.[mid];
      const show = [...ids].filter((l) => !stillHidden?.has(l));
      if (model && show.length) await model.setVisible(show, true);
    }
    this.profileHidden = {};
    for (const model of this.fragments.list.values()) {
      await model.resetColor(undefined);
      await model.resetOpacity(undefined);
    }
    // Ghosted hidden elements lost their opacity with the reset above.
    await this.showHidden();
    for (const { items, action } of profile ?? []) {
      for (const [mid, ids] of Object.entries(items)) {
        const model = this.fragments.list.get(mid);
        if (!model || !ids.length) continue;
        if (action.kind === 'colour') await model.setColor(ids, new THREE.Color(action.colour));
        else if (action.kind === 'ghost') await model.setOpacity(ids, GHOST_OPACITY);
        else {
          await model.setVisible(ids, false);
          const set = (this.profileHidden[mid] ??= new Set());
          for (const l of ids) set.add(l);
        }
      }
    }
    await this.fragments.core.update(true);
    this.update({ profileId: profile ? id : null });
  }

  private update(patch: Partial<ModelState>): void {
    this.current = { ...this.current, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false) {
    target.addEventListener(type, fn, capture);
    this.offs.push(() => target.removeEventListener(type, fn, capture));
  }

  /** Looks at what the camera is looking at from a direction (top, front, ...), keeping the distance. */
  private async look(direction: ViewDirection): Promise<void> {
    const controls = this.world.camera.controls;
    const target = controls.getTarget(new THREE.Vector3());
    const [x, y, z] = directionOffset(direction, Math.max(controls.distance, 1));
    await controls.setLookAt(target.x + x, target.y + y, target.z + z, target.x, target.y, target.z, true);
  }

  /** The elements selected, or null. */
  private selected(): OBC.ModelIdMap | null {
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
        await model.setOpacity(ids, this.displayPrefs.ghostOpacity || GHOST_OPACITY);
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
    if (this.sectionBox.active) {
      this.sectionBox.clear();
      return this.update({ sectionBox: false, clipPlanes: this.clipCount() });
    }
    const box = await this.boxOf(this.selected());
    if (!box) return;
    this.makeSectionBox(...padBox(box.min.toArray(), box.max.toArray()));
  }

  /**
   * A section box around [min, max]: its walls are the section box controller's own planes (not
   * the clipper's), each with a handle that drags it along its axis with any tool.
   */
  private makeSectionBox(min: Vec3, max: Vec3): void {
    this.sectionBox.set(min, max);
    this.update({ sectionBox: true, clipPlanes: this.clipCount() });
  }

  /** Clipping planes in the view: the clipper's and the section box's six. */
  private clipCount(): number {
    return this.components.get(OBC.Clipper).list.size + (this.sectionBox.active ? 6 : 0);
  }

  private setTool(tool: ModelTool): void {
    this.components.get(OBC.Clipper).enabled = tool === 'clip';
    this.measure.setTool(isMeasureTool(tool) ? tool : null);
    if (this.highlighter) this.highlighter.enabled = tool === 'select';
    this.update({ tool });
  }

  /** A double-click with the Clipping Plane tool places a plane on the surface under the pointer. */
  private async placeClipPlane(): Promise<void> {
    if (this.current.tool !== 'clip') return;
    const clipper = this.components.get(OBC.Clipper);
    await clipper.create(this.world);
    this.update({ clipPlanes: this.clipCount() });
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') return this.escape(e);
    // Only while the pointer is over this view: other panes and dialogs keep their keys.
    if (!this.container.matches(':hover') || isTyping(e.target)) return;
    const tool = this.current.tool;
    if (tool === 'select') return;
    if (tool === 'clip') {
      if (e.key !== 'Delete') return;
      const clipper = this.components.get(OBC.Clipper);
      void clipper.delete(this.world).then(() => this.update({ clipPlanes: this.clipCount() }));
      return;
    }
    if (e.key === 'Enter') this.measure.commit();
    else if (e.key === 'Delete') this.measure.deleteLast();
  }

  /**
   * Escape, while this view is the one on screen (wherever the pointer is): a measurement half made
   * is dropped and the tool goes back to Select Elements. Not while typing in a box or with a
   * dialog open, which keep Escape for themselves.
   */
  private escape(e: KeyboardEvent): void {
    if (this.disposed || !this.visible || isTyping(e.target)) return;
    if (!this.container.isConnected || !this.container.getClientRects().length) return;
    if (document.querySelector('.modal-backdrop, dialog[open], [role="dialog"][aria-modal="true"]')) return;
    const busy = this.measure.cancel();
    if (this.current.tool === 'select') return;
    this.setTool('select');
    if (busy) e.preventDefault();
  }

  /**
   * What the pointer is on, snapped: an element's corner when one is within a few pixels, else a
   * point on one of its edges, else the surface. Corners and edges hidden behind a nearer surface
   * are not snapped to.
   */
  private async snapAt(clientX: number, clientY: number): Promise<SnapHit | null> {
    const dom = this.world.renderer?.three.domElement;
    if (!dom || this.disposed) return null;
    const camera = this.world.camera.three;
    const mouse = new THREE.Vector2(clientX, clientY);
    const rect = dom.getBoundingClientRect();
    const px = (p: THREE.Vector3) => {
      const v = p.clone().project(camera);
      return Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - clientX, rect.top + ((1 - v.y) / 2) * rect.height - clientY);
    };
    const eye = this.world.camera.controls.getPosition(new THREE.Vector3(), false);
    const depth = (p: THREE.Vector3) => p.distanceTo(eye);
    type Found = SnapHit & { px: number; depth: number };
    let face: Found | null = null;
    const vertices: Found[] = [];
    const edges: Found[] = [];
    for (const [modelId, model] of this.fragments.list) {
      if (!model.object.visible) continue;
      const results = await model
        .raycastWithSnapping({ camera: camera as THREE.PerspectiveCamera, mouse, dom, snappingClasses: [SnappingClass.POINT, SnappingClass.LINE, SnappingClass.FACE] })
        .catch(() => null);
      if (!results?.length) {
        // No snapping data: the plain surface hit.
        const r = await model.raycast({ camera: camera as THREE.PerspectiveCamera, mouse, dom }).catch(() => null);
        if (r && (!face || depth(r.point) < face.depth)) face = { point: r.point.clone(), kind: 'face', modelId, localId: r.localId, px: 0, depth: depth(r.point) };
        continue;
      }
      model.object.updateMatrixWorld();
      for (const r of results) {
        const point = r.point.clone();
        const found: Found = { point, kind: 'face', modelId, localId: r.localId, px: px(point), depth: depth(point) };
        if (r.snappingClass === SnappingClass.POINT) vertices.push({ ...found, kind: 'vertex' });
        else if (r.snappingClass === SnappingClass.LINE) {
          edges.push({ ...found, kind: 'edge' });
          // An edge's ends are corners too.
          for (const end of [r.snappedEdgeP1, r.snappedEdgeP2]) if (end) vertices.push({ ...found, point: end.clone(), kind: 'vertex', px: px(end), depth: depth(end) });
        } else {
          if (!face || found.depth < face.depth) face = found;
          // The corners of the face hit are corners to snap to as well.
          const fp = r.facePoints;
          if (fp) {
            for (let i = 0; i + 2 < fp.length; i += 3) {
              const v = new THREE.Vector3(fp[i], fp[i + 1], fp[i + 2]).applyMatrix4(model.object.matrixWorld);
              vertices.push({ ...found, point: v, kind: 'vertex', px: px(v), depth: depth(v) });
            }
          }
        }
      }
    }
    // Behind the nearest surface (with a little room for the edges of that surface itself) is hidden.
    const limit = face ? face.depth * 1.01 + 0.05 : Infinity;
    const best = (list: Found[], within: number) =>
      list.filter((f) => f.px <= within && f.depth <= limit).sort((a, b) => a.px - b.px || a.depth - b.depth)[0] ?? null;
    const pick = best(vertices, SNAP_VERTEX_PX) ?? best(edges, SNAP_EDGE_PX) ?? face;
    return pick ? { point: pick.point, kind: pick.kind, modelId: pick.modelId, localId: pick.localId } : null;
  }

  /** An element's volume: its quantity set's when it has one, else measured from its shape; and its bounds. */
  private async volumeOf(modelId: string, localId: number): Promise<{ volume: number; box: THREE.Box3 | null } | null> {
    const model = this.fragments.list.get(modelId);
    if (!model) return null;
    const data = (await model.getItemsData([localId], WITH_PSETS).catch(() => [])) as RawItem[];
    const item = data[0];
    let volume = item ? quantitiesOf(propertyGroups(item)).volume : 0;
    if (!(volume > 0)) volume = await model.getItemsVolume([localId]).catch(() => 0);
    const boxes = await model.getBoxes([localId]).catch(() => [] as THREE.Box3[]);
    const raw = boxes[0];
    model.object.updateMatrixWorld(true);
    const box = raw && !raw.isEmpty() ? raw.clone().applyMatrix4(model.object.matrixWorld) : null;
    return { volume: volume > 0 ? volume : NaN, box };
  }

  /** Clicking an element selects it (with the Select tool). */
  private setupSelection(): void {
    if (!this.highlighter) {
      const h = this.components.get(OBF.Highlighter);
      h.setup({ world: this.world, selectMaterialDefinition: { color: new THREE.Color('#2f9bff'), opacity: 1, transparent: false, renderedFaces: 0 } });
      h.zoomToSelection = false;
      const count = () =>
        this.update({ selected: Object.values(h.selection.select ?? {}).reduce((n, s) => n + s.size, 0), selectionVersion: this.current.selectionVersion + 1 });
      // A highlight put back to normal also loses a comparison's colours: they go on again.
      const recolour = () => {
        const c = this.compared;
        if (c && this.compareId && !this.disposed) void this.showComparison(c.diff, c.mine, c.other).catch(() => {});
      };
      h.events.select?.onHighlight.add(count);
      h.events.select?.onClear.add(count);
      h.events.select?.onHighlight.add(recolour);
      h.events.select?.onClear.add(recolour);
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
    const seen = new Set<string>();
    const list: { id: string; label: string; kind: 'storey' | 'elevation' }[] = [];
    for (const v of storeys) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      list.push({ id: v.id, label: v.id, kind: 'storey' });
    }
    for (const v of elevations) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      list.push({ id: v.id, label: v.id, kind: 'elevation' });
    }
    this.update({ views: list });
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
    const wasEmpty = this.own().length === 0;
    const frags = options.fragments ?? (await this.convert(ifc, options));
    if (this.disposed) throw new DOMException('The view was closed.', 'AbortError');
    options.onProgress?.({ stage: 'load', fraction: 0 });
    // The worker takes the buffer it is given, so keep our own copy to return.
    const model = await this.fragments.core.load(frags.slice(), { modelId, camera: this.world.camera.three });
    if (this.disposed) throw new DOMException('The view was closed.', 'AbortError');
    const [cx = 0, cy = 0, cz = 0] = await model.getCoordinates();
    if (this.baseCoords === null) {
      this.baseCoords = [cx, cy, cz];
    } else {
      // Align shared IFC world coordinates against the first model's origin (overridden if georeferenced).
      model.object.position.set(this.baseCoords[0] - cx, this.baseCoords[1] - cy, this.baseCoords[2] - cz);
      model.object.updateMatrixWorld(true);
      await this.fragments.core.update(true);
    }
    options.onProgress?.({ stage: 'load', fraction: 1 });
    this.names.set(modelId, options.name ?? modelId);
    this.elementCounts.set(modelId, Object.values(await this.itemsByCategory(model)).reduce((n, ids) => n + ids.length, 0));
    this.update({ modelsVersion: this.current.modelsVersion + 1 });
    if (options.fit ?? wasEmpty) await this.fitAll();
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
    if (this.disposed) return;
    const box = this.allBox();
    if (box.isEmpty()) return;
    await this.frame(box, 1.1);
  }

  /**
   * Moves the camera to frame a box, with room around it (`pad` times its bounding sphere, at
   * least half a metre), and sets the near plane for the distance it ends at so nothing is cut.
   */
  private async frame(box: THREE.Box3, pad = 1.4): Promise<void> {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = framedRadius(sphere.radius, pad);
    const controls = this.world.camera.controls;
    // Set for the end of the move first, so the frames on the way there are not cut either.
    const persp = this.world.camera.threePersp;
    const near = nearFor(controls.getDistanceToFitSphere(sphere.radius));
    if (near < persp.near) {
      persp.near = near;
      persp.updateProjectionMatrix();
    }
    await controls.fitToSphere(sphere, true);
    this.updateClipRange();
  }

  /** Stops drawing while the view is not on screen (another tab in front, or the window hidden), and starts again. */
  setVisible(visible: boolean): void {
    if (this.disposed) return;
    // Only the drawing pauses: switching the components off ends their animation loop for good
    // (it stops scheduling itself and nothing starts it again).
    this.visible = visible;
    this.components.get(OBC.Worlds).enabled = visible;
    if (visible) {
      this.world.renderer?.resize();
      void this.fragments.core.update(true);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWalk();
    this.navigation.dispose();
    this.measure.dispose();
    this.sectionBox.dispose();
    this.skyTexture?.dispose();
    this.skyTexture = null;
    this.resize.disconnect();
    for (const off of this.offs) off();
    this.listeners.clear();
    for (const { object } of this.sheets.values()) disposeObject(object);
    this.sheets.clear();
    if (this.mini) disposeObject(this.mini.marker);
    this.mini = null;
    // The handlers this view gave the library's events go first: anything left holding a camera,
    // world or list (a resize observer on the old canvas, say) then holds nothing of this view.
    const camera = this.world.camera;
    camera.controls.removeAllEventListeners();
    camera.projection.onChanged.reset();
    this.world.renderer?.onAfterUpdate.reset();
    this.world.renderer?.onResize.reset();
    this.fragments.list.onItemSet.reset();
    this.highlighter?.events.select?.onHighlight.reset();
    this.highlighter?.events.select?.onClear.reset();
    this.components.dispose();
  }
}

/** Whether a key went to a text box (which keeps its keys). */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Vertical sky gradient texture for the 'sky' background preset. */
function makeSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#6e9fd1');
  grad.addColorStop(0.52, '#c8dff2');
  grad.addColorStop(0.56, '#dfe2e5');
  grad.addColorStop(1, '#c5c2bc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Frees what a sheet overlay drew with: geometry, materials and their pictures. */
function disposeObject(object: THREE.Object3D): void {
  object.removeFromParent();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of materials) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}
