import { msg } from '@nb/i18n';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ServerClientError,
  type PendingProjectInvite,
  type ProjectMember,
  type ProjectRole,
  type ServerClient,
  type ServerProjectSummary,
} from '../connect/client';
import './review.css';

export interface ProjectMembersPanelProps {
  client: ServerClient;
  project: ServerProjectSummary;
  currentUserId: string;
  serverOrigin: string;
  onClose?: () => void;
  onProjectAccessLost?: () => void;
}

export function projectRoleLabel(role: ProjectRole): string {
  switch (role) {
    case 'project_admin':
      return msg('Admin');
    case 'reviewer':
      return msg('Reviewer');
    case 'viewer':
      return msg('Viewer');
  }
}

function describeMemberError(err: unknown): string {
  if (err instanceof ServerClientError) {
    switch (err.code) {
      case 'last_admin':
        return msg('Cannot demote or remove the last active project admin.');
      case 'forbidden':
        return msg('Only project admins can manage members and invitations.');
      case 'invalid_email':
        return msg('Please enter a valid email address, or leave blank for a link-only invite.');
      case 'invalid_role':
        return msg('Please choose a valid project role.');
      case 'member_not_found':
        return msg('This member is no longer on the project.');
      case 'not_found':
        return msg('Project not found or you no longer have access.');
      default:
        return msg('Request failed ({code}).', { code: err.code });
    }
  }
  return msg('Could not reach the server. Check your connection and try again.');
}

function buildFullInviteUrl(origin: string, invitePath: string): string {
  try {
    return new URL(invitePath, origin).toString();
  } catch {
    return invitePath;
  }
}

export function ProjectMembersPanel({
  client,
  project,
  currentUserId,
  serverOrigin,
  onClose,
  onProjectAccessLost,
}: ProjectMembersPanelProps) {
  const [loading, setLoading] = useState(true);
  const [callerRole, setCallerRole] = useState<ProjectRole>(project.role ?? 'viewer');
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<PendingProjectInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectRole>('reviewer');
  const [inviting, setInviting] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await client.listProjectMembers(project.id);
      setCallerRole(data.role);
      setMembers(data.members);
      setInvites(data.invites);
    } catch (err) {
      if (err instanceof ServerClientError && err.status === 404) {
        onProjectAccessLost?.();
      }
      setError(describeMemberError(err));
    } finally {
      setLoading(false);
    }
  }, [client, project.id, onProjectAccessLost]);

  useEffect(() => {
    setGeneratedLink(null);
    setCopied(false);
    void loadMembers();
  }, [loadMembers]);

  const isAdmin = callerRole === 'project_admin';

  const handleRoleChange = async (userId: string, nextRole: ProjectRole) => {
    setBusyUserId(userId);
    setError(null);
    try {
      const updated = await client.updateProjectMemberRole(project.id, userId, nextRole);
      setMembers((prev) => prev.map((m) => (m.userId === userId ? updated : m)));
      if (userId === currentUserId) {
        setCallerRole(updated.role);
      }
    } catch (err) {
      setError(describeMemberError(err));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    setBusyUserId(userId);
    setError(null);
    try {
      await client.removeProjectMember(project.id, userId);
      if (userId === currentUserId) {
        onProjectAccessLost?.();
        return;
      }
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(describeMemberError(err));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleCreateInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setCopied(false);
    try {
      const res = await client.createProjectInvite(project.id, {
        email: inviteEmail.trim() || null,
        role: inviteRole,
      });
      setGeneratedLink(buildFullInviteUrl(serverOrigin, res.inviteUrl));
      setInviteEmail('');
      setInvites((prev) => [res.invite, ...prev]);
    } catch (err) {
      setError(describeMemberError(err));
    } finally {
      setInviting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="review-panel" aria-label={msg('Project members')}>
      <div className="review-panel-header">
        <div>
          <h3>{project.name}</h3>
          {project.description && <p className="connect-muted">{project.description}</p>}
        </div>
        <div className="connect-actions">
          <span className="connect-pill">{projectRoleLabel(callerRole)}</span>
          {onClose && (
            <button type="button" className="btn" onClick={onClose}>
              {msg('Close')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="connect-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="connect-muted">{msg('Loading members…')}</p>
      ) : (
        <>
          <div className="review-subsection">
            <h4>{msg('Members ({count})', { count: String(members.length) })}</h4>
            <ul className="connect-list">
              {members.map((m) => (
                <li key={m.userId} className="connect-list-item">
                  <div>
                    <strong>
                      {m.name}
                      {m.userId === currentUserId ? ` (${msg('you')})` : ''}
                    </strong>
                    <span className="connect-item-meta">{m.email}</span>
                  </div>
                  <div className="review-member-controls">
                    {isAdmin ? (
                      <>
                        <select
                          className="review-select"
                          aria-label={msg('Role for {name}', { name: m.name })}
                          value={m.role}
                          disabled={busyUserId === m.userId}
                          onChange={(e) => void handleRoleChange(m.userId, e.target.value as ProjectRole)}
                        >
                          <option value="project_admin">{msg('Admin')}</option>
                          <option value="reviewer">{msg('Reviewer')}</option>
                          <option value="viewer">{msg('Viewer')}</option>
                        </select>
                        <button
                          type="button"
                          className="btn"
                          disabled={busyUserId === m.userId}
                          onClick={() => void handleRemove(m.userId)}
                        >
                          {msg('Remove')}
                        </button>
                      </>
                    ) : (
                      <span className="connect-pill">{projectRoleLabel(m.role)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {isAdmin && (
            <div className="review-subsection">
              <h4>{msg('Invite member')}</h4>
              <form className="review-invite-form" onSubmit={handleCreateInvite}>
                <label className="connect-field review-invite-email">
                  <span>{msg('Email (optional for link-only invite)')}</span>
                  <input
                    type="email"
                    placeholder={msg('reviewer@example.com')}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </label>
                <label className="connect-field">
                  <span>{msg('Role')}</span>
                  <select
                    className="review-select"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                  >
                    <option value="project_admin">{msg('Admin')}</option>
                    <option value="reviewer">{msg('Reviewer')}</option>
                    <option value="viewer">{msg('Viewer')}</option>
                  </select>
                </label>
                <button type="submit" className="btn primary" disabled={inviting}>
                  {inviting ? msg('Creating…') : msg('Create invite link')}
                </button>
              </form>

              {generatedLink && (
                <div className="review-invite-link-box">
                  <label className="connect-field review-invite-link-field">
                    <span>{msg('Shareable single-use invite link')}</span>
                    <input
                      type="text"
                      readOnly
                      value={generatedLink}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button type="button" className="btn" onClick={() => void handleCopyLink()}>
                    {copied ? msg('Copied') : msg('Copy link')}
                  </button>
                </div>
              )}
            </div>
          )}

          {invites.length > 0 && (
            <div className="review-subsection">
              <h4>{msg('Pending invitations ({count})', { count: String(invites.length) })}</h4>
              <ul className="connect-list">
                {invites.map((inv) => (
                  <li key={inv.id} className="connect-list-item">
                    <div>
                      <strong>{inv.email ?? msg('Link-only invitation')}</strong>
                      <span className="connect-item-meta">
                        {msg('Expires {date}', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                      </span>
                    </div>
                    <span className="connect-pill">{projectRoleLabel(inv.role)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
