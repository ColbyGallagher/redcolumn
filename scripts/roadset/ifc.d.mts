// Types for ifc.mjs, so the app's tests can import the generator.
export const E0: number;
export const N0: number;
export const DATUM: number;
export const EPSG: number;
export const LEVELS: { name: string; rl: number }[];
export const CHANGES: { added: string[]; removed: string[]; changed: string[] };
export function guid(name: string): string;
export function kestrelIfc(rev?: 'A' | 'B'): string;
