import { desktop, type DesktopExcel } from '../desktop/host';
import type { TableCell } from './table';
import { buildWorkbook, uniqueNames, type SheetSpec } from './xlsx';

/** `excel-local`: a workbook on this computer, through the Windows desktop app (the only kind there is). */
export type SheetProvider = 'excel-local';

/** Where a document's markups are kept in sync. Saved per document so it carries on after a reload. */
export interface SyncLink {
  provider: SheetProvider;
  /** The desktop app's ID for the workbook. */
  id: string;
  /** Always empty: kept so links saved by older builds still read. */
  url: string;
  title: string;
  /** Also keep the quantities in a second sheet of the workbook. */
  quantities?: boolean;
}

/** A failure that trying again will not fix: sync shows it and stops retrying until the next change or click. */
export class SyncStoppedError extends Error {}

/** Writes the whole table to the spreadsheet, replacing what was there, and any further sheets beside it. */
export interface SyncTarget {
  push(table: readonly (readonly TableCell[])[], extras?: readonly SheetSpec[]): Promise<void>;
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

  async push(table: readonly (readonly TableCell[])[], extras: readonly SheetSpec[] = []): Promise<void> {
    try {
      const names = uniqueNames([this.sheet, ...extras.map((e) => e.name)]);
      const xlsx = buildWorkbook([{ name: this.sheet, table }, ...extras]);
      const copy = (t: readonly (readonly TableCell[])[]) => t.map((row) => [...row]);
      await this.excel.write(this.id, xlsx, copy(table), extras.length ? extras.map((e, i) => ({ name: names[i + 1]!, table: copy(e.table) })) : undefined);
    } catch (err) {
      // The desktop app forgot this workbook (its settings were reset): only choosing it again helps.
      if (err instanceof Error && /no longer linked/i.test(err.message)) throw new SyncStoppedError(err.message);
      throw err;
    }
  }

  /** Asks where the workbook goes, then writes it; null when the person cancels. */
  static async create(title: string, table: readonly (readonly TableCell[])[], excel: DesktopExcel, extras: readonly SheetSpec[] = [], quantities = false): Promise<{ target: LocalExcelTarget; link: SyncLink } | null> {
    const picked = await excel.pick(title);
    if (!picked) return null;
    const target = new LocalExcelTarget(picked.id, excel);
    await target.push(table, extras);
    return { target, link: { provider: 'excel-local', id: picked.id, url: '', title: picked.name, ...(quantities ? { quantities: true } : {}) } };
  }
}

/** Sync to Excel on this computer: only the Windows desktop app has it. */
export const localExcel = (): DesktopExcel | null => desktop()?.excel ?? null;

/** The target a saved link points at. */
export function targetFor(link: SyncLink): SyncTarget {
  const excel = localExcel();
  if (!excel) throw new SyncStoppedError('This workbook is on a Windows computer: open this document in the redcolumn desktop app there to keep syncing it.');
  return new LocalExcelTarget(link.id, excel);
}
