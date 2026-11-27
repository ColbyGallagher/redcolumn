import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import type { FragmentsModel } from '@thatopen/fragments';
import type { ConvertReply, ConvertRequest } from './convert.worker.ts';
import {
  boxPlanes,
  directionOffset,
  INITIAL_STATE,
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
  type ModelInfo,
  type ModelState,
  type ModelTool,
  type PlaceCamera,
  type ResolvedProfile,
  type SheetOverlay,
  type SavedView,
  type SearchSet,
  type SelectionInfo,
  type TreeNode,
  type ViewDirection,
} from './controls.ts';
import { attrText, flatProperties, groupKey, matchesProperty, propertyGroups, quantitiesOf, type RawItem } from './items.ts';

type Measurer = OBF.LengthMeasurement | OBF.AreaMeasurement | OBF.AngleMeasurement | OBF.VolumeMeasurement;
type MeasureTool = 'length' | 'area' | 'angle' | 'volume';
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
  /** The section box's corners while there is one. */
  private boxCorners: [Vec3, Vec3] | null = null;
  /** Elements a colour profile hides, kept apart from those hidden with Hide and Isolate. */
  private profileHidden: OBC.ModelIdMap = {};
  private readonly names = new Map<string, string>();
  private readonly elementCounts = new Map<string, number>();
  /** Grid (easting, northing, height) to scene, from the first georeferenced model. */
  private gridToScene: THREE.Matrix4 | null = null;
  /** Sheets shown in the view, by overlay id. */
  private readonly sheets = new Map<string, { version: string; object: THREE.Object3D }>();
  private readonly sheetGroup = new THREE.Group();
  /** Goes up with each change of the sheets, so a slow drape left behind by a newer one stops. */
  private sheetRun = 0;
  private hidden: OBC.ModelIdMap | null = null;
  private readonly measurers = new Map<MeasureTool, Measurer>();
  private readonly offs: (() => void)[] = [];
  /** The other revision loaded to compare with, while there is one. */
  private compareId: string | null = null;
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
    this.world.renderer!.onAfterUpdate.add(() => this.drawMiniMap());
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
        this.stopWalk();
        if (a.mode === 'Walk') {
          await this.startWalk();
          return;
        }
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
        const box = await this.boxOf(this.selected());
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
        this.boxCorners = null;
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
        for (const m of this.measurers.values()) m.list.clear();
        return this.update({ measurements: 0 });
      case 'modelVisible': {
        const model = this.fragments.list.get(a.modelId);
        if (!model) return;
        model.object.visible = a.visible;
        await this.fragments.core.update(true);
        return this.update({ modelsVersion: this.current.modelsVersion + 1 });
      }
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
      case 'miniMap':
        return this.update({ miniMap: !this.current.miniMap });
      case 'endCompare':
        return this.endCompare();
    }
  }

  // --- sheets in the model (where both are on the map) ---

  /**
   * Places a model on the map: `matrix` takes its IFC coordinates (Z up) to grid easting, northing
   * and height (column-major 4x4, from its IfcMapConversion). The fragments are drawn Y up (north
   * -Z) and moved by the model's coordinates, so grid to scene is that move, the axis swap, and the
   * inverse of `matrix`.
   */
  private async georeference(modelId: string, matrix: number[]): Promise<void> {
    const model = this.fragments.list.get(modelId);
    if (!model || this.gridToScene) return;
    const [cx = 0, cy = 0, cz = 0] = await model.getCoordinates();
    const toGrid = new THREE.Matrix4().fromArray(matrix);
    if (Math.abs(toGrid.determinant()) < 1e-12) return;
    // Scene (x, y, z) = (X, Z, -Y) + the model's coordinates, from IFC (X, Y, Z).
    const swap = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    this.gridToScene = new THREE.Matrix4().makeTranslation(cx, cy, cz).multiply(swap).multiply(toGrid.invert());
    const sceneToGrid = this.gridToScene.clone().invert();
    const box = model.box;
    const lo = new THREE.Vector3(box.min.x, box.min.y, box.min.z).applyMatrix4(sceneToGrid).z;
    const hi = new THREE.Vector3(box.max.x, box.max.y, box.max.z).applyMatrix4(sceneToGrid).z;
    this.update({ georeferenced: true, heights: [Math.min(lo, hi), Math.max(lo, hi)] });
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
      sectionBox: this.boxCorners,
      hidden,
      ghost: this.current.ghost,
      profileId,
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

  private async lookAtPlace(c: PlaceCamera): Promise<void> {
    if (!this.gridToScene) return;
    const camera = this.world.camera;
    if (this.current.nav !== 'Orbit') camera.set('Orbit');
    await camera.projection.set(c.projection);
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
    const ids = (list: { localId: number }[]) => list.map((e) => e.localId);
    const all = Object.values(await this.itemsByCategory(mine)).flat();
    if (all.length) await mine.setOpacity(all, GHOST_OPACITY);
    for (const [list, colour] of [
      [diff.added, COMPARE_COLOURS.added],
      [diff.changed, COMPARE_COLOURS.changed],
    ] as const) {
      if (!list.length) continue;
      await mine.resetOpacity(ids(list));
      await mine.setColor(ids(list), new THREE.Color(colour));
    }
    const theirs = Object.values(await this.itemsByCategory(other)).flat();
    if (theirs.length) await other.setVisible(theirs, false);
    if (diff.removed.length) {
      await other.setVisible(ids(diff.removed), true);
      await other.setColor(ids(diff.removed), new THREE.Color(COMPARE_COLOURS.removed));
    }
    await this.fragments.core.update(true);
  }

  private async endCompare(): Promise<void> {
    const id = this.compareId;
    if (!id) return;
    this.compareId = null;
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
    for (const model of this.fragments.list.values()) if (model.object.visible) box.union(model.box);
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
    this.update({ nav: 'Orbit', projection: view.camera.projection });
    const [p, t] = [view.camera.position, view.camera.target];
    await camera.controls.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], true);
    const clipper = this.components.get(OBC.Clipper);
    clipper.deleteAll();
    this.boxPlaneIds = [];
    this.boxCorners = null;
    if (view.sectionBox) this.makeSectionBox(...view.sectionBox);
    else this.update({ sectionBox: false, clipPlanes: clipper.list.size });
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
      this.boxCorners = null;
      return this.update({ sectionBox: false, clipPlanes: clipper.list.size });
    }
    const box = await this.boxOf(this.selected());
    if (!box) return;
    this.makeSectionBox(...padBox(box.min.toArray(), box.max.toArray()));
  }

  private makeSectionBox(min: Vec3, max: Vec3): void {
    const clipper = this.components.get(OBC.Clipper);
    this.boxCorners = [min, max];
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
      const count = () =>
        this.update({ selected: Object.values(h.selection.select ?? {}).reduce((n, s) => n + s.size, 0), selectionVersion: this.current.selectionVersion + 1 });
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
    const model = await this.fragments.core.load(frags.slice(), { modelId, camera: this.world.camera.three });
    options.onProgress?.({ stage: 'load', fraction: 1 });
    this.names.set(modelId, options.name ?? modelId);
    this.elementCounts.set(modelId, Object.values(await this.itemsByCategory(model)).reduce((n, ids) => n + ids.length, 0));
    this.update({ modelsVersion: this.current.modelsVersion + 1 });
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
    // Only the drawing pauses: switching the components off ends their animation loop for good
    // (it stops scheduling itself and nothing starts it again).
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
    this.resize.disconnect();
    for (const off of this.offs) off();
    this.listeners.clear();
    for (const { object } of this.sheets.values()) disposeObject(object);
    this.sheets.clear();
    this.components.dispose();
  }
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
