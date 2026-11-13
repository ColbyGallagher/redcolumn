interface Props {
  onKeep: () => void;
  onDiscard: () => void;
}

/** Shown over a document that opened with unsaved markups kept from the last session: keep them or go back to the file. */
export function RecoveredMarkupsBar({ onKeep, onDiscard }: Props) {
  return (
    <div className="recovered-bar" role="region" aria-label="Recovered markups">
      <span className="recovered-text">Unsaved markups from your last session were recovered.</span>
      <button type="button" className="btn" onClick={onKeep}>
        Keep
      </button>
      <button type="button" className="btn" onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}
