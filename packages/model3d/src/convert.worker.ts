/**
 * Converts an IFC file to That Open fragments off the main thread: web-ifc reads the file and the
 * importer writes the compact binary fragments the viewer loads. Large models take a while, and
 * here they never freeze the window.
 */
import { IfcImporter } from '@thatopen/fragments';

export interface ConvertRequest {
  ifc: Uint8Array;
  /** URL of web-ifc.wasm; web-ifc looks the file up by name in its folder. */
  wasm: string;
}

export type ConvertReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; fragments: Uint8Array }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ConvertRequest>) => void) | null;
  postMessage: (m: ConvertReply, transfer?: Transferable[]) => void;
};

scope.onmessage = async (e) => {
  const { ifc, wasm } = e.data;
  try {
    const importer = new IfcImporter();
    importer.wasm = { path: new URL('.', wasm).href, absolute: true };
    const fragments = await importer.process({
      bytes: ifc,
      progressCallback: (fraction) => scope.postMessage({ type: 'progress', fraction }),
    });
    scope.postMessage({ type: 'done', fragments }, [fragments.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
