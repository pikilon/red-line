/** The `side` URL parameter: 0 or 1, otherwise null. */
export function sideParam(params: URLSearchParams): 0 | 1 | null {
  const value = params.get("side");
  return value === "0" ? 0 : value === "1" ? 1 : null;
}

/** Keeps `side` in the address bar so a reload of a `?load=` match restores
 *  the faction in play (#496). */
export function withSideParam(search: string, side: number): string {
  const params = new URLSearchParams(search);
  if (params.get("load") === null) return search;
  params.set("side", side === 1 ? "1" : "0");
  return `?${params.toString()}`;
}
