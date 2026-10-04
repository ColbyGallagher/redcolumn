import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { installLogCapture } from './help/logs';
import { captureInstallPrompt } from './offline/install';
import { addDomBusyChecks, busyReasons, setUpdateGate, UpdateGate } from './offline/updates';
import { startProfileBackup } from './workspace/profileBackup';
import { App } from './App';
import './styles.css';
import './features.css';
import './offline.css';

installLogCapture();
// The install prompt fires once, early; Help › Install App shows it later.
captureInstallPrompt();

// A new version waits in the service worker until nothing is in progress, then reloads the page
// (see src/offline/updates.ts). The app shows why it is waiting (Help › Check for Updates).
addDomBusyChecks();
const gate = new UpdateGate({
  busy: busyReasons,
  apply: () => void updateSW(true),
  onWaiting: (reasons) => window.dispatchEvent(new CustomEvent('nb-update-ready', { detail: reasons })),
});
setUpdateGate(gate);
const updateSW = registerSW({ immediate: true, onNeedRefresh: () => gate.ready() });
// Check again whenever work finishes: a gesture ends, a dialog closes, the tab is left.
for (const type of ['pointerup', 'keyup', 'visibilitychange'] as const) window.addEventListener(type, () => setTimeout(() => gate.poke(), 300), true);
setInterval(() => gate.poke(), 15_000);
// Ask the browser not to evict our offline storage under pressure (Preferences › Offline shows it).
void navigator.storage?.persist?.();
// Keep profiles copied to Google Drive or OneDrive once the person has turned that on (File › Profiles).
startProfileBackup();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
