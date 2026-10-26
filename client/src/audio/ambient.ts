// Ambient bed selection (specs/25-audio.md §9, §11).
//
// Weather is opt-in through `?weather=<climate|none>` (spec 22). Snow gets the
// cold-wind bed, every other climate (and the clear default) gets the temperate
// meadow; `?weather=none` explicitly silences the bed. Add a case here and a
// reference mapping in data/audio/reference.yaml when a new climate lands.

export function ambientEventFor(params: URLSearchParams): string | null {
  const climate = params.get("weather");
  if (climate === "none") return null;
  return climate === "snow" ? "ambient.snow" : "ambient.temperate";
}
