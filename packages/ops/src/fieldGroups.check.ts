// Compile-time checks only: `tsc` runs them; the tests never load this file.
import type { Markup, MarkupType } from '@nb/markup';
import { MARKUP_FIELD_GROUPS, MARKUP_TYPE_IDS, type FieldGroup } from './fieldGroups.ts';

// Every Markup field has a group (the check `MARKUP_FIELD_GROUPS` itself is written with).
MARKUP_FIELD_GROUPS satisfies Record<keyof Markup, FieldGroup>;

// A field added to Markup without a group does not compile.
type MarkupWithNewField = Markup & { newField?: string };
// @ts-expect-error `newField` has no group
MARKUP_FIELD_GROUPS satisfies Record<keyof MarkupWithNewField, FieldGroup>;

// Nor does a group for a field Markup does not have.
// @ts-expect-error `notAField` is not a Markup field
({ ...MARKUP_FIELD_GROUPS, notAField: 'prop' }) satisfies Record<keyof Markup, FieldGroup>;

// Nor a group that is not one of the groups.
// @ts-expect-error `shape` is not a FieldGroup
({ ...MARKUP_FIELD_GROUPS, points: 'shape' }) satisfies Record<keyof Markup, FieldGroup>;

// The copied list of markup types is the whole of MarkupType.
type MissingType = Exclude<MarkupType, (typeof MARKUP_TYPE_IDS)[number]>;
export const markupTypesComplete: [MissingType] extends [never] ? true : MissingType = true;
