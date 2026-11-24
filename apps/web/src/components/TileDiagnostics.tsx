import { msg } from '@nb/i18n';
import { useEffect, useState } from 'react';
import type { TileViewer, ViewerDiagnostics } from '../viewer/TileViewer';

/** Development overlay: tile render times and cache use, polled so the app is not re-rendered per frame. */
export function TileDiagnostics({ viewer }: { viewer: TileViewer }) {
  const [d, setD] = useState<ViewerDiagnostics>(() => viewer.diagnostics());
  useEffect(() => {
    const t = setInterval(() => setD(viewer.diagnostics()), 500);
    return () => clearInterval(t);
  }, [viewer]);
  return (
    <div className="stats">
      {msg('tile last/avg {lastTileMs}/{avgTileMs} ms · cached {cachedTiles} · queued {queuedTiles} · cancelled {cancelled}', { lastTileMs: d.lastTileMs.toFixed(0), avgTileMs: d.avgTileMs.toFixed(0), cachedTiles: d.cachedTiles, queuedTiles: d.queuedTiles, cancelled: d.cancelled })}
    </div>
  );
}
