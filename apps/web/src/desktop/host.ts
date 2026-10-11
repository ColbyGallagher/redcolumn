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

/** Who signed in to Microsoft; the token stays in the main process. */
export interface DesktopAccount {
  expiresAt: number;
  email: string;
  name: string;
}

/** A Microsoft Graph call made by the main process, which attaches the token (apps/desktop/src/graph.ts). */
export interface GraphRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  level: number;
}

export interface GraphReply {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
  authNeeded?: boolean;
}

export interface DesktopFolderFile {
  id: string;
  name: string;
  mimeType: string;
  version: string;
  size: number;
  createdTime: string;
  properties: Record<string, string>;
}

export interface DesktopFolders {
  pick(purpose: 'create' | 'open'): Promise<{ id: string; name: string } | null>;
  list(id: string): Promise<DesktopFolderFile[]>;
  download(id: string): Promise<Uint8Array>;
  createFolder(parent: string, name: string): Promise<string>;
  createFile(folder: string, name: string, body: Uint8Array, props: Record<string, string>): Promise<DesktopFolderFile>;
  updateContent(id: string, body: Uint8Array): Promise<string>;
  updateProperties(id: string, props: Record<string, string>): Promise<string>;
  remove(id: string): Promise<void>;
  ownedByMe(id: string): Promise<boolean>;
  show(id: string): Promise<void>;
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
  /** Signs in, or checks the sign-in covers these scopes; null when a sign-in window is needed and `interactive` is false. */
  microsoftToken(clientId: string, tenant: string, scopes: string[], interactive: boolean): Promise<DesktopAccount | null>;
  graphRequest(clientId: string, tenant: string, request: GraphRequest): Promise<GraphReply>;
  /** Projects on a folder this computer syncs; IDs only, never paths (apps/desktop/src/folderDrive.ts). */
  folder: DesktopFolders;
  /** The key for "Encrypt local data": made once, kept encrypted by the system key store. Absent where there is none. */
  localDataKey?: () => Promise<Uint8Array>;
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
