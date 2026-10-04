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
      tile last/avg {d.lastTileMs.toFixed(0)}/{d.avgTileMs.toFixed(0)} ms · cached {d.cachedTiles} · queued {d.queuedTiles}
    </div>
  );
}
