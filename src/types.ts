type KeyNumber = 1 |  2 |  3 |  4 |  5 |  6 |  7 |  8 |  9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
                17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32;

export type KeyName = `VSC_${KeyNumber}`;

export const KEY_NAMES = Array.from({ length: 32 }, (_, i) => `VSC_${i + 1}` as KeyName);

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Binding {
  readonly key: KeyName;
  readonly command: string;
  readonly args?: JsonValue;
}

export interface DeviceSettings {
  vendorId: number | null;
  productId: number | null;
  productName: string;
  usagePage: number;
  usage: number;
  path: string;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  trace(message: string): void;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
