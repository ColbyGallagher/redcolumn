import { desktop, type DesktopExcel } from '../desktop/host';
import { DriveAuthError, DriveLockedError } from '../studio/drive/DriveApi';
import { OneDrive } from '../studio/drive/onedrive';
import { asText, type TableCell } from './table';
import { buildXlsx, columnName } from './xlsx';

/** `excel-local`: a workbook on this computer, through the Windows desktop app. */
export type SheetProvider = 'onedrive' | 'excel-local';

/** Where a document's markups are kept in sync. Saved per document so it carries on after a reload. */
export interface SyncLink {
  provider: SheetProvider;
  /** The workbook's file name in Apps/redcolumn, or the desktop app's ID for a local workbook. */
  id: string;
  /** Opens it in the browser; empty for a local workbook. */
  url: string;
  title: string;
}

/** A failure that trying again will not fix: sync shows it and stops retrying until the next change or click. */
export class SyncStoppedError extends Error {}

/** Writes the whole table to the spreadsheet, replacing what was there. */
export interface SyncTarget {
  push(table: readonly (readonly TableCell[])[]): Promise<void>;
}

/** The Excel file kept in the person's OneDrive, in Apps/redcolumn. */
export class OneDriveWorkbookTarget implements SyncTarget {
  private name: string;
  private drive: Pick<OneDrive, 'writeAppBinary' | 'writeAppWorksheet'>;
  private sheet: string;

  constructor(name: string, drive: Pick<OneDrive, 'writeAppBinary' | 'writeAppWorksheet'> = new OneDrive(), sheet = 'Markups') {
    this.name = name;
    this.drive = drive;
    this.sheet = sheet;
  }

  /** Writes the workbook, which creates it the first time. */
  async write(table: readonly (readonly TableCell[])[]): Promise<{ id: string; url: string }> {
    const bytes = buildXlsx(table, this.sheet);
    return this.drive.writeAppBinary(this.name, new Blob([bytes as BlobPart]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /**
   * Replaces the file when it can. While the workbook is open for editing in Excel for the web,
   * OneDrive locks the file; the cells are then written through Excel instead, which keeps syncing
   * without anyone having to close it.
   */
  async push(table: readonly (readonly TableCell[])[]): Promise<void> {
    try {
      await this.write(table);
    } catch (err) {
      if (!(err instanceof DriveLockedError)) throw err;
      try {
        const cells = table.map((row) => row.map(asText));
        await this.drive.writeAppWorksheet(this.name, this.sheet, cells, (rows, cols) => `A1:${columnName(cols - 1)}${rows}`);
      } catch (inner) {
        // A lapsed sign-in needs Reconnect, not a closed workbook.
        if (inner instanceof DriveAuthError) throw inner;
        // Excel would not take the cells either: the lock is what the person needs to hear about.
        throw new DriveLockedError('The workbook is open in Excel, so it cannot be updated right now. Close it in Excel and the update is saved.');
      }
    }
  }

  static async create(title: string, table: readonly (readonly TableCell[])[], drive?: Pick<OneDrive, 'writeAppBinary' | 'writeAppWorksheet'>): Promise<{ target: OneDriveWorkbookTarget; link: SyncLink }> {
    const name = `${title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Markups'}.xlsx`;
    const target = new OneDriveWorkbookTarget(name, drive);
    const { url } = await target.write(table);
    return { target, link: { provider: 'onedrive', id: name, url, title } };
  }
}

/**
 * A workbook on this computer, written by the Windows desktop app: the file is replaced while it is
 * closed, and the cells are written into it through Excel while it is open.
 */
export class LocalExcelTarget implements SyncTarget {
  private id: string;
  private excel: DesktopExcel;
  private sheet: string;

  constructor(id: string, excel: DesktopExcel, sheet = 'Markups') {
    this.id = id;
    this.excel = excel;
    this.sheet = sheet;
  }

  async push(table: readonly (readonly TableCell[])[]): Promise<void> {
    try {
      await this.excel.write(this.id, buildXlsx(table, this.sheet), table.map((row) => [...row]));
    } catch (err) {
      // The desktop app forgot this workbook (its settings were reset): only choosing it again helps.
      if (err instanceof Error && /no longer linked/i.test(err.message)) throw new SyncStoppedError(err.message);
      throw err;
    }
  }

  /** Asks where the workbook goes, then writes it; null when the person cancels. */
  static async create(title: string, table: readonly (readonly TableCell[])[], excel: DesktopExcel): Promise<{ target: LocalExcelTarget; link: SyncLink } | null> {
    const picked = await excel.pick(title);
    if (!picked) return null;
    const target = new LocalExcelTarget(picked.id, excel);
    await target.push(table);
    return { target, link: { provider: 'excel-local', id: picked.id, url: '', title: picked.name } };
  }
}

/** Sync to Excel on this computer: only the Windows desktop app has it. */
export const localExcel = (): DesktopExcel | null => desktop()?.excel ?? null;

/** The target a saved link points at. */
export function targetFor(link: SyncLink): SyncTarget {
  if (link.provider === 'excel-local') {
    const excel = localExcel();
    if (!excel) throw new SyncStoppedError('This workbook is on a Windows computer: open this document in the redcolumn desktop app there to keep syncing it.');
    return new LocalExcelTarget(link.id, excel);
  }
  return new OneDriveWorkbookTarget(link.id);
}
