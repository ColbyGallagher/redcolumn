import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import type { ConvertReply, ConvertRequest } from './convert.worker.ts';

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
export class ModelSession {
  readonly components: OBC.Components;
  readonly world: OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>;
  readonly fragments: OBC.FragmentsManager;
  private readonly assets: ModelAssets;
  private disposed = false;
  private readonly resize: ResizeObserver;

  private constructor(container: HTMLElement, assets: ModelAssets) {
    this.assets = assets;
    this.components = new OBC.Components();
    const worlds = this.components.get(OBC.Worlds);
    this.world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    this.world.scene = new OBC.SimpleScene(this.components);
    this.world.scene.setup();
    this.world.scene.three.background = null;
    this.world.renderer = new OBC.SimpleRenderer(this.components, container);
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
    this.components.dispose();
  }
}
