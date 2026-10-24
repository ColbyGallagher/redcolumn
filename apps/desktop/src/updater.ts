import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UpdateService, canSelfUpdate, updateChannel, type NativeUpdater } from './update-service';

/** The repository whose releases carry the installer. */
const RELEASES_API = 'https://api.github.com/repos/ColbyGallagher/redcolumn/releases/latest';
const RELEASE_PAGE_PREFIX = 'https://github.com/ColbyGallagher/redcolumn/releases/';

/**
 * Asks GitHub for the newest published release. Releases marked draft or pre-release are not
 * returned by this endpoint.
 */
async function fetchLatest(): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `redcolumn/${app.getVersion()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const release = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
    const url = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASE_PAGE_PREFIX) ? release.html_url : null;
    return tag && url ? { tag, url } : null;
  } catch {
    return null;
  }
}

/**
 * The installed Windows app updates itself: electron-updater reads latest.yml from the newest
 * GitHub release, downloads the installer in the background, checks its SHA-512 against that file
 * and runs it when the app quits (or when the person restarts into it). Anywhere else (the Mac
 * app, which is not signed with a Developer ID, and a build run from source) the person is told
 * and opens the release page.
 *
 * Windows on Arm updates itself from latest-arm64.yml instead (see updateChannel). The NSIS
 * updater does not look at the architecture, so it must never read latest.yml: that describes the
 * x64 installer and would replace the native arm64 install with the x64 build.
 */
function nativeUpdater(): NativeUpdater | null {
  if (!canSelfUpdate({ packaged: app.isPackaged, platform: process.platform, arch: process.arch })) return null;
  const channel = updateChannel(process.arch);
  if (channel) autoUpdater.channel = channel;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Keep this false: with it on, a release that lacks latest-arm64.yml makes electron-updater fall
  // back to latest.yml, which is the x64 installer. Off, the check fails and nothing is replaced.
  autoUpdater.allowPrerelease = false;
  // Setting a channel turns this on, so it is set after.
  autoUpdater.allowDowngrade = false;
  return autoUpdater;
}

export function createUpdater(hasUnsavedChanges: () => boolean): UpdateService {
  return new UpdateService({ current: app.getVersion(), native: nativeUpdater(), fetchLatest, hasUnsavedChanges });
}
