/**
 * DO_NOT_TRACK (https://donottrack.sh/). Wachiman reads it, never sets it, and never passes it on.
 * It changes nothing today because Wachiman sends no usage data; it is here so any future collection
 * has to ask `usageDataAllowed` first.
 */

/** True when `DO_NOT_TRACK` is set to anything but empty, `0` or `false` (case-insensitive). Errs toward privacy. */
export function doNotTrack(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.DO_NOT_TRACK?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

/** Wachiman collects nothing, so this is false; future collection must also return false whenever `doNotTrack(env)` is true. */
export function usageDataAllowed(env: Record<string, string | undefined> = process.env): boolean {
  void env;
  return false;
}
