// Builds the updater's latest.json from a release's signed installers, once every platform
// is built. The build jobs used to merge their own entries into latest.json at the same
// time: the last one to write dropped the others' (0.3.0 first shipped without Windows).
// Run by the release workflow's last job, in the folder holding the `.sig` files:
//   node scripts/updater-json.ts v0.3.0 notes.md > latest.json

import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface UpdaterEntry {
  signature: string;
  url: string;
}

export interface UpdaterJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, UpdaterEntry>;
}

/** What the updater looks for, by platform (Tauri's keys). */
const REQUIRED = [
  'windows-x86_64',
  'windows-x86_64-nsis',
  'windows-x86_64-msi',
  'linux-x86_64',
  'darwin-x86_64',
  'darwin-aarch64',
] as const;

/**
 * The updater entries of a release whose signed installers are `sigs` (installer name →
 * signature). The generic Windows key points to the NSIS installer, the default one; of
 * the MSIs, the English one (any MSI updates either language's install).
 */
export function updaterJson(
  tag: string,
  sigs: ReadonlyMap<string, string>,
  notes: string,
  now: Date,
): UpdaterJson {
  const base = `https://github.com/AlxFrst/tilde/releases/download/${tag}/`;
  const platforms: Record<string, UpdaterEntry> = {};
  const put = (keys: readonly string[], name: string) => {
    const signature = sigs.get(name);
    if (signature === undefined) return;
    for (const key of keys) platforms[key] ??= { signature, url: base + name };
  };
  // Sorted, so the English MSI comes before the French one.
  for (const name of [...sigs.keys()].sort()) {
    if (name.endsWith('-setup.exe')) put(['windows-x86_64-nsis', 'windows-x86_64'], name);
    else if (name.endsWith('.msi')) put(['windows-x86_64-msi'], name);
    else if (name.endsWith('.AppImage')) put(['linux-x86_64-appimage', 'linux-x86_64'], name);
    else if (name.endsWith('.deb')) put(['linux-x86_64-deb'], name);
    else if (name.endsWith('.rpm')) put(['linux-x86_64-rpm'], name);
    else if (name.endsWith('.app.tar.gz')) {
      put(['darwin-x86_64', 'darwin-x86_64-app', 'darwin-aarch64', 'darwin-aarch64-app'], name);
    }
  }
  return { version: tag.replace(/^v/, ''), notes, pub_date: now.toISOString(), platforms };
}

/** The platforms the updater needs that `platforms` lacks. */
export function missingPlatforms(platforms: Readonly<Record<string, UpdaterEntry>>): string[] {
  return REQUIRED.filter((key) => !(key in platforms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, notesFile] = process.argv.slice(2);
  if (!tag || !notesFile) {
    console.error('usage: node scripts/updater-json.ts <tag> <notes file>');
    process.exit(2);
  }
  const sigs = new Map(
    readdirSync('.')
      .filter((f) => f.endsWith('.sig'))
      .map((f) => [f.slice(0, -'.sig'.length), readFileSync(f, 'utf8').trim()] as const),
  );
  const json = updaterJson(tag, sigs, readFileSync(notesFile, 'utf8').trim(), new Date());
  const missing = missingPlatforms(json.platforms);
  if (missing.length > 0) {
    console.error(`latest.json incomplet, il manque : ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
}
