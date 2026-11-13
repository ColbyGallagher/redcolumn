import { isTextType, markupLabel } from '@nb/markup';
import type { ToolChestItem } from '../workspace/profiles';

/**
 * The Comment and Label columns of the Tool Chest's detail view, as Revu shows them. A tool keeps
 * them on itself (a Revu tool, or one with Label set on it) or on the markup it was saved from.
 */

const own = (item: ToolChestItem) => item.markups?.find((m) => m.type === item.type) ?? item.markups?.[0];

/** What the tool's markups carry as a comment: a text tool's words, or its Comment. */
export function toolComment(item: ToolChestItem): string {
  if (item.comment) return item.comment;
  const m = own(item);
  return ((m && (isTextType(m.type) ? m.text : m.comment)) ?? '').trim();
}

/** The Label the tool's markups take. */
export function toolMarkupLabel(item: ToolChestItem): string {
  if (item.markupLabel) return item.markupLabel;
  const m = own(item);
  return m ? markupLabel(m) : '';
}
