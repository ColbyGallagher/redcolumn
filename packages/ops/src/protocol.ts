/**
 * The sync protocol's version: the format of operations, records and messages. Raise it when a
 * change means an older peer could misread something; raise `MIN_PROTOCOL_VERSION` when this code
 * stops reading an older version.
 */
export const PROTOCOL_VERSION = 1;
/** The oldest version this code still reads and writes. */
export const MIN_PROTOCOL_VERSION = 1;

/** The versions one side can speak, both ends included. */
export interface ProtocolRange {
  min: number;
  max: number;
}

export const SUPPORTED_PROTOCOL: ProtocolRange = { min: MIN_PROTOCOL_VERSION, max: PROTOCOL_VERSION };

/**
 * The result of agreeing a version. `client_too_old`: the client must be updated before it sends
 * anything (it keeps its queue meanwhile). `client_too_new`: the server must be updated.
 * `invalid`: the offer was not a range of positive whole numbers.
 */
export type Negotiation =
  | { ok: true; version: number }
  | { ok: false; reason: 'client_too_old' | 'client_too_new' | 'invalid'; server: ProtocolRange };

const isRange = (r: ProtocolRange): boolean =>
  typeof r === 'object' && r !== null && Number.isSafeInteger(r.min) && Number.isSafeInteger(r.max) && r.min >= 1 && r.min <= r.max;

/** Picks the highest version both sides speak; the server calls this with the client's offer. */
export function negotiateProtocol(client: ProtocolRange, server: ProtocolRange = SUPPORTED_PROTOCOL): Negotiation {
  if (!isRange(server)) throw new RangeError('The server protocol range is invalid');
  if (!isRange(client)) return { ok: false, reason: 'invalid', server };
  if (client.max < server.min) return { ok: false, reason: 'client_too_old', server };
  if (client.min > server.max) return { ok: false, reason: 'client_too_new', server };
  return { ok: true, version: Math.min(client.max, server.max) };
}

/** Whether an operation written for `version` can be read here. */
export const readsVersion = (version: number, range: ProtocolRange = SUPPORTED_PROTOCOL): boolean =>
  Number.isSafeInteger(version) && version >= range.min && version <= range.max;
