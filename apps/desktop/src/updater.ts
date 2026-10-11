import { app } from 'electron';
import { isNewer } from './version';

/** The repository whose releases carry the installer. */
const RELEASES_API = 'https://api.github.com/repos/ColbyGallagher/redcolumn/releases/latest';
const RELEASE_PAGE_PREFIX = 'https://github.com/ColbyGallagher/redcolumn/releases/';

export type UpdateCheck =
  | { status: 'latest'; current: string }
  | { status: 'available'; current: string; latest: string; url: string }
  | { status: 'unavailable'; current: string };

/**
 * Asks GitHub for the newest published release and compares its tag with this app's version.
 * Nothing is downloaded: the person opens the release page and runs the installer. Releases
 * marked draft or pre-release are not returned by this endpoint.
 */
export async function checkForUpdates(): Promise<UpdateCheck> {
  const current = app.getVersion();
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `redcolumn/${current}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'unavailable', current };
    const release = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
    const url = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASE_PAGE_PREFIX) ? release.html_url : null;
    if (!tag || !url) return { status: 'unavailable', current };
    if (!isNewer(tag, current)) return { status: 'latest', current };
    return { status: 'available', current, latest: tag.replace(/^v/, ''), url };
  } catch {
    return { status: 'unavailable', current };
  }
}
