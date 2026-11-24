import { msg, msgParts } from '@nb/i18n';
import { keyed } from '../i18n/keyed';
import { useState } from 'react';
import { parsePageRange } from '../documents/printPdf';
import type { Colourspace } from '../documents/imagePdf';
import { settings } from '../settings/settings';

export type PublishRequest =
  | { kind: 'pdf'; flatten: boolean; reduce: boolean; quality: number; clean: boolean }
  | { kind: 'images'; format: 'png' | 'jpeg' | 'tiff'; dpi: number; colour: Colourspace; pages: number[]; markups: boolean };

interface Props {
  mode: 'pdf' | 'images';
  pageCount: number;
  currentPage: number;
  busy: boolean;
  onRun: (req: PublishRequest) => void;
  onClose: () => void;
}

/**
 * File › Publish (a copy to hand out: markups flattened, smaller, cleanly rewritten) and File ›
 * Export › Page Images (PNG, JPEG or TIFF, with or without markups). The image settings start from
 * Preferences › Images.
 */
export function PublishDialog({ mode, pageCount, currentPage, busy, onRun, onClose }: Props) {
  const [flatten, setFlatten] = useState(true);
  const [reduce, setReduce] = useState(false);
  const [quality, setQuality] = useState(70);
  const [clean, setClean] = useState(true);
  const [format, setFormat] = useState<'png' | 'jpeg' | 'tiff'>('png');
  const [dpi, setDpi] = useState(() => (settings.get().exportResolution === 'auto' ? 150 : Number(settings.get().exportResolution)));
  const [colour, setColour] = useState<Colourspace>(() => settings.get().exportColourspace);
  const [range, setRange] = useState<'all' | 'current' | 'range'>('current');
  const [rangeText, setRangeText] = useState(`1-${pageCount}`);
  const [markups, setMarkups] = useState(true);
  const pages = range === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : range === 'current' ? [currentPage] : parsePageRange(rangeText, pageCount);
  const valid = mode === 'pdf' || (pages !== null && pages.length > 0 && dpi >= 36 && dpi <= 600);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal publish-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          if (mode === 'pdf') onRun({ kind: 'pdf', flatten, reduce, quality: quality / 100, clean });
          else onRun({ kind: 'images', format, dpi, colour, pages: pages!, markups });
        }}
      >
        {mode === 'pdf' ? (
          <>
            <h3>{msg('Publish')}</h3>
            <p>{msg('Saves a copy to hand out. The document here is not changed.')}</p>
            <label className="field">
              {keyed(msgParts('{input}Flatten markups (part of the drawing; they cannot be edited or removed)', { input: <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> }))}
            </label>
            <label className="field">
              {keyed(msgParts('{input}Remove editing history (write the file again from scratch)', { input: <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} /> }))}
            </label>
            <label className="field">
              {keyed(msgParts('{input}Compress pictures', { input: <input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} /> }))}
            </label>
            {reduce && (
              <label className="field">
                {keyed(msgParts('JPEG quality{input}{quality}%', { input: <input type="range" min={30} max={95} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />, quality }))}
              </label>
            )}
          </>
        ) : (
          <>
            <h3>{msg('Export Page Images')}</h3>
            <div className="form-grid">
              <label>{msg('Format')}</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg' | 'tiff')}>
                <option value="png">{msg('PNG (sharp lines)')}</option>
                <option value="jpeg">{msg('JPEG (smaller)')}</option>
                <option value="tiff">{msg('TIFF')}</option>
              </select>
              <label>{msg('Colour')}</label>
              <select value={colour} onChange={(e) => setColour(e.target.value as Colourspace)} disabled={format === 'tiff' && settings.get().tiffCompression === 'ccittG4'}>
                <option value="auto">{msg('As drawn')}</option>
                <option value="colour">{msg('Colour')}</option>
                <option value="grey">{msg('Greyscale')}</option>
                <option value="mono">{msg('Black and white')}</option>
              </select>
              <label>{msg('Resolution')}</label>
              <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                {[...new Set([72, 96, 150, 200, 300, 400, 600, dpi])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {msg('{d} dpi', { d })}
                  </option>
                ))}
              </select>
              <label>{msg('Pages')}</label>
              <span className="radio-row">
                <label>
                  {keyed(msgParts('{input} Current', { input: <input type="radio" checked={range === 'current'} onChange={() => setRange('current')} /> }))}
                </label>
                <label>
                  {keyed(msgParts('{input} All ({pageCount})', { input: <input type="radio" checked={range === 'all'} onChange={() => setRange('all')} />, pageCount }))}
                </label>
                <label>
                  <input type="radio" checked={range === 'range'} onChange={() => setRange('range')} />
                  <input value={rangeText} onChange={(e) => setRangeText(e.target.value)} onFocus={() => setRange('range')} aria-invalid={range === 'range' && !pages} style={{ width: 90 }} />
                </label>
              </span>
            </div>
            <label className="field">
              {keyed(msgParts('{input}Include markups', { input: <input type="checkbox" checked={markups} onChange={(e) => setMarkups(e.target.checked)} /> }))}
            </label>
            <p className="pref-hint">
              {format === 'tiff' && settings.get().tiffCompression === 'ccittG4' ? msg('TIFFs use CCITT Group 4 compression, which is black and white (Preferences › Images).') + ' ' : ''}
              {format === 'tiff' && settings.get().multiPageTiff ? msg('All the pages go into one multi-page TIFF.') : msg('Several pages are saved together in a .zip.')}
            </p>
          </>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            {msg('Cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!valid || busy}>
            {busy ? msg('Working…') : mode === 'pdf' ? msg('Publish') : msg('Export')}
          </button>
        </div>
      </form>
    </div>
  );
}
