/**
 * DO_NOT_TRACK (https://donottrack.sh/). Wachiman reads it, never sets it, and never passes it on.
 * It changes nothing today because Wachiman sends no usage data; it is here so any future collection
 * has to ask `usageDataAllowed()` first (not `doNotTrack()`, which is only its input).
 */

/** True when `DO_NOT_TRACK` is set to anything but empty, `0` or `false` (case-insensitive). Errs toward privacy. */
export function doNotTrack(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.DO_NOT_TRACK?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

/** Wachiman collects no usage data. A change that adds collection flips this and must still pass through `usageDataAllowed`. */
const COLLECTS_USAGE_DATA = false;

/** The pure rule: collection needs both a feature that collects and no `DO_NOT_TRACK`. Exported for tests; call `usageDataAllowed`. */
export function usageGate(collects: boolean, env: Record<string, string | undefined>): boolean {
  return collects && !doNotTrack(env);
}

/** The one gate: whether usage data may be collected. Never when `DO_NOT_TRACK` is set, whatever was opted into. */
export function usageDataAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return usageGate(COLLECTS_USAGE_DATA, env);
}
