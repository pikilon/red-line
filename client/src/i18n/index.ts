import en from "./en.json";

export type MessageKey = keyof typeof en;

/** Replaces each {name} with String(params[name]); unknown placeholders stay verbatim. */
export function t(
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  return en[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params?.[name];
    return value === undefined ? placeholder : String(value);
  });
}
