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

export type PrintMode = 'viewer' | 'verb' | 'images';
export type UpdateStatus = 'latest' | 'downloading' | 'ready' | 'unavailable';

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
  onUpdateReady(cb: () => void): () => void;
  installUpdate(): Promise<void>;
  checkForUpdates(): Promise<UpdateStatus>;
  /** null when `interactive` is false and the person has to sign in. */
  googleToken(clientId: string, clientSecret: string, interactive: boolean): Promise<DesktopAuth | null>;
  /** Signs in, or checks the sign-in covers these scopes; null when a sign-in window is needed and `interactive` is false. */
  microsoftToken(clientId: string, tenant: string, scopes: string[], interactive: boolean): Promise<DesktopAccount | null>;
  graphRequest(clientId: string, tenant: string, request: GraphRequest): Promise<GraphReply>;
  microsoftAccount(clientId: string): Promise<{ email: string; name: string } | null>;
  signOut(provider: 'google' | 'microsoft'): Promise<void>;
}

declare global {
  interface Window {
    redcolumn?: RedcolumnDesktop;
  }
}

export const desktop = (): RedcolumnDesktop | null => (typeof window === 'undefined' ? null : window.redcolumn ?? null);
