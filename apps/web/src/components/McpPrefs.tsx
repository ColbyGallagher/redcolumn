import { useEffect, useState } from 'react';
import { clientSetups, type AssistantLaunch } from '../desktop/clients';
import { setAssistantOn } from '../desktop/assistantFlag';
import { desktop, type AssistantInfo } from '../desktop/host';

function platform(): 'win' | 'mac' | 'other' {
  const name = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent;
  if (/Win/.test(name)) return 'win';
  if (/Mac/.test(name)) return 'mac';
  return 'other';
}

/**
 * File › Preferences › MCP. The switch takes effect immediately. The commands start this
 * installation so Copilot, Claude, Codex, and Cursor can reach the open drawing.
 */
export function McpPrefs() {
  const [info, setInfo] = useState<AssistantInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const host = desktop();
    if (!host) return;
    void host.assistantInfo().then((next) => {
      setAssistantOn(next.enabled);
      setInfo(next);
    });
  }, []);

  const toggle = () => {
    const host = desktop();
    if (!host || !info || busy) return;
    setBusy(true);
    setError(null);
    void host
      .setAssistantEnabled(!info.enabled)
      .then((next) => {
        setInfo(next);
        setAssistantOn(next.enabled);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'The MCP server could not be changed.'))
      .finally(() => setBusy(false));
  };

  const copy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 2000);
    });
  };

  if (!info) return <p className="pref-note">Loading…</p>;
  const launch: AssistantLaunch = { command: info.command, args: info.args, env: info.env };
  const clients = clientSetups(launch, platform());

  return (
    <div className="mcp-prefs">
      <label className="pref-check">
        <input type="checkbox" checked={info.enabled} disabled={busy} onChange={toggle} />
        <span>Enable MCP server</span>
      </label>
      <p className="pref-note" role="status">
        {info.enabled ? 'On. Leave redcolumn open. This takes effect immediately, not when you press OK. Each client below starts this installation.' : 'Off. The desktop app is not listening.'}
      </p>
      {error && <p className="print-error">{error}</p>}
      <p className="pref-note">While this is on, an AI client on this computer can read the open drawing, run commands, and edit markups. Deletes and document changes wait for Allow. Drawings stay on this computer, and redcolumn does not receive them.</p>
      {clients.map((client) => (
        <section key={client.id} className="assistant-block">
          <h4>{client.title}</h4>
          <p>{client.note}</p>
          <pre>{client.copy}</pre>
          <div className="actions">
            <button type="button" className="btn" onClick={() => copy(client.id, client.copy)}>
              {copied === client.id ? 'Copied' : 'Copy'}
            </button>
            {client.href && client.hrefLabel && (
              <button type="button" className="btn" onClick={() => window.open(client.href, '_blank', 'noopener')}>
                {client.hrefLabel}
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
