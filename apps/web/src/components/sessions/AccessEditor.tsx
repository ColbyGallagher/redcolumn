import { useState } from 'react';
import { accessFor, sameName, type Access, type AccessGroup, type AccessPolicy } from '../../studio/protocol';

export const ACCESS_LABELS: Record<Access, string> = {
  none: 'No access',
  view: 'View documents',
  markup: 'Add comments',
};

export const ACCESS_SHORT: Record<Access, string> = {
  none: 'No access',
  view: 'View',
  markup: 'Comment',
};

export const emptyPolicy = (): AccessPolicy => ({ default: 'markup', people: [], groups: [] });

let groupSeq = 0;
const newGroupId = () => `g${Date.now().toString(36)}${(groupSeq++).toString(36)}`;

/** Splits "a, b; c" into names, dropping blanks and duplicates. */
export function splitNames(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const n = raw.trim();
    if (n && !out.some((x) => sameName(x, n))) out.push(n);
  }
  return out;
}

function AccessSelect({ value, onChange, inherit, label }: { value: Access | null; onChange: (a: Access | null) => void; inherit?: string; label: string }) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as Access | null)}>
      {inherit && <option value="">{inherit}</option>}
      {(['markup', 'view', 'none'] as const).map((a) => (
        <option key={a} value={a}>
          {ACCESS_LABELS[a]}
        </option>
      ))}
    </select>
  );
}

/**
 * Edits who may do what in a session: a default for anyone with the session ID, people with their
 * own level (or their groups'), and groups of people sharing a level.
 */
export function AccessEditor({ policy, onChange, host }: { policy: AccessPolicy; onChange: (p: AccessPolicy) => void; host: string }) {
  const [adding, setAdding] = useState('');
  const [groupName, setGroupName] = useState('');
  const meta = { access: policy, permissions: { markup: true, addDocuments: true } };

  const addPeople = () => {
    const names = splitNames(adding).filter((n) => !sameName(n, host) && !policy.people.some((p) => sameName(p.name, n)));
    if (names.length) onChange({ ...policy, people: [...policy.people, ...names.map((name) => ({ name, access: null }))] });
    setAdding('');
  };

  const setGroup = (id: string, patch: Partial<AccessGroup>) => onChange({ ...policy, groups: policy.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });

  const toggleMember = (g: AccessGroup, name: string) =>
    setGroup(g.id, { members: g.members.some((m) => sameName(m, name)) ? g.members.filter((m) => !sameName(m, name)) : [...g.members, name] });

  return (
    <div className="access-editor">
      <label className="access-default">
        <span>Anyone else with the session ID</span>
        <AccessSelect label="Access for anyone else" value={policy.default} onChange={(a) => onChange({ ...policy, default: a ?? 'markup' })} />
      </label>

      <h4>People</h4>
      <table className="access-table">
        <tbody>
          <tr className="host-row">
            <td>
              <span className="who">{host}</span>
            </td>
            <td colSpan={2}>
              <span className="access-badge host">Host · full control</span>
            </td>
          </tr>
          {policy.people.map((p) => {
            const groups = policy.groups.filter((g) => g.members.some((m) => sameName(m, p.name)));
            const effective = accessFor(meta, p.name, false);
            return (
              <tr key={p.name}>
                <td>
                  <span className="who" title={p.name}>
                    {p.name}
                  </span>
                  {groups.length > 0 && <span className="groups">{groups.map((g) => g.name).join(', ')}</span>}
                </td>
                <td>
                  <AccessSelect
                    label={`Access for ${p.name}`}
                    value={p.access}
                    inherit={`${groups.length ? 'From groups' : 'Default'} (${ACCESS_SHORT[effective]})`}
                    onChange={(access) => onChange({ ...policy, people: policy.people.map((x) => (x.name === p.name ? { ...x, access } : x)) })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn small flat"
                    title={`Remove ${p.name}`}
                    onClick={() =>
                      onChange({
                        ...policy,
                        people: policy.people.filter((x) => x.name !== p.name),
                        groups: policy.groups.map((g) => ({ ...g, members: g.members.filter((m) => !sameName(m, p.name)) })),
                      })
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addPeople();
            }
          }}
          placeholder="Names or emails, separated by commas"
          aria-label="Add people"
        />
        <button type="button" className="btn" disabled={!adding.trim()} onClick={addPeople}>
          Add
        </button>
      </div>

      <h4>Groups</h4>
      {policy.groups.length === 0 && <p className="hint">Groups give several people the same access, e.g. “Reviewers” who can only view.</p>}
      {policy.groups.map((g) => (
        <fieldset key={g.id} className="access-group">
          <div className="row">
            <input aria-label="Group name" value={g.name} onChange={(e) => setGroup(g.id, { name: e.target.value })} maxLength={60} />
            <AccessSelect label={`Access for ${g.name}`} value={g.access} onChange={(a) => setGroup(g.id, { access: a ?? 'view' })} />
            <button type="button" className="btn small flat" title={`Delete ${g.name}`} onClick={() => onChange({ ...policy, groups: policy.groups.filter((x) => x.id !== g.id) })}>
              ×
            </button>
          </div>
          {policy.people.length === 0 ? (
            <p className="hint">Add people above, then tick who belongs to this group.</p>
          ) : (
            <div className="members">
              {policy.people.map((p) => (
                <label key={p.name} className="member">
                  <input type="checkbox" checked={g.members.some((m) => sameName(m, p.name))} onChange={() => toggleMember(g, p.name)} />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      <div className="row">
        <input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="New group name"
          aria-label="New group name"
          maxLength={60}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={!groupName.trim()}
          onClick={() => {
            onChange({ ...policy, groups: [...policy.groups, { id: newGroupId(), name: groupName.trim(), access: 'view', members: [] }] });
            setGroupName('');
          }}
        >
          Create group
        </button>
      </div>
    </div>
  );
}
