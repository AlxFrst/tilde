const BACKSLASH = '\\';

/**
 * Parses an OSC 7 payload (`file://host/path`) into a local path.
 * Windows drive paths (`/C:/x`) become `C:\x`. Returns null for anything else.
 */
export function parseOsc7(data: string): string | null {
  const match = /^file:\/\/[^/]*(\/.*)$/i.exec(data);
  const raw = match?.[1];
  if (!raw) return null;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const drive = /^\/([a-zA-Z]:)(\/.*)?$/.exec(path);
  if (!drive) return path;
  const rest = (drive[2] ?? '/').split('/').join(BACKSLASH);
  return (drive[1] ?? '') + rest;
}
