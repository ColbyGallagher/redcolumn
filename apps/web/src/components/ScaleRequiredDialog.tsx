interface Props {
  /** The tool that needs the scale is Scale to Length (otherwise a measuring tool). */
  scaleToLength: boolean;
  /** The page without a scale, e.g. "Page 3" or its sheet number. */
  page: string;
  /** Opens Set Page Scale. */
  onSetScale: () => void;
  /** Starts the Calibrate tool. Null when calibrating is not possible. */
  onCalibrate: (() => void) | null;
  onCancel: () => void;
}

/** Shown when Scale to Length or a measuring tool is used on a page that has no scale yet. */
export function ScaleRequiredDialog({ scaleToLength, page, onSetScale, onCalibrate, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSetScale();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3>Set a page scale first</h3>
        <p>
          {page} has no scale, so {scaleToLength ? 'Scale to Length' : 'measurements'} can’t use real-world lengths. Set the page’s scale, or calibrate it from a known
          dimension, then try again.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          {onCalibrate && (
            <button type="button" className="btn" title="Draw a line over a known dimension on the drawing" onClick={onCalibrate}>
              Calibrate…
            </button>
          )}
          <button type="submit" className="btn primary" autoFocus>
            Set Scale…
          </button>
        </div>
      </form>
    </div>
  );
}
