/**
 * Sessions and Projects in the browser: there is no way to take part, so the panel only explains
 * them. Both need the desktop app, which reads and writes a shared folder on the computer.
 */
export function DesktopOnlyNotice({ kind }: { kind: 'sessions' | 'projects' }) {
  const sessions = kind === 'sessions';
  return (
    <div className="sessions rc-studio rc-desktop-only">
      <div className="rc-desktop-only-banner" role="note">
        <b>{sessions ? 'Sessions' : 'Projects'} only work in the redcolumn desktop app, and they work locally only.</b>
        <p>
          The web version cannot start, join or open {sessions ? 'sessions' : 'projects'}. Install the desktop app to use them.
        </p>
      </div>
      <div className="rc-help rc-help-body">
        {sessions ? (
          <>
            <p>A session lets several people look at the same PDFs and mark them up together, from different places. Everyone sees the others' markups and chat within seconds.</p>
            <h4>Where it lives</h4>
            <p>
              The person who starts the session (the host) chooses a shared folder on their computer: a OneDrive, Teams or Dropbox folder, or a network drive. redcolumn puts the PDFs in it. Your documents are kept in that folder, not on a redcolumn server, and when the host ends the
              session the folder's files are removed.
            </p>
            <h4>Joining</h4>
            <ul>
              <li>Everyone who can open that folder joins by choosing it in Join. Nobody signs in to anything.</li>
              <li>Changes arrive as fast as the folder syncs.</li>
              <li>You can be in several sessions at once and switch between them.</li>
            </ul>
            <h4>In a session</h4>
            <ul>
              <li>Markups and chat from everyone appear on the shared documents.</li>
              <li>The host adds documents, replaces a document with a new revision, and ends the session.</li>
              <li>Each session keeps a Record of what happened. Export it, or a session report, when you are done.</li>
              <li>If you lose your connection, keep working. Your markups are saved on this device and shared when the folder syncs again.</li>
            </ul>
          </>
        ) : (
          <>
            <p>A project is a shared folder of PDFs for a team, such as all the drawings for one job. Everyone with access sees the same files and the same markups, and the project remembers every version of each file.</p>
            <h4>Where it lives</h4>
            <p>Projects are stored in a folder on your computer that a sync app (OneDrive, Dropbox or a company file server) shares. The files stay in storage you control, never on a redcolumn server.</p>
            <h4>Who can do what</h4>
            <ul>
              <li>Nobody signs in. Your sync app does the sharing and decides who can edit and who can only view.</li>
              <li>You can choose to encrypt a project when you create it. The key is in the project link, so keep that link safe: a lost link cannot be recovered.</li>
            </ul>
            <h4>Working on files</h4>
            <ul>
              <li>Double-click a PDF to open it. Markups are shared and need no check-out.</li>
              <li>Check Out reserves a PDF so only you can replace it with a new version. Check In saves your version, and the old ones stay available under Revisions.</li>
              <li>Show every comment across the project's files in one table.</li>
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
