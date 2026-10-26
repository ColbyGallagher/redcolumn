import { desktop } from '../desktop/host';
import { tokenChain, unlockId, type DigitalIdRecord, type UnlockedId } from './digitalIds';
import type { Signer } from './pdfSign';

/**
 * What signs for a Digital ID: a .p12 ID unlocked with its password, or the card an ID lives on,
 * which signs with its PIN (null on a reader with its own keypad). The PIN goes to the card for
 * each signature and is never kept (unlike a .p12 password, see idPasswords.ts).
 */
export function signerFor(record: DigitalIdRecord, secret: string | null): UnlockedId | Signer {
  if (!record.token) return unlockId(record, secret ?? '');
  const tokens = desktop()?.tokens;
  if (!tokens) throw new Error('This Digital ID is on a smart card or USB token, which only the desktop app can use');
  const { ref, pinPad } = record.token;
  const pin = pinPad ? null : secret;
  if (pin === null && !pinPad) throw new Error('Enter the card’s PIN');
  // Cards lock after a few wrong PINs (three on most): once the card refuses this PIN, the rest of
  // a Bulk Sign fails here without trying it again.
  let refused: Error | null = null;
  return {
    chainDer: tokenChain(record),
    sign: async (data, hash) => {
      if (hash === 'SHA-1') throw new Error('Cards sign with SHA-256 or stronger');
      if (refused) throw refused;
      try {
        return await tokens.sign(ref, hash, data, pin);
      } catch (err) {
        if (err instanceof Error && /\bPIN\b/.test(err.message)) refused = err;
        throw err;
      }
    },
  };
}

/** The ID is on a card. */
export const onCard = (record: DigitalIdRecord | undefined) => !!record?.token;
