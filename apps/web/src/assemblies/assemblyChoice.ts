import { isMeasureKind, type Assembly, type Markup } from '@nb/markup';

/**
 * Which assembly a takeoff uses and the values of its variables, as the Takeoff ribbon and the
 * Measurements panel edit them: the selected measurements' (each keeps its own `assemblyInputs`,
 * falling back to the variables' defaults), or with none selected the next ones drawn.
 */

/** The assembly the next measurements are taken off as, and their inputs where they differ from the defaults. */
export interface AssemblyDefaults {
  assemblyId?: string;
  assemblyInputs?: Record<string, number>;
}

/** A measurement's value for each of `assembly`'s variables: its own input, else the default. */
export function inputValues(assembly: Assembly, inputs: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const own = new Map(Object.entries(inputs ?? {}).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return Object.fromEntries(assembly.variables.map((v) => [v.name, own.get(v.name.trim().toLowerCase()) ?? v.value]));
}

/** `values` without the ones that are the variables' defaults (undefined when none is left), as a measurement keeps them. */
export function changedInputs(assembly: Assembly, values: Readonly<Record<string, number>>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const v of assembly.variables) {
    const x = values[v.name];
    if (x === undefined || !Number.isFinite(x)) continue;
    const norm = v.type === 'boolean' ? (x ? 1 : 0) : x;
    if (norm !== (v.type === 'boolean' ? (v.value ? 1 : 0) : v.value)) out[v.name] = norm;
  }
  return Object.keys(out).length ? out : undefined;
}

/** `inputs` with one variable set to `value`, the others kept: what a measurement keeps after one field is edited. */
export function withInput(assembly: Assembly, inputs: Readonly<Record<string, number>> | undefined, name: string, value: number): Record<string, number> | undefined {
  return changedInputs(assembly, { ...inputValues(assembly, inputs), [name]: value });
}

/** Whether a markup can be taken off as an assembly: a measurement other than an angle. */
export function takesAssembly(m: Pick<Markup, 'type'>): boolean {
  return isMeasureKind(m.type) && m.type !== 'angle';
}

export interface AssemblyChoice {
  /**
   * What is being edited: the selected measurements, the next ones drawn, or nothing (markups are
   * selected but none is a measurement).
   */
  target: 'selected' | 'next' | 'none';
  /** How many measurements are selected (0 for the next ones). */
  count: number;
  /** How many markups are selected, measurements or not. */
  selected: number;
  /** The assembly's id; '' for none, '*' when the selected measurements use several. */
  value: string;
  /** The one assembly in use, when it is one of the document's: its variables can be edited. */
  assembly?: Assembly;
  /** Its variables' values (the first selected measurement's, when they differ). */
  values: Record<string, number>;
  /** Variables whose value differs between the selected measurements. */
  varies: Set<string>;
}

/**
 * What the assembly controls show and edit, for `chosen` (the selected measurements) or, with none
 * and nothing else selected (`selected` counts every selected markup), `defaults`.
 */
export function assemblyChoice(chosen: readonly Pick<Markup, 'assemblyId' | 'assemblyInputs'>[], defaults: AssemblyDefaults, assemblies: readonly Assembly[], selected = chosen.length): AssemblyChoice {
  if (!chosen.length && selected > 0) return { target: 'none', count: 0, selected, value: '', values: {}, varies: new Set() };
  const ids = new Set(chosen.map((m) => m.assemblyId ?? ''));
  const value = chosen.length ? (ids.size === 1 ? [...ids][0]! : '*') : (defaults.assemblyId ?? '');
  const assembly = value && value !== '*' ? assemblies.find((a) => a.id === value) : undefined;
  const all = assembly ? (chosen.length ? chosen.map((m) => inputValues(assembly, m.assemblyInputs)) : [inputValues(assembly, defaults.assemblyInputs)]) : [];
  const values = all[0] ?? {};
  const varies = new Set(assembly ? assembly.variables.map((v) => v.name).filter((n) => all.some((x) => x[n] !== values[n])) : []);
  return { target: chosen.length ? 'selected' : 'next', count: chosen.length, selected: Math.max(selected, chosen.length), value, ...(assembly ? { assembly } : {}), values, varies };
}

/** Says which measurements a change goes to: "Next markups", "2 measurements selected", "2 measurements (of 3 selected)". */
export function appliesTo(choice: Pick<AssemblyChoice, 'target' | 'count' | 'selected'>): string {
  if (choice.target === 'next') return 'Next markups';
  if (choice.target === 'none') return 'No measurements selected';
  const n = `${choice.count} measurement${choice.count === 1 ? '' : 's'}`;
  return choice.selected > choice.count ? `${n} (of ${choice.selected} selected)` : `${n} selected`;
}
