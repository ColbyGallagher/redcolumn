import { splitPartName, type SplitSpec } from '../documents/pageTools';

export const DEFAULT_SPLIT: SplitSpec = { by: 'count', count: 1, maxMb: 10, naming: { mode: 'suffix', pattern: 'Part-#' } };

interface Props {
  value: SplitSpec;
  onChange: (spec: SplitSpec) => void;
  /** The document's page count, when splitting one document (not a batch). */
  pageCount?: number;
  /** How many top-level bookmarks the document has, when known; under 2 disables splitting at them. */
  bookmarkCount?: number;
  /** A file name for the naming example. */
  exampleBase?: string;
}

/** Split Document's options, shared by the Document menu and Batch: how to split, and how to name the parts. */
export function SplitOptions({ value, onChange, pageCount, bookmarkCount, exampleBase = 'Drawings' }: Props) {
  const by = (b: SplitSpec['by']) =>
    onChange({ ...value, by: b, naming: b === 'bookmarks' ? { ...value.naming, mode: 'bookmarks' } : value.naming.mode === 'bookmarks' ? { ...value.naming, mode: 'suffix' } : value.naming });
  const naming = (n: Partial<SplitSpec['naming']>) => onChange({ ...value, naming: { ...value.naming, ...n } });
  const total = pageCount && value.by === 'count' ? Math.ceil(pageCount / Math.max(1, value.count)) : 3;
  const example = `${splitPartName(exampleBase, 0, total, value.naming, 'Bookmark title')}.pdf`;
  return (
    <>
      <fieldset>
        <legend>Split into</legend>
        <label className="row">
          <input type="radio" checked={value.by === 'count'} onChange={() => by('count')} />
          Files of
          <input
            type="number"
            min={1}
            max={pageCount}
            value={value.count}
            style={{ width: 64 }}
            aria-label="Pages per file"
            onFocus={() => value.by !== 'count' && by('count')}
            onChange={(e) => onChange({ ...value, by: 'count', count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
          page{value.count === 1 ? '' : 's'}
          {pageCount ? ` (${Math.ceil(pageCount / Math.max(1, value.count))} files)` : ''}
        </label>
        <label className="row">
          <input type="radio" checked={value.by === 'size'} onChange={() => by('size')} />
          Files of up to
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={value.maxMb}
            style={{ width: 72 }}
            aria-label="Largest file size in MB"
            onFocus={() => value.by !== 'size' && by('size')}
            onChange={(e) => onChange({ ...value, by: 'size', maxMb: Math.max(0.1, Number(e.target.value) || 0.1) })}
          />
          MB
        </label>
        <label className="row">
          <input type="radio" checked={value.by === 'bookmarks'} disabled={bookmarkCount !== undefined && bookmarkCount < 2} onChange={() => by('bookmarks')} />
          One file per top-level bookmark{bookmarkCount !== undefined ? ` (${bookmarkCount})` : ''}
        </label>
        {value.by === 'size' && <p className="print-hint">Pages are never cut, so a page bigger than the limit gets a file of its own.</p>}
      </fieldset>
      <fieldset>
        <legend>File names</legend>
        <label className="row">
          Number
          <input type="text" value={value.naming.pattern} aria-label="Part number pattern" placeholder="Part-#" style={{ width: 120 }} onChange={(e) => naming({ pattern: e.target.value })} />
        </label>
        <label className="row">
          <input type="radio" checked={value.naming.mode === 'suffix'} onChange={() => naming({ mode: 'suffix' })} />
          After the file name
        </label>
        <label className="row">
          <input type="radio" checked={value.naming.mode === 'prefix'} onChange={() => naming({ mode: 'prefix' })} />
          Before the file name
        </label>
        <label className="row">
          <input type="radio" checked={value.naming.mode === 'bookmarks'} disabled={value.by !== 'bookmarks'} onChange={() => naming({ mode: 'bookmarks' })} />
          Bookmark titles
        </label>
        <p className="print-hint">
          # is the part number. For example: <b>{example}</b>
        </p>
      </fieldset>
    </>
  );
}
