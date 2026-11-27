/**
 * Converts an IFC file to That Open fragments off the main thread: web-ifc reads the file and the
 * importer writes the compact binary fragments the viewer loads. Large models take a while, and
 * here they never freeze the window.
 */
import { IfcImporter } from '@thatopen/fragments';
import * as WEBIFC from 'web-ifc';

/**
 * IFC 4.3 physical elements the importer's list leaves out, added so they are drawn and listed:
 * kerbs and other road, rail, marine and geotechnical elements.
 */
const MORE_ELEMENTS = [
  WEBIFC.IFCKERB,
  WEBIFC.IFCREINFORCEDSOIL,
  WEBIFC.IFCSIGNAL,
  WEBIFC.IFCMOORINGDEVICE,
  WEBIFC.IFCNAVIGATIONELEMENT,
  WEBIFC.IFCCAISSONFOUNDATION,
  WEBIFC.IFCIMPACTPROTECTIONDEVICE,
  WEBIFC.IFCVIBRATIONDAMPER,
  WEBIFC.IFCMOBILETELECOMMUNICATIONSAPPLIANCE,
  WEBIFC.IFCCONVEYORSEGMENT,
  WEBIFC.IFCLIQUIDTERMINAL,
  WEBIFC.IFCELECTRICFLOWTREATMENTDEVICE,
  WEBIFC.IFCDISTRIBUTIONBOARD,
  WEBIFC.IFCBOREHOLE,
  WEBIFC.IFCGEOSLICE,
  WEBIFC.IFCGEOMODEL,
];

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
  location: Location;
};

scope.onmessage = async (e) => {
  // Only the page that started this worker can post to it, and its messages carry no origin: one
  // from any other origin is ignored, as is anything that is not a conversion request.
  if (e.origin && e.origin !== scope.location.origin) return;
  if (!(e.data?.ifc instanceof Uint8Array) || typeof e.data.wasm !== 'string') return;
  // web-ifc's wasm only ever comes from this app's own files.
  if (new URL(e.data.wasm, scope.location.href).origin !== scope.location.origin) return;
  const { ifc, wasm } = e.data;
  try {
    const importer = new IfcImporter();
    importer.wasm = { path: new URL('.', wasm).href, absolute: true };
    for (const c of MORE_ELEMENTS) importer.classes.elements.add(c);
    const fragments = await importer.process({
      bytes: ifc,
      progressCallback: (fraction) => scope.postMessage({ type: 'progress', fraction }),
    });
    scope.postMessage({ type: 'done', fragments }, [fragments.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
