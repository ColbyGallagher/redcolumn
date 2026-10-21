import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { MarkupStore, Point, StoredStitchGroup } from '@nb/markup';
import { crsById, PROJECTED_CRS, type GeoRegion } from '@nb/measure';
import { apply } from '@nb/stitch';
import type { MarkupTools } from '../markup/MarkupTools';
import { useGeoRegions } from '../markup/hooks';
import { aboutPoint, geoRegionFor, gridToPage, initialPlacement, movePlacement, pageToGrid, placementFromPairs, ratioOfScale, type ModelPlacement } from '../geospatial/align';
import { MODEL_EXTENSIONS, readModel, type GeoModel, type GridPoint } from '../geospatial/model';
import { scaleProblems, singleSheet, stitchedSheets, worldBox, worldPerPoint, worldScale, type GeoSheet } from '../geospatial/sheets';

/** What the sheets report back to the panel (wired through MarkupTools' options); points are in the model's world. */
export interface GeoHandlers {
  moved: (dx: number, dy: number) => void;
  pick: (target: 'model' | 'page', p: Point) => void;
}

type Mode = 'none' | 'move' | 'pickModel' | 'pickPage';
/** Where the model is aligned: over one sheet, or over the stitched view of a stitch's sheets. */
type Frame = 'sheet' | 'stitch';

interface Session {
  model: GeoModel | null;
  crsId: string;
  /** Grid → world (the sheet's page space, or the stitched view's). */
  placement: ModelPlacement | null;
  frame: Frame;
  /** The sheet the model was opened on (in a stitch, the one whose scale it takes). */
  pageIndex: number;
}

/** Each document's panel state, kept while the app is open so switching panels does not lose it. */
const sessions = new Map<string, Session>();

const DEG = 180 / Math.PI;
const DEFAULT_CRS = 'EPSG:7856';

interface Props {
  /** Identifies the document (for keeping the panel's state). */
  docKey: string | null;
  store: MarkupStore | null;
  tools: MarkupTools | null;
  handlers: MutableRefObject<GeoHandlers | null>;
  pageIndex: number;
  pageLabel: (pageIndex: number) => string;
  pageSize: (pageIndex: number) => { width: number; height: number } | null;
  /** The page's own drawing scale, when one is set. */
  metersPerPoint: (pageIndex: number) => number | null;
  /** The document's stitches (detected and hand-made). */
  stitchGroups: readonly StoredStitchGroup[];
  /** The viewer shows the stitched view. */
  stitched: boolean;
  /** Opens the stitched view of the stitch holding a page. */
  onOpenStitched: (pageIndex: number) => void;
  /** Opens the Stitching panel (to join sheets by hand). */
  onShowStitching: () => void;
  /** The match lines placed by hand (to say why a sheet is in no stitch). */
  matchLines: readonly { pageIndex: number; matchTo: string | null }[];
  onSetScale: () => void;
  onCalibrate: (() => void) | null;
  editable: boolean;
  onGoTo: (pageIndex: number) => void;
  onNotice: (text: string) => void;
}

/**
 * Geospatial: makes sheets geospatial PDFs. A model or CAD file in a known coordinate system
 * (IFC 4.3, LandXML, DXF, GeoJSON) is laid over a sheet at its calibrated scale and lined up
 * with the drawing, by dragging or by picking two points on each. For a set of plans, the model
 * is lined up once over their stitched view and every sheet of the stitch is registered through
 * where it sits in the stitch. Registrations are written into the PDF when it is saved.
 */
export function GeospatialPanel(props: Props) {
  const { docKey, store, tools, handlers, pageIndex, pageLabel, pageSize, metersPerPoint, stitchGroups, stitched, editable, onGoTo, onNotice } = props;
  const saved = docKey ? sessions.get(docKey) : undefined;
  const [model, setModel] = useState<GeoModel | null>(saved?.model ?? null);
  const [crsId, setCrsId] = useState(saved?.crsId ?? DEFAULT_CRS);
  const [placement, setPlacement] = useState<ModelPlacement | null>(saved?.placement ?? null);
  const [frame, setFrame] = useState<Frame>(saved?.frame ?? 'sheet');
  const [anchor, setAnchor] = useState(saved?.pageIndex ?? pageIndex);
  const [mode, setMode] = useState<Mode>('none');
  const [pairs, setPairs] = useState<{ model?: GridPoint; page?: Point }[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const regions = useGeoRegions(store);
  const crs = crsById(crsId);

  // Kept per document for when the panel opens again.
  useEffect(() => {
    if (docKey) sessions.set(docKey, { model, crsId, placement, frame, pageIndex: anchor });
  }, [docKey, model, crsId, placement, frame, anchor]);

  // Another document: its own state.
  const lastDoc = useRef(docKey);
  useEffect(() => {
    if (lastDoc.current === docKey) return;
    lastDoc.current = docKey;
    const s = docKey ? sessions.get(docKey) : undefined;
    setModel(s?.model ?? null);
    setCrsId(s?.crsId ?? DEFAULT_CRS);
    setPlacement(s?.placement ?? null);
    setFrame(s?.frame ?? 'sheet');
    setAnchor(s?.pageIndex ?? pageIndex);
    setMode('none');
    setPairs([]);
  }, [docKey, pageIndex]);

  const groupOf = (p: number) => stitchGroups.find((g) => g.placements.length > 1 && g.placements.some((x) => x.pageIndex === p)) ?? null;
  const group = groupOf(anchor);
  const hereGroup = groupOf(pageIndex);
  const inStitch = frame === 'stitch' && !!group;

  // The sheets the model is over, and the world it is placed in. (`pageSize` is a new function
  // each render: the sheets follow the sizes it gives, so the model is not re-projected needlessly.)
  const sizes = (frame === 'stitch' && group ? group.placements.map((p) => p.pageIndex) : [anchor]).map((p) => {
    const s = pageSize(p);
    return s ? `${s.width}x${s.height}` : '';
  });
  const sizeKey = sizes.join(' ');
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;
  const sheets = useMemo((): GeoSheet[] => {
    const size = (p: number) => pageSizeRef.current(p);
    if (frame === 'stitch' && group) return stitchedSheets(group, size);
    const own = size(anchor);
    return own ? [singleSheet(anchor, own)] : [];
  }, [frame, group, anchor, sizeKey]);
  const anchorSheet = sheets.find((s) => s.pageIndex === anchor) ?? null;
  /** World points per grid metre, from the anchor sheet's calibrated scale. */
  const scale = anchorSheet ? worldScale(anchorSheet, metersPerPoint(anchor)) : null;
  const hereScaled = metersPerPoint(pageIndex) !== null;

  // The model stays at the sheet's scale when that changes.
  useEffect(() => {
    if (!scale || !placement || Math.abs(placement.scale / scale - 1) < 1e-9) return;
    const c = sheets.length ? centreOf(worldBox(sheets)) : ([placement.x, placement.y] as Point);
    setPlacement(aboutPoint(placement, c, { scale }));
  }, [scale, placement, sheets]);

  // The model drawn over each sheet while the panel is open.
  const layers = useMemo(() => {
    if (!model || !placement) return null;
    const world = {
      paths: model.paths.map((path) => path.map((p) => gridToPage(placement, p))),
      points: model.points.map((p) => gridToPage(placement, p.at)),
    };
    return sheets.map((s) => {
      const onPage = (w: Point): Point => apply(s.fromWorld, w);
      return { pageIndex: s.pageIndex, toWorld: s.toWorld, fromWorld: s.fromWorld, bounds: s.bounds, paths: world.paths.map((path) => path.map(onPage)), points: world.points.map(onPage) };
    });
  }, [model, placement, sheets]);
  useEffect(() => {
    if (!tools) return;
    if (!layers?.length) {
      tools.setGeoOverlay(null);
      return;
    }
    tools.setGeoOverlay({
      layers,
      pairs: pairs.map((p) => ({ ...(p.model && placement ? { model: gridToPage(placement, p.model) } : {}), ...(p.page ? { page: p.page } : {}) })),
      mode: editable ? mode : 'none',
      clip: inStitch,
    });
  }, [tools, layers, pairs, mode, editable, placement, inStitch]);
  useEffect(() => () => tools?.setGeoOverlay(null), [tools]);

  // Presses on the sheets.
  handlers.current = {
    moved: (dx, dy) => setPlacement((p) => (p ? movePlacement(p, dx, dy) : p)),
    pick: (target, p) => {
      if (!placement) return;
      if (target === 'model') {
        const at = pageToGrid(placement, p);
        setPairs((list) => [...list.filter((x) => x.page), { model: at }]);
        setMode('pickPage');
        return;
      }
      const next = pairs.map((x) => ({ ...x }));
      const open = next.find((x) => x.model && !x.page);
      if (!open) return;
      open.page = p;
      if (next.length >= 2 && next.every((x) => x.model && x.page)) {
        const [a, b] = next.slice(-2) as [{ model: GridPoint; page: Point }, { model: GridPoint; page: Point }];
        // The sheet's scale holds; the points only move and turn the model.
        const fitted = placementFromPairs(a.model, a.page, b.model, b.page, scale ?? undefined);
        const free = placementFromPairs(a.model, a.page, b.model, b.page);
        if (!fitted || !free) {
          onNotice('The two points are too close together: pick points further apart.');
          setPairs([]);
          setMode('pickModel');
          return;
        }
        setPlacement(fitted);
        setPairs([]);
        setMode('none');
        const off = scale ? free.scale / scale - 1 : 0;
        onNotice(
          `Model aligned: rotated ${(fitted.rotation * DEG).toFixed(3)}°.` +
            (Math.abs(off) > 0.005 ? ` The points are ${Math.abs(off * 100).toFixed(1)}% ${off > 0 ? 'further apart' : 'closer together'} on the sheet than on the model at the sheet's scale: check the scale, or the points picked.` : ''),
        );
        return;
      }
      setPairs(next);
      setMode('pickModel');
    },
  };
  useEffect(() => () => void (handlers.current = null), [handlers]);

  /** A first placement over the sheets the model is aligned on. */
  const place = (m: GeoModel, f: Frame, at: number): ModelPlacement | null => {
    const g = f === 'stitch' ? groupOf(at) : null;
    const size = pageSize(at);
    const list = g ? stitchedSheets(g, pageSize) : size ? [singleSheet(at, size)] : [];
    const own = list.find((s) => s.pageIndex === at);
    const s = own ? worldScale(own, metersPerPoint(at)) : null;
    return list.length && s ? initialPlacement(m, worldBox(list), s) : null;
  };

  const open = async (file: File) => {
    if (!hereScaled) return;
    setLoading(true);
    try {
      const m = readModel(file.name, await file.text());
      const f: Frame = hereGroup && (frame === 'stitch' || stitched) ? 'stitch' : 'sheet';
      setModel(m);
      if (m.crs) setCrsId(m.crs.id);
      setAnchor(pageIndex);
      setFrame(f);
      setPlacement(place(m, f, pageIndex));
      setPairs([]);
      setMode('move');
      if (f === 'stitch' && !stitched) props.onOpenStitched(pageIndex);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setModel(null);
    setPlacement(null);
    setPairs([]);
    setMode('none');
  };

  /** Starts again over this sheet (or its stitch). */
  const reset = (f: Frame = frame) => {
    if (!model || !hereScaled) return;
    const useFrame = f === 'stitch' && hereGroup ? 'stitch' : 'sheet';
    setAnchor(pageIndex);
    setFrame(useFrame);
    setPlacement(place(model, useFrame, pageIndex));
    setPairs([]);
    if (useFrame === 'stitch' && !stitched) props.onOpenStitched(pageIndex);
  };

  /** Keeps the model where it is on the sheets while switching between one sheet and the stitch. */
  const switchFrame = (f: Frame) => {
    if (f === frame) return;
    if (!model || !placement) {
      setFrame(f);
      return;
    }
    const g = groupOf(anchor);
    const sheet = g?.placements.find((p) => p.pageIndex === anchor);
    if (f === 'stitch' && !sheet) return reset('stitch');
    if (sheet) {
      // Two grid points, through the old world to the new one, fix the new placement.
      const m = f === 'stitch' ? sheet.toWorld : stitchedSheets(g!, pageSize).find((s) => s.pageIndex === anchor)!.fromWorld;
      const g1: GridPoint = [placement.e0, placement.n0];
      const g2: GridPoint = [placement.e0 + 100, placement.n0];
      const next = placementFromPairs(g1, apply(m, gridToPage(placement, g1)), g2, apply(m, gridToPage(placement, g2)));
      if (next) setPlacement(next);
    }
    setFrame(f);
    setPairs([]);
    if (f === 'stitch' && !stitched) props.onOpenStitched(anchor);
  };

  const setRotation = (deg: number) => placement && sheets.length && Number.isFinite(deg) && setPlacement(aboutPoint(placement, centreOf(worldBox(sheets)), { rotation: deg / DEG }));

  const problems = inStitch && scale ? scaleProblems(sheets, scale, metersPerPoint) : [];
  const register = () => {
    if (!store || !placement || !crs || !sheets.length) return;
    const name = model?.name.replace(/\.[^.]+$/, '') || 'Map';
    const byPage: Record<number, GeoRegion[]> = {};
    for (const s of sheets) {
      byPage[s.pageIndex] = [geoRegionFor({ toGrid: (p) => pageToGrid(placement, apply(s.toWorld, p)), crs, pageIndex: s.pageIndex, bounds: s.bounds, name })];
    }
    store.setPagesGeo(byPage);
    setMode('none');
    const which = sheets.length === 1 ? pageLabel(sheets[0]!.pageIndex) : `${sheets.length} sheets (${sheets.map((s) => pageLabel(s.pageIndex)).join(', ')})`;
    onNotice(`${which} ${sheets.length === 1 ? 'is' : 'are'} registered in ${crs.name}. Save the PDF to write it into the file.`);
  };
  const unregister = (p: number) => {
    store?.setPageGeo(p, []);
    onNotice(`${pageLabel(p)} is no longer registered to a map.`);
  };

  const pageRegions = regions.filter((r) => r.pageIndex === pageIndex);
  const describe = (r: GeoRegion) => r.crs ?? (r.epsg ? `EPSG:${r.epsg}` : 'Unknown coordinate system');
  const step = pairs.length && pairs[pairs.length - 1]!.model && !pairs[pairs.length - 1]!.page ? `Click the same point on the drawing (P${pairs.length}).` : `Click a point on the model (M${pairs.filter((p) => p.page).length + 1}) — it snaps to the nearest vertex.`;
  const registered = new Set(regions.map((r) => r.pageIndex));

  /** Why "All stitched sheets" is off: the sheet on screen is in no stitch of two or more sheets. */
  const whyNoStitch = () => {
    const stitching = (
      <button className="link-button" onClick={props.onShowStitching}>
        Stitching panel
      </button>
    );
    const elsewhere = stitchGroups.filter((g) => g.placements.length > 1);
    const lines = props.matchLines.filter((l) => l.pageIndex === pageIndex);
    if (lines.length && lines.every((l) => !l.matchTo))
      return <>{pageLabel(pageIndex)} has match lines, but none is paired with a line on another sheet: set “Match to…” for each in the {stitching}.</>;
    if (elsewhere.length)
      return (
        <>
          {pageLabel(pageIndex)} is not in a stitch. Stitched sheets:{' '}
          {elsewhere.map((g, i) => (
            <span key={i}>
              {i > 0 && '; '}
              <button className="link-button" onClick={() => onGoTo(g.placements[0]!.pageIndex)}>
                {g.placements.map((p) => pageLabel(p.pageIndex)).join(', ')}
              </button>
            </span>
          ))}
          .
        </>
      );
    return (
      <>
        To register a set of plans in one go, join them with match lines in the {stitching} first. (Stitch to New Page makes a single flat page, which is registered on its own.)
      </>
    );
  };
  const onSheets = sheets.some((s) => s.pageIndex === pageIndex);

  return (
    <div className="geo-panel">
      <section>
        <h3 className="panel-subhead">This sheet</h3>
        {pageRegions.length ? (
          pageRegions.map((r) => (
            <div key={r.id} className="geo-registered">
              <span className="geo-badge">Geospatial</span>
              <span className="geo-crs">{describe(r)}</span>
              {editable && (
                <button className="btn small" title="Take the map registration off this sheet" onClick={() => unregister(pageIndex)}>
                  Remove
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="empty">{pageLabel(pageIndex)} is not registered to a map.</p>
        )}
        {registered.size > 0 && (
          <p className="geo-pages">
            Registered:{' '}
            {[...registered]
              .sort((a, b) => a - b)
              .map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <button className="link-button" onClick={() => onGoTo(p)}>
                    {pageLabel(p)}
                  </button>
                </span>
              ))}
          </p>
        )}
      </section>

      <section>
        <h3 className="panel-subhead">1. Sheets</h3>
        <div className="geo-frame" role="radiogroup" aria-label="Align over">
          <label className="field">
            <input type="radio" name="geo-frame" checked={frame === 'sheet'} disabled={!editable} onChange={() => switchFrame('sheet')} />
            This sheet only
          </label>
          <label className="field" title={hereGroup || group ? 'Line the model up once over the stitched sheets; every sheet in the stitch is registered' : 'Stitch the plans first'}>
            <input type="radio" name="geo-frame" checked={frame === 'stitch'} disabled={!editable || !(hereGroup || group)} onChange={() => switchFrame('stitch')} />
            All stitched sheets{hereGroup ? ` (${hereGroup.placements.length})` : ''}
          </label>
        </div>
        {!hereGroup && !group && <p className="geo-hint">{whyNoStitch()}</p>}
        {frame === 'stitch' && group && !stitched && (
          <div className="panel-toolbar">
            <button className="btn small" onClick={() => props.onOpenStitched(anchor)}>
              Open Stitched View
            </button>
          </div>
        )}
      </section>

      <section>
        <h3 className="panel-subhead">2. Model or CAD file</h3>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={MODEL_EXTENSIONS.join(',')}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void open(f);
          }}
        />
        {!hereScaled && (
          <div className="geo-needs-scale">
            <p className="geo-warning">Set {pageLabel(pageIndex)}’s scale first: the model is laid over the drawing at that scale.</p>
            <div className="panel-toolbar">
              <button className="btn small" disabled={!editable} onClick={props.onSetScale}>
                Set Scale…
              </button>
              {props.onCalibrate && (
                <button className="btn small" disabled={!editable} title="Click two points a known distance apart" onClick={props.onCalibrate}>
                  Calibrate
                </button>
              )}
            </div>
          </div>
        )}
        <div className="panel-toolbar">
          <button className="btn small" disabled={!editable || loading || !hereScaled} title={hereScaled ? 'IFC 4.3, LandXML, DXF or GeoJSON' : 'Set the sheet’s scale first'} onClick={() => fileInput.current?.click()}>
            {loading ? 'Reading…' : model ? 'Open Another…' : 'Open Model…'}
          </button>
          {model && (
            <button className="btn small" onClick={close}>
              Close
            </button>
          )}
        </div>
        {model ? (
          <div className="geo-model">
            <div className="geo-model-name" title={model.name}>
              {model.name}
            </div>
            <div className="geo-model-meta">
              {model.format} · {model.paths.length.toLocaleString()} lines · {model.points.length.toLocaleString()} points
              {model.crsName ? ` · ${model.crsName}` : ''}
            </div>
            {model.warnings.map((w) => (
              <p key={w} className="geo-warning">
                {w}
              </p>
            ))}
          </div>
        ) : (
          <p className="empty">Open an IFC 4.3, LandXML, DXF or GeoJSON file in a known coordinate system to line it up with the drawing.</p>
        )}
      </section>

      <section>
        <h3 className="panel-subhead">3. Coordinate system</h3>
        <select className="geo-crs-select" aria-label="Coordinate system" value={crsId} disabled={!editable} onChange={(e) => setCrsId(e.target.value)}>
          <optgroup label="Australia — GDA2020">
            {PROJECTED_CRS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id}) · {c.area}
              </option>
            ))}
          </optgroup>
        </select>
        {model?.crs && model.crs.id !== crsId && <p className="geo-warning">The file says {model.crs.name}.</p>}
        {model && !model.crs && model.crsName && <p className="geo-warning">The file names “{model.crsName}”, which is not offered: choose the zone its coordinates are in.</p>}
      </section>

      {model && (
        <section>
          <h3 className="panel-subhead">4. Line it up</h3>
          {!placement && <p className="geo-warning">Set {pageLabel(anchor)}’s scale, then press Reset.</p>}
          {placement && !onSheets && (
            <p className="geo-warning">
              The model is on {inStitch ? `the stitch of ${pageLabel(anchor)}` : pageLabel(anchor)}.{' '}
              <button className="link-button" onClick={() => (inStitch ? props.onOpenStitched(anchor) : onGoTo(anchor))}>
                Go there
              </button>{' '}
              or{' '}
              <button className="link-button" disabled={!editable || !hereScaled} onClick={() => reset()}>
                bring it here
              </button>
              .
            </p>
          )}
          <div className="panel-toolbar">
            <button className={`btn small${mode === 'move' ? ' active' : ''}`} disabled={!editable || !placement} title="Drag the model over the drawing" onClick={() => setMode(mode === 'move' ? 'none' : 'move')}>
              Move
            </button>
            <button
              className={`btn small${mode === 'pickModel' || mode === 'pickPage' ? ' active' : ''}`}
              disabled={!editable || !placement}
              title="Pick two points on the model and the same two points on the drawing; the model is moved and turned to match (its scale is the sheet's)"
              onClick={() => {
                setPairs([]);
                setMode(mode === 'pickModel' || mode === 'pickPage' ? 'none' : 'pickModel');
              }}
            >
              Align by 2 Points
            </button>
            <button className="btn small" disabled={!editable || !hereScaled} title="Centre the model over the drawing again" onClick={() => reset()}>
              Reset
            </button>
          </div>
          {(mode === 'pickModel' || mode === 'pickPage') && <p className="geo-step">{step}</p>}
          {placement && (
            <div className="geo-fields">
              <label className="field">
                Rotation
                <NumberField value={placement.rotation * DEG} digits={4} disabled={!editable} onCommit={setRotation} />°
              </label>
              <span className="field geo-scale" title={`From ${pageLabel(anchor)}’s scale`}>
                Scale 1:{Math.round(ratioOfScale(placement.scale / (anchorSheet ? worldPerPoint(anchorSheet.toWorld) : 1))).toLocaleString()}
              </span>
            </div>
          )}
          {placement && (
            <div className="panel-toolbar">
              <button className="btn small" disabled={!editable} title="Turn the model so grid north points up the sheet" onClick={() => setRotation(0)}>
                North Up
              </button>
            </div>
          )}
          {problems.map((p) => (
            <p key={p.pageIndex} className="geo-warning">
              {p.problem === 'none'
                ? `${pageLabel(p.pageIndex)} has no scale: it is registered where it sits in the stitch.`
                : `${pageLabel(p.pageIndex)}’s scale is ${Math.abs((p.ratio! - 1) * 100).toFixed(1)}% ${p.ratio! > 1 ? 'larger' : 'smaller'} than ${pageLabel(anchor)}’s in the stitch: check its scale or its join.`}
            </p>
          ))}
        </section>
      )}

      {model && placement && (
        <section>
          <h3 className="panel-subhead">5. Make it geospatial</h3>
          <p className="geo-hint">
            {inStitch
              ? `Each of the ${sheets.length} stitched sheets is registered over its drawing area, from where it sits in the stitch.`
              : `The whole of ${pageLabel(anchor)} is registered.`}{' '}
            Other apps then show latitude and longitude across {inStitch ? 'them' : 'it'} in {crs?.name ?? '—'}.
          </p>
          <div className="panel-toolbar">
            <button className="btn small primary" disabled={!editable || !crs || !sheets.length} onClick={register}>
              {inStitch ? `Georeference ${sheets.length} Sheets` : `Georeference ${pageLabel(anchor)}`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

const centreOf = (b: { x: number; y: number; width: number; height: number }): Point => [b.x + b.width / 2, b.y + b.height / 2];

/** A number box that applies its value on Enter or when it loses focus. */
function NumberField({ value, digits, disabled, onCommit }: { value: number; digits: number; disabled?: boolean; onCommit: (v: number) => void }) {
  const shown = Number(value.toFixed(digits)).toString();
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && text.trim() !== '' && v !== Number(shown)) onCommit(v);
    else setText(shown);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="geo-number"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(shown);
      }}
    />
  );
}
