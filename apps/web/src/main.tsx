import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { installDesktopBridge } from './desktop/bridge';
import { desktop } from './desktop/host';
import { installLogCapture } from './help/logs';
import { installLocalEncryption } from './storage/localCrypto';
import { rewriteLibrary } from './storage/fileStore';
import { startIdleSignOut } from './studio/drive/idle';
import { microsoftUser, signOutOfMicrosoft, staySignedInToMicrosoft } from './studio/drive/onedrive';
import { addDomBusyChecks, busyReasons, setUpdateGate, UpdateGate } from './offline/updates';
import { startProfileBackup } from './workspace/profileBackup';
import { installDialogDrag } from './dialogDrag';
import { installDialogFocus } from './dialogFocus';
import { App } from './App';
import './styles.css';
import './features.css';
import './offline.css';

// Another site framing the app could trick clicks (GitHub Pages cannot send frame-ancestors).
if (window.top !== window.self) {
  document.body.textContent = 'redcolumn cannot run inside another page. Open it in its own tab.';
  throw new Error('redcolumn refused to run in a frame.');
}

installLogCapture();
installDesktopBridge();
installDialogDrag();
installDialogFocus();

// A new version waits until nothing is in progress, then reloads the page (the service worker).
// The app shows why it is waiting (Help › Check for Updates). The desktop app has no service
// worker: it is updated by installing a newer release.
addDomBusyChecks();
const host = desktop();
let updateSW = (_reload?: boolean) => {};
const gate = new UpdateGate({
  busy: busyReasons,
  apply: () => updateSW(true),
  onWaiting: (reasons) => window.dispatchEvent(new CustomEvent('nb-update-ready', { detail: reasons })),
});
setUpdateGate(gate);
if (!host) updateSW = registerSW({ immediate: true, onNeedRefresh: () => gate.ready() });
// Check again whenever work finishes: a gesture ends, a dialog closes, the tab is left.
for (const type of ['pointerup', 'keyup', 'visibilitychange'] as const) window.addEventListener(type, () => setTimeout(() => gate.poke(), 300), true);
setInterval(() => gate.poke(), 15_000);
// Ask the browser not to evict our offline storage under pressure (Preferences › Offline shows it).
void navigator.storage?.persist?.();
// Keep profiles copied to OneDrive once the person has turned that on (File › Profiles).
startProfileBackup();
// After 30 minutes with no cloud work, forget the sign-in tokens in this tab (docs/SECURITY-HARDENING.md, 3.2).
// The desktop app keeps its sign-ins in the main process instead; "Stay signed in" keeps Microsoft's.
if (!host)
  startIdleSignOut(async () => {
    if (microsoftUser() && !staySignedInToMicrosoft()) await signOutOfMicrosoft();
  });

// Before anything opens a document: local data is sealed on this device when "Encrypt local data" is on.
void installLocalEncryption(rewriteLibrary).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
