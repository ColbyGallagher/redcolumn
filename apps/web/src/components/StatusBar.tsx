import { useEffect, useState } from 'react';
import { formatLength, type Scale } from '@nb/measure';
import type { PagePoint, TileViewer } from '../viewer/TileViewer';
import { settings, useSettings } from '../settings/settings';
import { useOnline } from '../offline/network';

interface Props {
  viewer: TileViewer | null;
  /** View rotation in clockwise quarter turns (from the viewer's stats). */
  rotation: number;
  /** Scale of a page, for showing the cursor position in real-world units. */
  scaleFor: (pageIndex: number) => Scale | null;
  /** Snap to drawing content (the tools' own toggle). */
  snapContent: boolean;
  onSnapContent: (on: boolean) => void;
  disabled: boolean;
  /** Synchronised split panes (null: off; undefined: no split). */
  sync?: 'document' | 'page' | null;
  onSync?: (mode: 'document' | 'page' | null) => void;
}

function Toggle({ label, title, on, onChange, disabled }: { label: string; title: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button className={`status-toggle${on ? ' on' : ''}`} title={title} aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)}>
      {label}
    </button>
  );
}

/**
 * The status bar: snap and grid toggles on the left, the pointer's position on the page (in
 * the page's scale) on the right. It follows the pointer itself so moving the mouse does not
 * re-render the rest of the app.
 */
export function StatusBar({ viewer, rotation: turns, scaleFor, snapContent, onSnapContent, disabled, sync, onSync }: Props) {
  const prefs = useSettings();
  const online = useOnline();
  const [cursor, setCursor] = useState<{ pageIndex: number; point: PagePoint } | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const off = viewer.onCursor(setCursor);
    return () => {
      off();
      setCursor(null);
    };
  }, [viewer]);

  const scale = cursor ? scaleFor(cursor.pageIndex) : null;
  const size = cursor && viewer ? viewer.pageSize(cursor.pageIndex) : null;
  const onPage = cursor && size && cursor.point[0] >= 0 && cursor.point[1] >= 0 && cursor.point[0] <= size.width && cursor.point[1] <= size.height;
  const coord = (pt: number) => (scale ? formatLength(pt * scale.metersPerPoint, scale) : `${pt.toFixed(1)} pt`);

  return (
    <div className="statusbar">
      <div className="status-group">
        <Toggle label="Grid" title="Show Grid (Shift+F9)" on={prefs.showGrid} onChange={(v) => settings.set({ showGrid: v })} disabled={disabled} />
        <Toggle label="Snap Grid" title="Snap to Grid (Ctrl+Shift+F9)" on={prefs.snapToGrid} onChange={(v) => settings.set({ snapToGrid: v })} disabled={disabled} />
        <Toggle label="Snap Content" title="Snap to Content (Ctrl+Shift+F8): drawing lines, ends and intersections" on={snapContent} onChange={onSnapContent} disabled={disabled} />
        <Toggle label="Snap Markup" title="Snap to Markup (Ctrl+Shift+F7): corners and vertices of other markups" on={prefs.snapToMarkup} onChange={(v) => settings.set({ snapToMarkup: v })} disabled={disabled} />
        <span className="status-sep" />
        <Toggle label="Rulers" title="Rulers (Ctrl+R)" on={prefs.showRulers} onChange={(v) => settings.set({ showRulers: v })} disabled={disabled} />
        <Toggle label="Crosshair" title="Full-Screen Crosshair" on={prefs.crosshair} onChange={(v) => settings.set({ crosshair: v })} disabled={disabled} />
        <span className="status-sep" />
        <Toggle label="Reuse" title="Reuse: keep the markup tool active after placing a markup (off: back to Select)" on={prefs.reuseTool} onChange={(v) => settings.set({ reuseTool: v })} />
        <Toggle label="Draw to Scale" title="Draw to Scale: type exact lengths, angles and sizes while drawing, and edit a selected line's, rectangle's or polyline's sizes in the toolbar" on={prefs.sketchToScale} onChange={(v) => settings.set({ sketchToScale: v })} />
        {sync !== undefined && onSync && (
          <Toggle label="Sync" title="Synchronise the split panes: they pan, zoom and turn pages together (View → Synchronise)" on={!!sync} onChange={(v) => onSync(v ? 'document' : null)} />
        )}
      </div>
      <div className="status-group right">
        {!online && (
          <span className="status-offline" role="status" title="No network. Documents, markups and measurements on this device keep working and are saved here; Live Sessions, time stamps and cloud storage wait for the network.">
            Offline
          </span>
        )}
        {turns !== 0 && (
          <button className="status-toggle on" title="The view is rotated (View → Rotate View). Click to reset." onClick={() => viewer?.rotateView(-turns)}>
            View {turns * 90}°
          </button>
        )}
        <span className="status-coords" title="Pointer position from the page's top-left corner, at the page scale">
          {onPage ? `X ${coord(cursor.point[0])}   Y ${coord(cursor.point[1])}` : ''}
        </span>
      </div>
    </div>
  );
}
