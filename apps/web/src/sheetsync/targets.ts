import { OneDrive } from '../studio/drive/onedrive';
import type { TableCell } from './table';
import { buildXlsx } from './xlsx';

export type SheetProvider = 'onedrive';

/** Where a document's markups are kept in sync. Saved per document so it carries on after a reload. */
export interface SyncLink {
  provider: SheetProvider;
  /** The workbook's file name in Apps/redcolumn. */
  id: string;
  /** Opens it in the browser. */
  url: string;
  title: string;
}

/** Writes the whole table to the spreadsheet, replacing what was there. */
export interface SyncTarget {
  push(table: readonly (readonly TableCell[])[]): Promise<void>;
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
  return new OneDriveWorkbookTarget(link.id);
}
