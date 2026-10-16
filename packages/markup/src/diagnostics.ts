/**
 * Something a reader could not keep from a Revu settings file (.btx, .blx, .bhx, .bpx). Readers
 * take an optional list and push one entry per thing they skip, so nothing is lost without a
 * record. `item` names the top-level element it belongs to (a tool, line style, hatch or column),
 * so a count of distinct items is the count of items that did not come through whole.
 */
export interface Dropped {
  item: string;
  reason: string;
}
