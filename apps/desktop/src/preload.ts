import { contextBridge, ipcRenderer, webUtils } from 'electron';

const info = ipcRenderer.sendSync('desktop:info') as { nativeFiles: boolean; printMode: 'viewer' | 'verb' | 'images' };

function unsubscribe(channel: string, listener: (...args: unknown[]) => void) {
  ipcRenderer.removeListener(channel, listener);
  return;
}

/** invoke, with Electron's "Error invoking remote method 'x': Error: " prefix taken off the message. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
  }
}

contextBridge.exposeInMainWorld('redcolumn', {
  isDesktop: true,
  nativeFiles: info.nativeFiles,
  printMode: info.printMode,
  tokenForFile(file: File) {
    try {
      const filePath = webUtils.getPathForFile(file);
      if (!filePath) return Promise.resolve(null);
      return call<string | null>('paths:register-dropped', filePath);
    } catch {
      return Promise.resolve(null);
    }
  },
  pickOpen: () => call('paths:pick-open'),
  pickSave: (suggestedName: string) => call('paths:pick-save', suggestedName),
  readToken: async (token: string) => new Uint8Array(await call<Uint8Array>('paths:read', token)),
  writeToken: (token: string, data: Uint8Array) => call('paths:write', token, data),
  showInFolder: (token: string) => call('paths:show', token),
  forgetToken: (token: string) => call('paths:forget', token),
  takeLaunchFiles: () => call('launch:take'),
  onLaunchFiles(cb: (files: { token: string; name: string }[]) => void) {
    const listener = (_event: unknown, files: { token: string; name: string }[]) => cb(files);
    ipcRenderer.on('launch-files', listener);
    return () => unsubscribe('launch-files', listener as (...args: unknown[]) => void);
  },
  printPdf: (bytes: Uint8Array) => call('print:pdf', bytes),
  beginPrint: () => call('print:begin'),
  addPrintPage: (job: string, bytes: Uint8Array, type: string, width: number, height: number) => call('print:page', job, bytes, type, width, height),
  finishPrint: (job: string) => call('print:finish', job),
  cancelPrint: (job: string) => call('print:cancel', job),
  onUpdateReady(cb: () => void) {
    const listener = () => cb();
    ipcRenderer.on('update-ready', listener);
    return () => unsubscribe('update-ready', listener as (...args: unknown[]) => void);
  },
  installUpdate: () => call('update:install'),
  checkForUpdates: () => call('update:check'),
  googleToken: (clientId: string, clientSecret: string, interactive: boolean) => call('auth:google', clientId, clientSecret, interactive),
  microsoftToken: (clientId: string, tenant: string, scopes: string[], interactive: boolean) => call('auth:microsoft', clientId, tenant, scopes, interactive),
  microsoftAccount: (clientId: string) => call('auth:microsoft-account', clientId),
  signOut: (provider: 'google' | 'microsoft') => call('auth:sign-out', provider),
});
