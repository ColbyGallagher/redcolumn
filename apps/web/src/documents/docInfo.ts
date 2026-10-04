import { openForEdit } from './incremental';

/** The /Info entries Document Properties lets the user edit. */
export interface EditableInfo {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

/** The file with new title, author, subject and keywords; empty values remove the entry. */
export async function setDocumentInfo(bytes: ArrayBuffer, info: EditableInfo): Promise<ArrayBuffer> {
  const { doc, save } = await openForEdit(bytes);
  doc.setTitle(info.title.trim());
  doc.setAuthor(info.author.trim());
  doc.setSubject(info.subject.trim());
  doc.setKeywords(
    info.keywords
      .split(/[,;]/)
      .map((k) => k.trim())
      .filter(Boolean),
  );
  doc.setModificationDate(new Date());
  const out = await save();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** A PDF date string (D:YYYYMMDDHHmmSS+HH'mm') as a readable local date, or '' if unset. */
export function formatPdfDate(value: string): string {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(value.trim());
  if (!m) return value;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz] = m;
  const zone = !tz || tz === 'Z' ? 'Z' : `${tz.slice(0, 3)}:${tz.replace(/'/g, '').slice(3, 5) || '00'}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
