/**
 * The 3D model viewer (issue #191): IFC models loaded with That Open Company's components and
 * web-ifc, drawn with three.js, in the world frame drawings share (grid eastings and northings
 * plus AHD height; see `WorldFrame` in @nb/measure and `ifcGridTransform` in the web app).
 *
 * The web app imports this package only with a dynamic import() when a model opens
 * (apps/web/src/model3d/host.ts), so none of it reaches the PDF viewer's bundle.
 */
export type { WorldFrame } from '@nb/measure';
export { ModelSession, type LoadOptions, type LoadProgress, type ModelAssets } from './session.ts';
