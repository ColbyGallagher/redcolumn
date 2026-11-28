import { msg } from '@nb/i18n';
import { useState, type FormEvent } from 'react';
import { ServerClientError, type CreateProjectResponse, type ServerClient } from '../connect/client';
import './review.css';

export interface CreateProjectFormProps {
  client: ServerClient;
  onCreated: (result: CreateProjectResponse) => void;
  onCancel?: () => void;
}

function describeCreateError(err: unknown): string {
  if (err instanceof ServerClientError) {
    if (err.code === 'invalid_request') {
      return msg('Please enter a valid project name.');
    }
    if (err.code === 'unauthenticated') {
      return msg('Your session has expired. Please sign in again.');
    }
    return msg('Could not create project ({code}).', { code: err.code });
  }
  return msg('Could not reach the server. Check your connection and try again.');
}

export function CreateProjectForm({ client, onCreated, onCancel }: CreateProjectFormProps) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(msg('Please enter a valid project name.'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await client.createProject({
        name: trimmedName,
        number: number.trim() || null,
        description: description.trim() || null,
      });
      setName('');
      setNumber('');
      setDescription('');
      onCreated(created);
    } catch (err) {
      setError(describeCreateError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="review-panel review-form" onSubmit={handleSubmit}>
      <div className="review-panel-header">
        <h3>{msg('New project')}</h3>
      </div>

      <label className="connect-field">
        <span>{msg('Project name')}</span>
        <input
          type="text"
          required
          maxLength={200}
          placeholder={msg('e.g. Harbour Bridge Upgrade')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="connect-field">
        <span>{msg('Project number (optional)')}</span>
        <input
          type="text"
          maxLength={64}
          placeholder={msg('e.g. NB-104')}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
      </label>

      <label className="connect-field">
        <span>{msg('Description (optional)')}</span>
        <textarea
          className="review-textarea"
          rows={2}
          maxLength={2000}
          placeholder={msg('Brief scope or notes for reviewers')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      {error && (
        <div className="connect-error" role="alert">
          {error}
        </div>
      )}

      <div className="connect-actions">
        <button type="submit" className="btn primary" disabled={submitting}>
          {submitting ? msg('Creating…') : msg('Create project')}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={submitting}>
            {msg('Cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
