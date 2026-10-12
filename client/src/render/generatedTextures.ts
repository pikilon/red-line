import type { BufferGeometry, Texture } from "three";

export const GENERATED_TEXTURE_IDS = [
  "grass",
  "dirt",
  "rock",
  "ua-paint",
  "ru-paint",
  "ua-concrete",
  "ru-concrete",
  "dark-metal",
] as const;
export type GeneratedTextureId = (typeof GENERATED_TEXTURE_IDS)[number];
export type GeneratedTextures = Partial<Record<GeneratedTextureId, Texture>>;

export interface TextureSource {
  loadAsync(url: string): Promise<Texture>;
}

/** Not implemented yet (spec 12, red phase). */
export async function loadGeneratedTextures(
  _source?: TextureSource,
): Promise<GeneratedTextures> {
  return {};
}

/** Not implemented yet (spec 12, red phase). */
export function boxProjectUvs(geometry: BufferGeometry): BufferGeometry {
  return geometry;
}
