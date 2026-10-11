import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { installDesktopBridge } from './desktop/bridge';
import { desktop } from './desktop/host';
import { installLogCapture } from './help/logs';
import { googleUser, signOutOfGoogle } from './studio/drive/google';
import { startIdleSignOut } from './studio/drive/idle';
import { microsoftUser, signOutOfMicrosoft, staySignedInToMicrosoft } from './studio/drive/onedrive';
import { captureInstallPrompt } from './offline/install';
import { addDomBusyChecks, busyReasons, setUpdateGate, UpdateGate } from './offline/updates';
import { startProfileBackup } from './workspace/profileBackup';
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
// The install prompt fires once, early; Help › Install App shows it later.
captureInstallPrompt();

// A new version waits until nothing is in progress, then reloads the page (the service worker)
// or restarts the desktop app. The app shows why it is waiting (Help › Check for Updates).
addDomBusyChecks();
const host = desktop();
let updateSW = (_reload?: boolean) => {};
const gate = new UpdateGate({
  busy: busyReasons,
  apply: () => {
    if (host) void host.installUpdate();
    else updateSW(true);
  },
  onWaiting: (reasons) => window.dispatchEvent(new CustomEvent('nb-update-ready', { detail: reasons })),
});
setUpdateGate(gate);
if (host) host.onUpdateReady(() => gate.ready());
else updateSW = registerSW({ immediate: true, onNeedRefresh: () => gate.ready() });
// Check again whenever work finishes: a gesture ends, a dialog closes, the tab is left.
for (const type of ['pointerup', 'keyup', 'visibilitychange'] as const) window.addEventListener(type, () => setTimeout(() => gate.poke(), 300), true);
setInterval(() => gate.poke(), 15_000);
// Ask the browser not to evict our offline storage under pressure (Preferences › Offline shows it).
void navigator.storage?.persist?.();
// Keep profiles copied to Google Drive or OneDrive once the person has turned that on (File › Profiles).
startProfileBackup();
// After 30 minutes with no cloud work, forget the sign-in tokens in this tab (docs/SECURITY-HARDENING.md, 3.2).
// The desktop app keeps its sign-ins in the main process instead; "Stay signed in" keeps Microsoft's.
if (!host)
  startIdleSignOut(async () => {
    if (googleUser()) signOutOfGoogle();
    if (microsoftUser() && !staySignedInToMicrosoft()) await signOutOfMicrosoft();
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
