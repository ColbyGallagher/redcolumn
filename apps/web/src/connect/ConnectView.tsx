import { msg } from '@nb/i18n';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createServerClient,
  ServerClientError,
  type InvitePreview,
  type ServerClient,
  type ServerSessionsResponse,
  type ServerUser,
} from './client';
import { clearInviteFromUrl, type ServerModeConfig } from './config';
import './connect.css';

export interface ConnectViewProps {
  config: ServerModeConfig;
  initialInviteToken?: string | null;
  client?: ServerClient;
  onOpenLocal: () => void;
  onNewLocal: () => void;
  onUserChange?: (user: ServerUser | null) => void;
}

function serverHostLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function describeAuthError(err: unknown): string {
  if (err instanceof ServerClientError) {
    switch (err.code) {
      case 'invalid_credentials':
        return msg('Invalid email or password.');
      case 'invalid_request':
        return msg('Enter both your email address and password.');
      case 'rate_limited':
        return msg('Too many attempts. Please wait a moment and try again.');
      case 'invite_not_found':
        return msg('This invitation link is invalid or no longer available.');
      case 'invite_expired':
        return msg('This invitation has expired. Ask an administrator for a new link.');
      case 'invite_already_accepted':
        return msg('This invitation has already been accepted.');
      case 'email_mismatch':
        return msg('You are signed in with a different email address than this invitation.');
      case 'account_exists':
        return msg('An account with this email already exists. Sign in first to accept the invitation.');
      case 'invalid_password':
        return msg('Password must be at least 8 characters long.');
      case 'invalid_name':
        return msg('Please enter your display name.');
      default:
        return msg('Request failed ({code}).', { code: err.code });
    }
  }
  return msg('Could not reach the server. Check your connection and try again.');
}

function stateLabel(state: 'open' | 'locked' | 'closed' | null): string {
  if (state === 'open') return msg('Open');
  if (state === 'locked') return msg('Locked');
  if (state === 'closed') return msg('Closed');
  return msg('Active');
}

export function ConnectView({
  config,
  initialInviteToken = null,
  client: providedClient,
  onOpenLocal,
  onNewLocal,
  onUserChange,
}: ConnectViewProps) {
  const client = useMemo(() => providedClient ?? createServerClient(), [providedClient]);
  const hostLabel = useMemo(() => serverHostLabel(config.origin), [config.origin]);

  const [checkingSession, setCheckingSession] = useState(true);
  const [user, setUser] = useState<ServerUser | null>(null);

  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [sessionsData, setSessionsData] = useState<ServerSessionsResponse>({ projects: [], sessions: [] });
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const updateUser = useCallback(
    (next: ServerUser | null) => {
      setUser(next);
      onUserChange?.(next);
    },
    [onUserChange],
  );

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const data = await client.listSessions();
      setSessionsData(data);
    } catch (err) {
      if (err instanceof ServerClientError && err.status === 401) {
        updateUser(null);
      } else {
        setSessionsError(describeAuthError(err));
      }
    } finally {
      setSessionsLoading(false);
    }
  }, [client, updateUser]);

  // Check current session on mount.
  useEffect(() => {
    let live = true;
    setCheckingSession(true);
    void client
      .me()
      .then((me) => {
        if (!live) return;
        updateUser(me);
      })
      .catch(() => {
        if (!live) return;
        updateUser(null);
      })
      .finally(() => {
        if (live) setCheckingSession(false);
      });
    return () => {
      live = false;
    };
  }, [client, updateUser]);

  // Load invite preview whenever an invite token is active.
  useEffect(() => {
    if (!inviteToken) {
      setInvitePreview(null);
      setInviteError(null);
      return;
    }
    let live = true;
    setInviteLoading(true);
    setInviteError(null);
    setInvitePreview(null);
    void client
      .previewInvite(inviteToken)
      .then((preview) => {
        if (!live) return;
        setInvitePreview(preview);
        setEmail(preview.email);
        if (preview.name) setDisplayName(preview.name);
      })
      .catch((err) => {
        if (!live) return;
        setInviteError(describeAuthError(err));
      })
      .finally(() => {
        if (live) setInviteLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, inviteToken]);

  // Load projects & sessions whenever signed in and not on the invite screen.
  useEffect(() => {
    if (!user || inviteToken) return;
    void loadSessions();
  }, [user, inviteToken, loadSessions]);

  const dismissInvite = () => {
    setInviteToken(null);
    setInvitePreview(null);
    setInviteError(null);
    setFormError(null);
    clearInviteFromUrl();
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const signedIn = await client.login(email.trim(), password);
      setPassword('');
      updateUser(signedIn);
    } catch (err) {
      setFormError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!inviteToken || !invitePreview) return;
    setFormError(null);

    if (!user && !invitePreview.hasAccount) {
      if (password.length < 8) {
        setFormError(msg('Password must be at least 8 characters long.'));
        return;
      }
      if (password !== confirmPassword) {
        setFormError(msg('Passwords do not match.'));
        return;
      }
    }

    setSubmitting(true);
    try {
      if (!user && invitePreview.hasAccount) {
        const signedIn = await client.login(invitePreview.email, password);
        updateUser(signedIn);
        setPassword('');
        const acceptedUser = await client.acceptInvite(inviteToken);
        setConfirmPassword('');
        updateUser(acceptedUser);
        dismissInvite();
        return;
      }

      const acceptedUser = user
        ? await client.acceptInvite(inviteToken)
        : await client.acceptInvite(inviteToken, {
            name: displayName.trim() || undefined,
            password,
          });
      setPassword('');
      setConfirmPassword('');
      updateUser(acceptedUser);
      dismissInvite();
    } catch (err) {
      setFormError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setSubmitting(true);
    try {
      await client.logout();
    } finally {
      setSubmitting(false);
      setSessionsData({ projects: [], sessions: [] });
      updateUser(null);
    }
  };

  if (checkingSession) {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <p className="connect-muted">{msg('Connecting to server…')}</p>
        </div>
      </div>
    );
  }

  // 1. Invite acceptance view
  if (inviteToken) {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <div className="connect-header">
            <span className="connect-badge">{hostLabel}</span>
            <h1>{msg('Accept invitation')}</h1>
          </div>

          {inviteLoading ? (
            <p className="connect-muted">{msg('Checking invitation…')}</p>
          ) : inviteError ? (
            <div className="connect-stack">
              <div className="connect-error" role="alert">
                {inviteError}
              </div>
              <div className="connect-actions">
                <button type="button" className="btn primary" onClick={dismissInvite}>
                  {msg('Continue to sign in')}
                </button>
                <button type="button" className="btn" onClick={onOpenLocal}>
                  {msg('Open a local file instead')}
                </button>
              </div>
            </div>
          ) : invitePreview ? (
            <form className="connect-form" onSubmit={handleAcceptInvite}>
              <div className="connect-invite-meta">
                <p>
                  {msg('Invited email: {email}', { email: invitePreview.email })}
                </p>
                {invitePreview.projectName && (
                  <p>
                    {msg('Project: {name}', { name: invitePreview.projectName })}
                  </p>
                )}
                {invitePreview.scopeName && (
                  <p>
                    {msg('Session: {name}', { name: invitePreview.scopeName })}
                  </p>
                )}
              </div>

              {user ? (
                <p className="connect-muted">
                  {msg('Signed in as {name} ({email}).', { name: user.name, email: user.email })}
                </p>
              ) : invitePreview.hasAccount ? (
                <>
                  <p className="connect-muted">
                    {msg('Sign in with your existing password to accept this invitation.')}
                  </p>
                  <label className="connect-field">
                    <span>{msg('Password')}</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="connect-field">
                    <span>{msg('Display name')}</span>
                    <input
                      type="text"
                      autoComplete="name"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </label>
                  <label className="connect-field">
                    <span>{msg('Password')}</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <label className="connect-field">
                    <span>{msg('Confirm password')}</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                </>
              )}

              {formError && (
                <div className="connect-error" role="alert">
                  {formError}
                </div>
              )}

              <div className="connect-actions">
                <button type="submit" className="btn primary" disabled={submitting}>
                  {submitting
                    ? msg('Accepting…')
                    : user || invitePreview.hasAccount
                      ? msg('Accept invitation')
                      : msg('Create account & accept')}
                </button>
                <button type="button" className="btn" onClick={dismissInvite} disabled={submitting}>
                  {msg('Cancel')}
                </button>
              </div>
            </form>
          ) : null}

          <div className="connect-divider">
            <span>{msg('or')}</span>
          </div>
          <div className="connect-local-row">
            <button type="button" className="btn" onClick={onOpenLocal}>
              {msg('Open a local file instead')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Sign-in view (when unauthenticated)
  if (!user) {
    return (
      <div className="connect-screen">
        <div className="connect-card">
          <div className="connect-header">
            <span className="connect-badge">{hostLabel}</span>
            <h1>{msg('Sign in to redcolumn')}</h1>
            <p className="connect-muted">{msg('Sign in to access your server projects and review sessions.')}</p>
          </div>

          {config.auth.local && (
            <form className="connect-form" onSubmit={handleLoginSubmit}>
              <label className="connect-field">
                <span>{msg('Email')}</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="connect-field">
                <span>{msg('Password')}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              {formError && (
                <div className="connect-error" role="alert">
                  {formError}
                </div>
              )}

              <button type="submit" className="btn primary connect-submit" disabled={submitting}>
                {submitting ? msg('Signing in…') : msg('Sign in')}
              </button>
            </form>
          )}

          <div className="connect-divider">
            <span>{msg('Local files')}</span>
          </div>
          <div className="connect-local-row">
            <button type="button" className="btn" onClick={onOpenLocal}>
              {msg('Open a local file instead')}
            </button>
            <button type="button" className="btn" onClick={onNewLocal}>
              {msg('New PDF…')}
            </button>
          </div>
          <p className="connect-drop-hint">{msg('Local PDFs open directly on this device with no account required.')}</p>
        </div>
      </div>
    );
  }

  // 3. Signed-in session & project list view
  return (
    <div className="connect-screen">
      <div className="connect-workspace">
        <header className="connect-workspace-header">
          <div>
            <span className="connect-badge">{hostLabel}</span>
            <h1>{msg('Server workspace')}</h1>
            <p className="connect-muted">
              {msg('Signed in as {name} ({email})', { name: user.name, email: user.email })}
            </p>
          </div>
          <div className="connect-header-actions">
            <button type="button" className="btn" onClick={() => void loadSessions()} disabled={sessionsLoading}>
              {msg('Refresh')}
            </button>
            <button type="button" className="btn" onClick={() => void handleLogout()} disabled={submitting}>
              {msg('Sign out')}
            </button>
          </div>
        </header>

        {sessionsError && (
          <div className="connect-error" role="alert">
            {sessionsError}
          </div>
        )}

        <section className="connect-section" aria-label={msg('Projects & sessions')}>
          <h2>{msg('Projects & review sessions')}</h2>
          {sessionsLoading ? (
            <p className="connect-muted">{msg('Loading…')}</p>
          ) : sessionsData.projects.length === 0 && sessionsData.sessions.length === 0 ? (
            <div className="connect-empty">
              <p>{msg('No projects or review sessions yet.')}</p>
              <p className="connect-muted">
                {msg('Projects and sessions assigned to your account will appear here.')}
              </p>
            </div>
          ) : (
            <div className="connect-lists">
              {sessionsData.sessions.length > 0 && (
                <ul className="connect-list">
                  {sessionsData.sessions.map((s) => (
                    <li key={s.id} className="connect-list-item">
                      <div>
                        <strong>{s.name}</strong>
                        <span className="connect-item-meta">{s.projectName}</span>
                      </div>
                      <span className="connect-pill">{stateLabel(s.state)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {sessionsData.projects.length > 0 && (
                <div className="connect-projects-block">
                  <h3>{msg('Projects')}</h3>
                  <ul className="connect-list">
                    {sessionsData.projects.map((p) => (
                      <li key={p.id} className="connect-list-item">
                        <div>
                          <strong>{p.name}</strong>
                          {p.number && <span className="connect-item-meta">{p.number}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <footer className="connect-workspace-footer">
          <div className="connect-local-row">
            <button type="button" className="btn" onClick={onOpenLocal}>
              {msg('Open a local file')}
            </button>
            <button type="button" className="btn" onClick={onNewLocal}>
              {msg('New PDF…')}
            </button>
          </div>
          <span className="connect-muted">{msg('or drop a PDF anywhere on this window')}</span>
        </footer>
      </div>
    </div>
  );
}
