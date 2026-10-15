/** `?load=<id>` boot (spec 19 §5.3). */
import type { SlotId } from "./saveFile";

export type LoadSource =
  | { kind: "slot"; id: SlotId }
  | { kind: "example"; id: string };

export function loadSource(
  _param: string | null,
  _exampleIds: readonly string[],
): LoadSource | null {
  return null;
}
