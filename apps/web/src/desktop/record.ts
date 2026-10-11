/** A disk file remembered by token. The path itself stays in the main process. */
export interface TokenRecord {
  v: 1;
  token: string;
  name: string;
}

export function isTokenRecord(value: unknown): value is TokenRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as TokenRecord;
  return record.v === 1 && typeof record.token === 'string' && record.token.length > 0 && typeof record.name === 'string';
}
