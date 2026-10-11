/** The preload bridge. Present only inside the Electron app. */

export interface DesktopToken {
  token: string;
  name: string;
}

export interface DesktopAuth {
  accessToken: string;
  expiresAt: number;
  email: string;
  name: string;
}

export type PrintMode = 'viewer' | 'verb' | 'images';
/** The answer to Help › Check for Updates: the newest GitHub release against this app's version. */
export type UpdateCheck =
  | { status: 'latest'; current: string }
  | { status: 'available'; current: string; latest: string; url: string }
  | { status: 'unavailable'; current: string };

export interface RedcolumnDesktop {
  isDesktop: true;
  /** Open and Save As use native dialogs so the main process can remember the path. */
  nativeFiles: boolean;
  printMode: PrintMode;
  tokenForFile(file: File): Promise<string | null>;
  pickOpen(): Promise<DesktopToken[] | null>;
  pickSave(suggestedName: string): Promise<DesktopToken | null>;
  readToken(token: string): Promise<Uint8Array>;
  writeToken(token: string, data: Uint8Array): Promise<boolean>;
  showInFolder(token: string): Promise<boolean>;
  /** Drops a remembered path, for a document removed from this device. */
  forgetToken(token: string): Promise<boolean>;
  takeLaunchFiles(): Promise<DesktopToken[]>;
  onLaunchFiles(cb: (files: DesktopToken[]) => void): () => void;
  printPdf(bytes: Uint8Array): Promise<void>;
  /** Pages drawn to images are sent one at a time; the main process builds and prints the document. */
  beginPrint(): Promise<string>;
  addPrintPage(job: string, bytes: Uint8Array, type: string, width: number, height: number): Promise<void>;
  finishPrint(job: string): Promise<void>;
  cancelPrint(job: string): Promise<void>;
  checkForUpdates(): Promise<UpdateCheck>;
  /** null when `interactive` is false and the person has to sign in. */
  googleToken(clientId: string, clientSecret: string, interactive: boolean): Promise<DesktopAuth | null>;
  microsoftToken(clientId: string, tenant: string, scopes: string[], interactive: boolean): Promise<DesktopAuth | null>;
  microsoftAccount(clientId: string): Promise<{ email: string; name: string } | null>;
  signOut(provider: 'google' | 'microsoft'): Promise<void>;
  /** Whether the local assistant is listening, and the command an AI client should run. */
  assistantInfo(): Promise<AssistantInfo>;
  setAssistantEnabled(on: boolean): Promise<AssistantInfo>;
  onAssistantCall(cb: (call: AssistantCall) => void): () => void;
  replyAssistant(id: string, body: { result?: unknown; error?: string }): void;
}

export interface AssistantInfo {
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AssistantCall {
  id: string;
  method: string;
  params: unknown;
}

declare global {
  interface Window {
    redcolumn?: RedcolumnDesktop;
  }
}

export const desktop = (): RedcolumnDesktop | null => (typeof window === 'undefined' ? null : window.redcolumn ?? null);
