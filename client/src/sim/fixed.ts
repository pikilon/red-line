export const FX_ONE = 65536;

export function toRaw(tiles: number): number {
  return Math.round(tiles * FX_ONE);
}

export function fromRaw(raw: number): number {
  return raw / FX_ONE;
}
