import { useMemo, useRef, useState } from 'react';
import {
  badgeCountSymbol,
  canBeCountSymbol,
  symbolFromMarkups,
  symbolFromStamp,
  type BadgeFrame,
  type CountSymbol,
  type Markup,
} from '@nb/markup';
import { COUNT_SYMBOL_FILE_ACCEPT, countSymbolFromImage } from '../markup/countSymbolImage';
import {
  addCountSymbol,
  countSymbolLibrary,
  RECENT_TOOLS_ID,
  removeCountSymbol,
  stampLibrary,
  updateCountSymbol,
  useWorkspace,
  type ToolChestItem,
} from '../workspace/profiles';
import { CountSymbolSwatch } from './CountSymbolSwatch';
import { StampPreview } from './StampsDialog';
import { ToolPreview } from './ToolChest';
import './countSymbolsDialog.css';

/** Opens the Count Symbols manager from anywhere (the pickers' "Manage symbols…" entry). */
export const MANAGE_COUNT_SYMBOLS_EVENT = 'nb-manage-count-symbols';
export const openCountSymbols = () => window.dispatchEvent(new CustomEvent(MANAGE_COUNT_SYMBOLS_EVENT));

type Tab = 'library' | 'badge' | 'image' | 'stamp' | 'tools' | 'selection';

const FRAMES: { value: BadgeFrame; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'none', label: 'Text only' },
];

interface Props {
  author: string;
  /** Currently selected markups on the page, for one-click "From Selection". */
  selectedMarkups?: readonly Markup[];
  /** Applies a symbol to the Count tool / selected counts. */
  onUse?: (symbol: CountSymbol) => void;
  onClose: () => void;
}

/** Modal dialog for managing saved custom Count symbols and creating new ones. */
export function CountSymbolsDialog({ author, selectedMarkups = [], onUse, onClose }: Props) {
  const ws = useWorkspace();
  const saved = countSymbolLibrary(ws);
  const stamps = useMemo(() => stampLibrary(ws), [ws]);
  const usableSelection = useMemo(() => selectedMarkups.filter(canBeCountSymbol), [selectedMarkups]);
  const savedTools = useMemo(
    () =>
      ws.toolChests
        .filter((t) => t.id !== RECENT_TOOLS_ID)
        .flatMap((set) => set.items.filter((i) => i.markups?.some(canBeCountSymbol) || (i.type === 'signature' && i.image)).map((item) => ({ set: set.name, item }))),
    [ws.toolChests],
  );

  const [tab, setTab] = useState<Tab>('library');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  // Badge builder state
  const [badgeName, setBadgeName] = useState('Drain');
  const [badgeText, setBadgeText] = useState('D');
  const [badgeFrame, setBadgeFrame] = useState<BadgeFrame>('circle');
  const [badgeStroke, setBadgeStroke] = useState('#111827');
  const [badgeFillOn, setBadgeFillOn] = useState(true);
  const [badgeFill, setBadgeFill] = useState('#ffffff');
  const [badgeTextColor, setBadgeTextColor] = useState('#111827');

  // From-selection state
  const [selName, setSelName] = useState(() => usableSelection[0]?.subject || 'Custom Symbol');
  const fileRef = useRef<HTMLInputElement>(null);

  const badgePreview = useMemo(
    () =>
      badgeCountSymbol({
        id: 'preview',
        name: badgeName,
        text: badgeText,
        frame: badgeFrame,
        stroke: badgeStroke,
        fill: badgeFillOn ? badgeFill : null,
        textColor: badgeTextColor,
      }),
    [badgeName, badgeText, badgeFrame, badgeStroke, badgeFillOn, badgeFill, badgeTextColor],
  );

  const selectionPreview = useMemo(
    () => (usableSelection.length ? symbolFromMarkups(usableSelection, selName, 'preview') : null),
    [usableSelection, selName],
  );

  const saveSymbol = (sym: CountSymbol, useNow = false) => {
    const ok = addCountSymbol(sym);
    if (!ok) {
      setNotice({ text: 'Could not save symbol: browser storage is full. Delete unused symbols or stamps and try again.', error: true });
      return;
    }
    setNotice({ text: `Saved “${sym.name}”.` });
    if (useNow && onUse) {
      onUse(sym);
      onClose();
    } else {
      setTab('library');
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const errors: string[] = [];
    let added = 0;
    for (const f of Array.from(files)) {
      try {
        const sym = await countSymbolFromImage(f);
        if (addCountSymbol(sym)) added++;
        else errors.push(`${f.name}: browser storage is full`);
      } catch (err) {
        errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length) setNotice({ text: errors.join('; '), error: true });
    else if (added) {
      setNotice({ text: `Imported ${added} symbol${added === 1 ? '' : 's'}.` });
      setTab('library');
    }
  };

  const saveFromTool = (item: ToolChestItem) => {
    if (item.markups?.length) {
      const sym = symbolFromMarkups(item.markups, item.label || item.subject || 'Tool Symbol', crypto.randomUUID());
      if (sym) saveSymbol(sym);
      return;
    }
    if (item.image) {
      saveSymbol({ id: crypto.randomUUID(), name: item.label || item.subject || 'Tool Symbol', image: item.image, aspect: 1 });
    }
  };

  const commitRename = (id: string) => {
    const trimmed = renameText.trim();
    if (trimmed) updateCountSymbol(id, { name: trimmed });
    setRenamingId(null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal count-symbols-dialog"
        role="dialog"
        aria-label="Count Symbols"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>Count Symbols</h3>

        <div className="cs-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'library'} className={`btn small${tab === 'library' ? ' active' : ''}`} onClick={() => setTab('library')}>
            Saved ({saved.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'badge'} className={`btn small${tab === 'badge' ? ' active' : ''}`} onClick={() => setTab('badge')}>
            New Badge
          </button>
          <button type="button" role="tab" aria-selected={tab === 'image'} className={`btn small${tab === 'image' ? ' active' : ''}`} onClick={() => setTab('image')}>
            Import Image
          </button>
          <button type="button" role="tab" aria-selected={tab === 'stamp'} className={`btn small${tab === 'stamp' ? ' active' : ''}`} onClick={() => setTab('stamp')}>
            From Stamp
          </button>
          <button type="button" role="tab" aria-selected={tab === 'tools'} className={`btn small${tab === 'tools' ? ' active' : ''}`} onClick={() => setTab('tools')}>
            From Tool Library
          </button>
          {usableSelection.length > 0 && (
            <button type="button" role="tab" aria-selected={tab === 'selection'} className={`btn small${tab === 'selection' ? ' active' : ''}`} onClick={() => setTab('selection')}>
              From Selection
            </button>
          )}
        </div>

        {notice && <div className={`cs-notice${notice.error ? ' error' : ''}`}>{notice.text}</div>}

        <div className="cs-body">
          {tab === 'library' && (
            <>
              {saved.length === 0 ? (
                <p className="muted">
                  No custom count symbols yet. Create a badge, import a picture, convert a stamp or Tool Library item, or right-click any drawn markup on the page and choose <strong>Save as Count Symbol…</strong>.
                </p>
              ) : (
                <div className="cs-grid">
                  {saved.map((sym) => (
                    <div key={sym.id} className="cs-card">
                      <CountSymbolSwatch symbol={sym} size={48} />
                      <div className="cs-card-name" title={sym.name}>
                        {renamingId === sym.id ? (
                          <input
                            type="text"
                            value={renameText}
                            autoFocus
                            onChange={(e) => setRenameText(e.target.value)}
                            onBlur={() => commitRename(sym.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(sym.id);
                              else if (e.key === 'Escape') setRenamingId(null);
                            }}
                          />
                        ) : (
                          sym.name
                        )}
                      </div>
                      <div className="cs-card-actions">
                        {onUse && (
                          <button
                            type="button"
                            className="btn small primary"
                            onClick={() => {
                              onUse(sym);
                              onClose();
                            }}
                          >
                            Use
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn small"
                          title="Rename"
                          onClick={() => {
                            setRenamingId(sym.id);
                            setRenameText(sym.name);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          title="Delete"
                          onClick={() => {
                            removeCountSymbol(sym.id);
                            setNotice(null);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'badge' && (
            <div className="cs-badge-editor">
              <div className="cs-badge-preview">
                <CountSymbolSwatch symbol={badgePreview} size={72} />
                <span className="muted" style={{ fontSize: 11 }}>
                  Vector preview
                </span>
              </div>
              <div className="cs-form">
                <label className="cs-row">
                  <span>Name</span>
                  <input type="text" value={badgeName} onChange={(e) => setBadgeName(e.target.value)} placeholder="e.g. Floor Drain" />
                </label>
                <label className="cs-row">
                  <span>Frame</span>
                  <select value={badgeFrame} onChange={(e) => setBadgeFrame(e.target.value as BadgeFrame)}>
                    {FRAMES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cs-row">
                  <span>Text</span>
                  <input type="text" maxLength={6} value={badgeText} onChange={(e) => setBadgeText(e.target.value)} placeholder="e.g. D1, SD, C" />
                </label>
                {badgeFrame !== 'none' && (
                  <>
                    <div className="cs-row">
                      <span>Outline</span>
                      <div className="cs-color-row">
                        <input type="color" value={badgeStroke} onChange={(e) => setBadgeStroke(e.target.value)} />
                        <span>{badgeStroke}</span>
                      </div>
                    </div>
                    <div className="cs-row">
                      <span>Fill</span>
                      <div className="cs-color-row">
                        <input type="checkbox" checked={badgeFillOn} onChange={(e) => setBadgeFillOn(e.target.checked)} aria-label="Enable fill" />
                        <input type="color" value={badgeFill} disabled={!badgeFillOn} onChange={(e) => setBadgeFill(e.target.value)} />
                        <span>{badgeFillOn ? badgeFill : 'None'}</span>
                      </div>
                    </div>
                  </>
                )}
                <div className="cs-row">
                  <span>Text color</span>
                  <div className="cs-color-row">
                    <input type="color" value={badgeTextColor} onChange={(e) => setBadgeTextColor(e.target.value)} />
                    <span>{badgeTextColor}</span>
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!badgeText.trim() && badgeFrame === 'none'}
                    onClick={() => saveSymbol({ ...badgePreview, id: crypto.randomUUID() }, false)}
                  >
                    Save Symbol
                  </button>
                  {onUse && (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!badgeText.trim() && badgeFrame === 'none'}
                      onClick={() => saveSymbol({ ...badgePreview, id: crypto.randomUUID() }, true)}
                    >
                      Save &amp; Use
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'image' && (
            <div className="cs-form">
              <p className="muted">
                Import a PNG, JPEG, GIF, BMP, or WebP image as a reusable count marker. Transparent PNGs stay transparent and are scaled cleanly for crisp markers.
              </p>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={COUNT_SYMBOL_FILE_ACCEPT}
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void handleFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
                  Choose Image File…
                </button>
              </div>
            </div>
          )}

          {tab === 'stamp' && (
            <div className="cs-pick-list">
              {stamps.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="cs-pick-card"
                  onClick={() => saveSymbol(symbolFromStamp(s, author, crypto.randomUUID()))}
                >
                  <StampPreview stamp={s} author={author} width={110} />
                  <span className="cs-card-name">{s.name}</span>
                </button>
              ))}
            </div>
          )}

          {tab === 'tools' && (
            <>
              {savedTools.length === 0 ? (
                <p className="muted">No saved markup tools in your Tool Library yet. Right-click a markup on the page → Add to Tool Library first.</p>
              ) : (
                <div className="cs-pick-list">
                  {savedTools.map(({ set, item }) => (
                    <button key={item.id} type="button" className="cs-pick-card" onClick={() => saveFromTool(item)} title={`${set}: ${item.label}`}>
                      <ToolPreview item={item} size={40} />
                      <span className="cs-card-name">{item.label}</span>
                      <span className="muted" style={{ fontSize: 10 }}>
                        {set}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'selection' && selectionPreview && (
            <div className="cs-badge-editor">
              <div className="cs-badge-preview">
                <CountSymbolSwatch symbol={selectionPreview} size={72} />
                <span className="muted" style={{ fontSize: 11 }}>
                  {usableSelection.length} markup{usableSelection.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="cs-form">
                <label className="cs-row">
                  <span>Name</span>
                  <input type="text" value={selName} onChange={(e) => setSelName(e.target.value)} placeholder="Symbol name" />
                </label>
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const sym = symbolFromMarkups(usableSelection, selName, crypto.randomUUID());
                      if (sym) saveSymbol(sym, false);
                    }}
                  >
                    Save Symbol
                  </button>
                  {onUse && (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => {
                        const sym = symbolFromMarkups(usableSelection, selName, crypto.randomUUID());
                        if (sym) saveSymbol(sym, true);
                      }}
                    >
                      Save &amp; Use
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
