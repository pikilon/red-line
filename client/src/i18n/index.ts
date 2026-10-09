import type en from "./en.json";

export type MessageKey = keyof typeof en;

export function t(
  key: MessageKey,
  _params?: Readonly<Record<string, string | number>>,
): string {
  return String(key);
}
