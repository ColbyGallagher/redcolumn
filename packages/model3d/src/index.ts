/**
 * The 3D model viewer (issue #191): IFC models loaded with That Open Company's components and
 * web-ifc, drawn with three.js, in the world frame drawings share (grid eastings and northings
 * plus AHD height; see `WorldFrame` in @nb/measure and `ifcGridTransform` in the web app).
 *
 * A scaffold for now: nothing imports this package yet, so none of its dependencies reach the
 * app's bundle. Later changes add the viewer here.
 */
export type { WorldFrame } from '@nb/measure';
