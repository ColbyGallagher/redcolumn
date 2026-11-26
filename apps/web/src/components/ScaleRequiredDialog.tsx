import { msg } from '@nb/i18n';
interface Props {
  /** The tool that needs the scale is Scale to Length (otherwise a measuring tool). */
  scaleToLength: boolean;
  /** The page without a scale, e.g. "Page 3" or its sheet number. */
  page: string;
  /** The sheet's title block says NOT TO SCALE: measuring it is discouraged rather than asked for. */
  notToScale?: boolean;
  /** Opens Set Page Scale. */
  onSetScale: () => void;
  /** Starts the Calibrate tool. Null when calibrating is not possible. */
  onCalibrate: (() => void) | null;
  onCancel: () => void;
}

/**
 * Shown when Scale to Length or a measuring tool is used on a page that has no scale yet. On a
 * sheet marked NOT TO SCALE it warns instead: Cancel is the default, and setting a scale is still
 * possible for a part of the sheet that is drawn to scale.
 */
export function ScaleRequiredDialog({ scaleToLength, page, notToScale, onSetScale, onCalibrate, onCancel }: Props) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          // Enter does the default: Cancel on a not-to-scale sheet, Set Scale otherwise.
          if (notToScale) onCancel();
          else onSetScale();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
      >
        {notToScale ? (
          <>
            <h3>{msg('This sheet is not to scale')}</h3>
            <p>
              {msg('{page}’s title block says NOT TO SCALE, so lengths measured on it are not real-world lengths and should not go into a takeoff. Measure a sheet drawn to scale instead. If part of this sheet is drawn to scale, calibrate from a known dimension in that part.', { page })}
            </p>
          </>
        ) : (
          <>
            <h3>{msg('Set a page scale first')}</h3>
            <p>
              {msg('{page} has no scale, so {value} can’t use real-world lengths. Set the page’s scale, or calibrate it from a known dimension, then try again.', { page, value: scaleToLength ? msg('Scale to Length') : msg('measurements') })}
            </p>
          </>
        )}
        <div className="actions">
          <button type={notToScale ? 'submit' : 'button'} className={notToScale ? 'btn primary' : 'btn'} autoFocus={notToScale} onClick={notToScale ? undefined : onCancel}>
            {msg('Cancel')}
          </button>
          {onCalibrate && (
            <button type="button" className="btn" title={msg('Draw a line over a known dimension on the drawing')} onClick={onCalibrate}>
              {msg('Calibrate…')}
            </button>
          )}
          <button type={notToScale ? 'button' : 'submit'} className={notToScale ? 'btn' : 'btn primary'} autoFocus={!notToScale} onClick={notToScale ? onSetScale : undefined}>
            {notToScale ? msg('Set Scale Anyway…') : msg('Set Scale…')}
          </button>
        </div>
      </form>
    </div>
  );
}
