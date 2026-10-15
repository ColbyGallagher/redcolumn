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

// Windows: the window has no native title bar (see createWindow in main.ts), so the page lays its
// menu bar out in that strip. Runs before the page's scripts, and again on every reload.
if (process.platform === 'win32') window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('titlebar-overlay'));

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
  checkForUpdates: () => call('update:check'),
  microsoftToken: (clientId: string, tenant: string, scopes: string[], interactive: boolean) => call('auth:microsoft', clientId, tenant, scopes, interactive),
  graphRequest: (clientId: string, tenant: string, request: unknown) => call('graph:request', clientId, tenant, request),
  localDataKey: async () => new Uint8Array(await call<Uint8Array>('local:key')),
  folder: {
    pick: (purpose: 'create' | 'open') => call('folder:pick', purpose),
    list: (id: string) => call('folder:list', id),
    download: async (id: string) => new Uint8Array(await call<Uint8Array>('folder:download', id)),
    createFolder: (parent: string, name: string) => call('folder:create-folder', parent, name),
    createFile: (folder: string, name: string, body: Uint8Array, props: Record<string, string>) => call('folder:create-file', folder, name, body, props),
    updateContent: (id: string, body: Uint8Array) => call('folder:update', id, body),
    updateProperties: (id: string, props: Record<string, string>) => call('folder:props', id, props),
    remove: (id: string) => call('folder:remove', id),
    ownedByMe: (id: string) => call('folder:owned', id),
    show: (id: string) => call('folder:show', id),
  },
  microsoftAccount: (clientId: string) => call('auth:microsoft-account', clientId),
  signOut: (provider: 'microsoft') => call('auth:sign-out', provider),
  assistantInfo: () => call('assistant:get'),
  setAssistantEnabled: (on: boolean) => call('assistant:set', on),
  onAssistantCall(cb: (call: { id: string; method: string; params: unknown }) => void) {
    const listener = (_event: unknown, call: { id: string; method: string; params: unknown }) => cb(call);
    ipcRenderer.on('assistant:call', listener);
    return () => unsubscribe('assistant:call', listener as (...args: unknown[]) => void);
  },
  replyAssistant: (id: string, body: { result?: unknown; error?: string }) => ipcRenderer.send('assistant:result', { id, ...body }),
  setUnsavedChanges: (on: boolean) => ipcRenderer.send('window:unsaved', on === true),
  onCloseRequest(cb: () => void) {
    const listener = () => cb();
    ipcRenderer.on('window:close-request', listener);
    return () => unsubscribe('window:close-request', listener);
  },
  closeWindow: () => ipcRenderer.send('window:close'),
});
