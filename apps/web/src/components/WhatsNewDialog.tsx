import { WHATS_NEW, formatReleaseDate } from '../help/whatsNew';

/** Help › Learn What's New. */
export function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal whats-new"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3>What's New in redcolumn</h3>
        {WHATS_NEW.map((release) => (
          <div key={release.version} className="whats-new-release">
            <h4>
              Version {release.version} <span className="muted">· Released {formatReleaseDate(release.date)}</span>
            </h4>
            {release.sections.map((section) => (
              <section key={section.title}>
                <h5>{section.title}</h5>
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}
        <div className="actions">
          <button className="btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
