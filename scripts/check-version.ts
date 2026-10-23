// Checks that package.json, Cargo.toml and tauri.conf.json carry the same version, and
// that it matches the release tag. Run by the release workflow before any build:
//   node scripts/check-version.ts v0.1.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Versions {
  packageJson: string;
  cargo: string;
  tauri: string;
}

function readJsonVersion(file: string): string {
  const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
  return typeof version === 'string' ? version : '';
}

export function readVersions(root: string): Versions {
  const cargoToml = readFileSync(join(root, 'Cargo.toml'), 'utf8');
  // [workspace.package] version = "x.y.z"
  const section = cargoToml.split(/^\[workspace\.package\]/m)[1] ?? '';
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(section)?.[1] ?? '';
  return {
    packageJson: readJsonVersion(join(root, 'package.json')),
    cargo,
    tauri: readJsonVersion(join(root, 'src-tauri/tauri.conf.json')),
  };
}

/** Why these versions cannot be released under `tag` (`vX.Y.Z`), or `null`. */
export function versionProblem(v: Versions, tag?: string): string | null {
  if (v.cargo !== v.packageJson) {
    return `Cargo.toml dit ${v.cargo}, package.json dit ${v.packageJson}`;
  }
  if (v.tauri !== v.packageJson) {
    return `tauri.conf.json dit ${v.tauri}, package.json dit ${v.packageJson}`;
  }
  if (tag === undefined) return null;
  if (!tag.startsWith('v')) return `le tag ${tag} doit commencer par v (ex. v${v.packageJson})`;
  if (tag.slice(1) !== v.packageJson) {
    return `le tag ${tag} ne correspond pas à la version des fichiers (${v.packageJson})`;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(import.meta.dirname, '..');
  const problem = versionProblem(readVersions(root), process.argv[2]);
  if (problem) {
    console.error(`Version incohérente : ${problem}`);
    process.exit(1);
  }
  console.log(`Versions cohérentes (${readVersions(root).packageJson}).`);
}
