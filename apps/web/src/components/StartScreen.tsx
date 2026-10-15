import { useEffect, useState, type ReactNode } from 'react';
import { TIP_PAGES, inlineParts, parseTip, type Tip } from '../help/startTips';

interface Props {
  /** The app was launched to open a file: Open is the default button. */
  launchOpen: boolean;
  onOpen: () => void;
  onNew: () => void;
  /** Show a tip from the help (Preferences › Show a Tip on the Start Screen). */
  showTip: boolean;
  onHideTip: () => void;
  /** Opens a help page by id. */
  onHelp: (page: string) => void;
}

const TIP_KEY = 'rc.startTip';
const tips = new Map<string, Tip | null>();

/** Each visit moves on to the next tip, so the start screen teaches something new each time. */
function firstTip(): number {
  try {
    const last = Number(localStorage.getItem(TIP_KEY));
    const next = localStorage.getItem(TIP_KEY) === null || !Number.isFinite(last) ? Math.floor(Math.random() * TIP_PAGES.length) : (last + 1) % TIP_PAGES.length;
    localStorage.setItem(TIP_KEY, String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * TIP_PAGES.length);
  }
}

async function loadTip(id: string): Promise<Tip | null> {
  if (!tips.has(id)) {
    const res = await fetch(`${import.meta.env.BASE_URL}help/pages/${id}.md`);
    tips.set(id, res.ok ? parseTip(await res.text()) : null);
  }
  return tips.get(id) ?? null;
}

/** Help text with its keys, menu paths, bold and links. */
function HelpText({ text, onHelp }: { text: string; onHelp: (page: string) => void }) {
  return (
    <>
      {inlineParts(text).map((p, i): ReactNode => {
        switch (p.kind) {
          case 'bold':
            return <strong key={i}>{p.text}</strong>;
          case 'code':
            return <code key={i}>{p.text}</code>;
          case 'keys':
            return (
              <span key={i} className="keys">
                {p.keys.map((k, j) => (
                  <kbd key={j}>{k}</kbd>
                ))}
              </span>
            );
          case 'menu':
            return (
              <span key={i} className="menu-path">
                {p.path.join(' › ')}
              </span>
            );
          case 'link':
            if (p.page)
              return (
                <button key={i} type="button" className="tip-link" onClick={() => onHelp(p.page!)}>
                  {p.text}
                </button>
              );
            if (p.url)
              return (
                <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.text}
                </a>
              );
            return p.text;
          default:
            return p.text;
        }
      })}
    </>
  );
}

/** What shows when no document is open: Open and New, and a step-by-step tip from the help. */
export function StartScreen({ launchOpen, onOpen, onNew, showTip, onHideTip, onHelp }: Props) {
  const [index, setIndex] = useState(firstTip);
  const [tip, setTip] = useState<Tip | null>(null);
  const [failed, setFailed] = useState(false);
  const [pictureOk, setPictureOk] = useState(true);
  const page = TIP_PAGES[index]!;

  useEffect(() => {
    if (!showTip) return;
    let live = true;
    setPictureOk(true);
    loadTip(page)
      .then((t) => {
        if (!live) return;
        setTip(t);
        setFailed(!t);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [page, showTip]);

  const step = (by: number) =>
    setIndex((i) => {
      const next = (i + by + TIP_PAGES.length) % TIP_PAGES.length;
      try {
        localStorage.setItem(TIP_KEY, String(next));
      } catch {
        // Only remembers where the tips got to.
      }
      return next;
    });

  return (
    <div className="start-screen">
      <div className="start-inner">
        <div className="start-actions">
          <button type="button" className="start-action primary" autoFocus={launchOpen} onClick={onOpen}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span>
              <strong>Open PDF…</strong>
              <small>From this computer · Ctrl+O</small>
            </span>
          </button>
          <button type="button" className="start-action" onClick={onNew}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3v5h5 M12 11v6 M9 14h6" />
            </svg>
            <span>
              <strong>New PDF…</strong>
              <small>Blank, title block or template · Ctrl+N</small>
            </span>
          </button>
        </div>
        <p className="start-drop">or drop a PDF anywhere on this window</p>

        {showTip && !failed && tip && (
          <section className="tip-card" aria-label="Tip">
            <header>
              <span className="tip-badge">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
                </svg>
                Did you know?
              </span>
              <span className="tip-nav">
                <button type="button" className="icon-btn" title="Previous tip" aria-label="Previous tip" onClick={() => step(-1)}>
                  ‹
                </button>
                <span className="tip-count">
                  {index + 1} / {TIP_PAGES.length}
                </span>
                <button type="button" className="icon-btn" title="Next tip" aria-label="Next tip" onClick={() => step(1)}>
                  ›
                </button>
                <button type="button" className="icon-btn" title="Hide tips (turn them back on in Preferences › Interface)" aria-label="Hide tips" onClick={onHideTip}>
                  ×
                </button>
              </span>
            </header>
            <h2>{tip.title}</h2>
            {tip.intro && (
              <p className="tip-intro">
                <HelpText text={tip.intro} onHelp={onHelp} />
              </p>
            )}
            <div className={`tip-body${tip.image && pictureOk ? ' with-picture' : ''}`}>
              <ol>
                {tip.steps.map((s, i) => (
                  <li key={i}>
                    <HelpText text={s.text} onHelp={onHelp} />
                    {s.sub.length > 0 && (
                      <ul>
                        {s.sub.map((x, j) => (
                          <li key={j}>
                            <HelpText text={x} onHelp={onHelp} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
              {tip.image && pictureOk && (
                <figure>
                  {/* Help pictures are not kept offline; the tip reads fine without one. */}
                  <img src={`${import.meta.env.BASE_URL}help/${tip.image.src}`} alt={tip.image.alt.replace(/[*_`]/g, '')} loading="lazy" onError={() => setPictureOk(false)} />
                </figure>
              )}
            </div>
            {tip.note && (
              <p className="tip-note">
                <HelpText text={tip.note} onHelp={onHelp} />
              </p>
            )}
            <footer>
              <button type="button" className="tip-link" onClick={() => onHelp(page)}>
                Read the full guide →
              </button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
