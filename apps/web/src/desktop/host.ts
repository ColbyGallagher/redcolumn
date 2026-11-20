/** The preload bridge. Present only inside the Electron app. */

export interface DesktopToken {
  /** Empty for a document moved from another window that has no file on disk. */
  token: string;
  name: string;
  /** A document moved from another window: collect its contents with `takeTransfer`. */
  transfer?: string;
  /** The moved document has changes not yet saved to its file. */
  dirty?: boolean;
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
  pick(purpose: 'create' | 'open' | 'session-create' | 'session-open'): Promise<{ id: string; name: string } | null>;
  list(id: string): Promise<DesktopFolderFile[]>;
  download(id: string): Promise<Uint8Array>;
  createFolder(parent: string, name: string): Promise<string>;
  createFile(folder: string, name: string, body: Uint8Array, props: Record<string, string>): Promise<DesktopFolderFile>;
  updateContent(id: string, body: Uint8Array): Promise<string>;
  updateProperties(id: string, props: Record<string, string>): Promise<string>;
  remove(id: string): Promise<void>;
  ownedByMe(id: string): Promise<boolean>;
  show(id: string): Promise<void>;
  /** Moves a Live Session folder this install made to the recycle bin (the host ended it). */
  removeSession(id: string): Promise<void>;
}

export type PrintMode = 'viewer' | 'verb' | 'images';
/**
 * Where the desktop app stands on updates (apps/desktop/src/update-service.ts). It checks the
 * newest GitHub release at every launch. `available` is a newer version the app cannot install by
 * itself (open `url`); `downloading` and `ready` are the in-app update, installed at the next quit
 * or by `installUpdate`.
 */
export interface UpdateState {
  status: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'unavailable';
  current: string;
  latest?: string;
  url?: string;
  percent?: number;
}

export interface RedcolumnDesktop {
  isDesktop: true;
  /** Open and Save As use native dialogs so the main process can remember the path. */
  nativeFiles: boolean;
  printMode: PrintMode;
  /** The organisation's policy, read by the main process at startup (read it through desktop/policy.ts). Absent in desktop apps from before managed policy. */
  policy?: unknown;
  tokenForFile(file: File): Promise<string | null>;
  /** `kind` narrows the dialog to pictures or opens it to any file; the default is PDFs and pictures. */
  pickOpen(kind?: 'document' | 'image' | 'any'): Promise<DesktopToken[] | null>;
  pickSave(suggestedName: string): Promise<DesktopToken | null>;
  readToken(token: string): Promise<Uint8Array>;
  writeToken(token: string, data: Uint8Array): Promise<boolean>;
  showInFolder(token: string): Promise<boolean>;
  /** Drops a remembered path, for a document removed from this device. */
  forgetToken(token: string): Promise<boolean>;
  takeLaunchFiles(): Promise<DesktopToken[]>;
  onLaunchFiles(cb: (files: DesktopToken[]) => void): () => void;
  /** Links to a comment the app was started with or handed while running (redcolumn://markup?…). Absent in desktop apps from before such links. */
  takeMarkupLinks?(): Promise<{ doc: string; markup: string; name: string }[]>;
  onMarkupLinks?(cb: (links: { doc: string; markup: string; name: string }[]) => void): () => void;
  printPdf(bytes: Uint8Array): Promise<void>;
  /** Pages drawn to images are sent one at a time; the main process builds and prints the document. */
  beginPrint(): Promise<string>;
  addPrintPage(job: string, bytes: Uint8Array, type: string, width: number, height: number): Promise<void>;
  finishPrint(job: string): Promise<void>;
  cancelPrint(job: string): Promise<void>;
  /** Checks now (Help › Check for Updates) and answers once the check is done. */
  checkForUpdates(): Promise<UpdateState>;
  updateState(): Promise<UpdateState>;
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  /** Restarts into a downloaded update; refused while documents have unsaved changes. */
  installUpdate(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** null when `interactive` is false and the person has to sign in. */
  /** Signs in, or checks the sign-in covers these scopes; null when a sign-in window is needed and `interactive` is false. */
  microsoftToken(clientId: string, tenant: string, scopes: string[], interactive: boolean): Promise<DesktopAccount | null>;
  graphRequest(clientId: string, tenant: string, request: GraphRequest): Promise<GraphReply>;
  /** Projects on a folder this computer syncs; IDs only, never paths (apps/desktop/src/folderDrive.ts). */
  folder: DesktopFolders;
  /** The key for "Encrypt local data": made once, kept encrypted by the system key store. Absent where there is none. */
  localDataKey?: () => Promise<Uint8Array>;
  /** Experimental (read through desktop/embedHost.ts, only with its setting on): a document id the host assigns to a file it launched; its library entry and markups are kept under it instead of the hash of its bytes. */
  documentIdFor?(token: string): string | null;
  /** A certificate service (time stamp server, OCSP responder, revocation list) fetched by the main process (apps/desktop/src/pki.ts). */
  pkiFetch?(url: string, body?: Uint8Array, type?: string): Promise<Uint8Array>;
  /** The root CA certificates the desktop app knows (PEM, Mozilla's list as Node ships it). */
  pkiRoots?(): Promise<string[]>;
  /** Installed fonts (apps/desktop/src/fonts.ts): families with opaque ids per style, and a style's font file by id. */
  fonts?: {
    list(): Promise<{ family: string; styles: { id: string; style: string; bold: boolean; italic: boolean }[] }[]>;
    read(id: string): Promise<Uint8Array>;
  };
  /** Revu's settings folders on this computer, one per version, newest first: library files by opaque id and relative path (apps/desktop/src/revuSettings.ts). */
  revuSettings?: {
    scan(): Promise<{ version: string; files: { id: string; path: string; size: number }[] }[]>;
    read(id: string): Promise<Uint8Array>;
  };
  /** Smart cards and USB tokens through their PKCS#11 drivers (apps/desktop/src/token.ts). */
  tokens?: DesktopTokens;
  microsoftAccount(clientId: string): Promise<{ email: string; name: string } | null>;
  signOut(provider: 'microsoft'): Promise<void>;
  /** Whether the local assistant is listening, and the command an AI client should run. */
  assistantInfo(): Promise<AssistantInfo>;
  setAssistantEnabled(on: boolean): Promise<AssistantInfo>;
  onAssistantCall(cb: (call: AssistantCall) => void): () => void;
  replyAssistant(id: string, body: { result?: unknown; error?: string }): void;
  /** Tells the main process whether any open document has unsaved changes, so closing the window asks first. */
  /**
   * Opens a document in a new window, at the pointer. `contents` are its current bytes with markups,
   * for a document with changes or no file; otherwise the new window reads the file at `token`.
   */
  detachDocument?(token: string, name: string, contents: Uint8Array | null, dirty: boolean): Promise<boolean>;
  /** Collects (once) the contents of a document moved here from another window. */
  takeTransfer?(id: string): Promise<Uint8Array | null>;
  setUnsavedChanges?(on: boolean): void;
  /** Colour of the title-bar buttons' symbols (Windows), so they contrast with the active theme. */
  setTitleBarSymbols?(color: string): void;
  /** Experimental (read through desktop/embedHost.ts, only with its setting on; asked on every render, so it must be quick): refuses a command an embedding host cannot allow (one that rewrites a document its own records are linked to); null leaves the command as it was. */
  commandPolicy?(id: string): { disabledReason: string } | null;
  /** Closing the window while documents have unsaved changes: the page asks about each, then calls closeWindow. */
  onCloseRequest?(cb: () => void): () => void;
  /** Closes the window (or quits, when quitting started it) after the page dealt with unsaved changes. */
  closeWindow?(): void;
  /** Sync to Excel on this computer. Windows only: absent on a Mac (apps/desktop/src/excel.ts). */
  excel?: DesktopExcel;
}

/** A card driver: one of the common install paths found here, or a file picked in a native dialog. */
export interface TokenModule {
  id: string;
  name: string;
  added: boolean;
}

/** A certificate on an inserted card, and the key to sign with (`ref`, opaque to the page). */
export interface TokenCertificate {
  ref: string;
  label: string;
  token: string;
  module: string;
  certificate: Uint8Array;
  others: Uint8Array[];
  hasKey: boolean | null;
  pinPad: boolean;
}

export interface DesktopTokens {
  modules(): Promise<TokenModule[]>;
  /** A native dialog to pick a driver file; null when cancelled. */
  addModule(): Promise<TokenModule | null>;
  removeModule(id: string): Promise<void>;
  certificates(): Promise<{ certificates: TokenCertificate[]; problems: { module: string; problem: string }[] }>;
  /** The card signs `data` (hashed in the main process); `pin` is null on a reader with its own keypad. */
  sign(ref: string, hash: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array, pin: string | null): Promise<Uint8Array>;
}

/** Extras for a write into the open workbook (apps/desktop/src/excel.ts). */
export interface ExcelLiveOptions {
  /** The fingerprint the read gave: the write answers `changed`, and writes nothing, when the sheet no longer matches it. */
  stamp?: string;
  hideKey?: boolean;
  /** Write every text cell as text, never as the number or date Excel would read it as. */
  text?: boolean;
  validations?: { col: number; type: 'list' | 'date' | 'number'; formula?: string }[];
  /** Extra sheets to make very hidden. */
  hidden?: string[];
}

export type ExcelRead = { kind: 'none' } | { kind: 'file'; bytes: Uint8Array } | { kind: 'live'; stamp: string; sheets: { name: string; rows: (string | number | boolean | null)[][] }[] };

/**
 * A register's rows for the client's own file: where they go on its sheet and what is written with
 * them (apps/web/src/sheetsync/clientFile.ts works it out, apps/desktop/src/excel.ts has Excel write
 * it into a copy of the file). Rows and columns count from 1, as Excel does.
 */
export interface ExcelFill {
  sheet: string;
  headerRow: number;
  /** The first row under the header, and how many rows are written from it. */
  firstRow: number;
  count: number;
  /** The columns that are written, each with one cell per row. */
  columns: { col: number; cells: (string | number)[] }[];
  /** The hidden column of row keys: its heading goes on the header row. */
  key: { col: number; label: string; cells: string[] };
  /** The table's first column. */
  firstCol: number;
  /** The first row under the header that already holds something (a sign-off block); 0 when there is none. Rows are inserted so that it is moved down, never written over. */
  below: number;
  /** Details written above the table. */
  cells: { row: number; col: number; value: string }[];
  /** The very hidden sheet an import reads. */
  hidden: { name: string; table: (string | number)[][] };
  /** Dropdowns and checks for the rows, set on a column only when the client's file has none there. */
  validations: { col: number; type: 'list' | 'date' | 'number'; formula?: string }[];
  /** Columns holding dates. */
  dates: number[];
  /** A column whose cells link to their comments: one address per row, '' for none. */
  links?: { col: number; urls: string[] };
}

/** Excel workbooks on this computer, by ID; the page never sees their paths. */
export interface DesktopExcel {
  /** A Save dialog for the workbook; null when cancelled. */
  pick(suggestedName: string): Promise<{ id: string; name: string } | null>;
  /** Replaces the file, or writes the cells into it while it is open in Excel (`live`). */
  write(id: string, xlsx: Uint8Array, table: (string | number)[][], extra?: { name: string; table: (string | number)[][] }[], live?: ExcelLiveOptions): Promise<'file' | 'live' | 'changed'>;
  /**
   * What the workbook holds now, for a two-way sync: nothing yet, the saved file, or the cells of
   * the workbook open in Excel. Absent in desktop apps from before two-way sync.
   */
  read?(id: string): Promise<ExcelRead>;
  /** An Open dialog for a client's register file; null when cancelled. Absent in desktop apps from before registers could fill one. */
  pickSource?(): Promise<{ id: string; name: string; bytes: Uint8Array } | null>;
  /** The client's file as it is now. */
  readSource?(id: string): Promise<Uint8Array>;
  /** Asks where to save, copies the client's file there and has Excel fill the copy in; null when cancelled. */
  fill?(sourceId: string, suggestedName: string, fill: ExcelFill): Promise<{ id: string; name: string } | null>;
  /** Opens the workbook in Excel. */
  open(id: string): Promise<void>;
  show(id: string): Promise<void>;
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
