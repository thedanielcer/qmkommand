import { KeyName } from '../types';

export const REPORT_LENGTH = 32;
export const SIGNATURE = [0x51, 0x4d, 0x4b, 0x56, 0x53, 0x43] as const;
export type DecodeResult =
  | { ok: true; event: { actionId: number; key: KeyName } }
  | { ok: false; reason: 'length' | 'signature' | 'version' | 'type' | 'actionId' | 'reserved' };

/** Offsets refer directly to node-hid's input Buffer. No report-ID normalization. */
export function decodeReport(payload: Uint8Array): DecodeResult {
  if (payload.length !== REPORT_LENGTH) { return { ok: false, reason: 'length' }; }
  if (!SIGNATURE.every((byte, i) => payload[i] === byte)) { return { ok: false, reason: 'signature' }; }
  if (payload[6] !== 1) { return { ok: false, reason: 'version' }; }
  if (payload[7] !== 1) { return { ok: false, reason: 'type' }; }
  const actionId = payload[8];
  if (actionId > 31) { return { ok: false, reason: 'actionId' }; }
  if (payload.subarray(9).some(byte => byte !== 0)) { return { ok: false, reason: 'reserved' }; }
  return { ok: true, event: { actionId, key: `VSC_${actionId + 1}` as KeyName } };
}
