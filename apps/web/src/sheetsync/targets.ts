import { DriveAuthError, DriveForbiddenError } from '../studio/drive/DriveApi';
import { googleAuth } from '../studio/drive/google';
import { OneDrive } from '../studio/drive/onedrive';
import type { TableCell } from './table';
import { buildXlsx, columnName } from './xlsx';

export type SheetProvider = 'google' | 'onedrive';

/** Where a document's markups are kept in sync. Saved per document so it carries on after a reload. */
export interface SyncLink {
  provider: SheetProvider;
  /** Google: the spreadsheet's ID. OneDrive: the workbook's file name in Apps/redcolumn. */
  id: string;
  /** Opens it in the browser. */
  url: string;
  title: string;
}

/** Writes the whole table to the spreadsheet, replacing what was there. */
export interface SyncTarget {
  push(table: readonly (readonly TableCell[])[]): Promise<void>;
}

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB = 'Markups';

type Fetch = typeof fetch;

/** A Google Sheets error as a typed error, so the panel can say what to do. */
async function sheetsFailure(res: Response, what: string): Promise<Error> {
  if (res.status === 401) return new DriveAuthError('Google sign-in has expired.');
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    // No body.
  }
  if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(detail)) {
    return new Error('Turn on the Google Sheets API for this app (see docs/CLOUD-SETUP.md).');
  }
  if (res.status === 403 || res.status === 404) return new DriveForbiddenError(`Could not ${what}: the spreadsheet was deleted or is no longer shared with you.`);
  return new Error(`Could not ${what} (${res.status}${detail ? `: ${detail}` : ''}).`);
}

/**
 * A Google Sheets spreadsheet the app created, written through the Sheets API. Cells change in
 * place, so anyone with it open sees each update as it lands. The `drive.file` scope covers it:
 * the app can reach only spreadsheets it created.
 */
export class GoogleSheetTarget implements SyncTarget {
  private id: string;
  private token: () => Promise<string>;
  private fetchFn: Fetch;

  constructor(id: string, token: () => Promise<string> = () => googleAuth.get(), fetchFn: Fetch = (...a) => fetch(...a)) {
    this.id = id;
    this.token = token;
    this.fetchFn = fetchFn;
  }

  private async call(url: string, init: RequestInit, what: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await this.token()}`);
    if (init.body) headers.set('content-type', 'application/json');
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, headers });
    } catch {
      throw new TypeError(`Offline: could not ${what}.`);
    }
    if (!res.ok) throw await sheetsFailure(res, what);
    return res;
  }

  /** Creates the spreadsheet, with a bold frozen header row and a filter. */
  static async create(title: string, table: readonly (readonly TableCell[])[], token?: () => Promise<string>, fetchFn?: Fetch): Promise<{ target: GoogleSheetTarget; link: SyncLink }> {
    const probe = new GoogleSheetTarget('', token, fetchFn);
    const made = (await (
      await probe.call(SHEETS, { method: 'POST', body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } }] }) }, 'create the spreadsheet')
    ).json()) as { spreadsheetId: string; spreadsheetUrl: string; sheets: { properties: { sheetId: number } }[] };
    const target = new GoogleSheetTarget(made.spreadsheetId, token, fetchFn);
    const sheetId = made.sheets[0]?.properties.sheetId ?? 0;
    await target.call(
      `${SHEETS}/${made.spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
            { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0 } } } },
          ],
        }),
      },
      'format the spreadsheet',
    );
    await target.push(table);
    return { target, link: { provider: 'google', id: made.spreadsheetId, url: made.spreadsheetUrl, title } };
  }

  async push(table: readonly (readonly TableCell[])[]): Promise<void> {
    const base = `${SHEETS}/${this.id}/values`;
    const range = encodeURIComponent(`${TAB}!A1`);
    // Clear first, so rows that were deleted from the list do not linger below the new ones.
    await this.call(`${base}/${encodeURIComponent(TAB)}:clear`, { method: 'POST', body: '{}' }, 'update the spreadsheet');
    const width = Math.max(1, ...table.map((r) => r.length));
    await this.call(
      `${base}/${range}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ range: `${TAB}!A1:${columnName(width - 1)}${table.length}`, majorDimension: 'ROWS', values: table }) },
      'update the spreadsheet',
    );
  }
}

/** The Excel file kept in the person's OneDrive, in Apps/redcolumn. */
export class OneDriveWorkbookTarget implements SyncTarget {
  private name: string;
  private drive: Pick<OneDrive, 'writeAppBinary'>;
  private sheet: string;

  constructor(name: string, drive: Pick<OneDrive, 'writeAppBinary'> = new OneDrive(), sheet = 'Markups') {
    this.name = name;
    this.drive = drive;
    this.sheet = sheet;
  }

  /** Writes the workbook, which creates it the first time. */
  async write(table: readonly (readonly TableCell[])[]): Promise<{ id: string; url: string }> {
    const bytes = buildXlsx(table, this.sheet);
    return this.drive.writeAppBinary(this.name, new Blob([bytes as BlobPart]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  async push(table: readonly (readonly TableCell[])[]): Promise<void> {
    await this.write(table);
  }

  static async create(title: string, table: readonly (readonly TableCell[])[], drive?: Pick<OneDrive, 'writeAppBinary'>): Promise<{ target: OneDriveWorkbookTarget; link: SyncLink }> {
    const name = `${title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Markups'}.xlsx`;
    const target = new OneDriveWorkbookTarget(name, drive);
    const { url } = await target.write(table);
    return { target, link: { provider: 'onedrive', id: name, url, title } };
  }
}

/** The target a saved link points at. */
export function targetFor(link: SyncLink): SyncTarget {
  return link.provider === 'google' ? new GoogleSheetTarget(link.id) : new OneDriveWorkbookTarget(link.id);
}
