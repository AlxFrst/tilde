import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readVersions, versionProblem } from '../../scripts/check-version.ts';

const root = join(__dirname, '../..');

test('versions agree across package.json, Cargo.toml and tauri.conf.json', () => {
  const v = readVersions(root);
  expect(v.packageJson).toMatch(/^\d+\.\d+\.\d+/);
  expect(v.cargo).toBe(v.packageJson);
  expect(v.tauri).toBe(v.packageJson);
  expect(versionProblem(v)).toBeNull();
  expect(versionProblem(v, `v${v.packageJson}`)).toBeNull();
});

test('a tag that does not match is refused', () => {
  const v = { packageJson: '0.1.0', cargo: '0.1.0', tauri: '0.1.0' };
  expect(versionProblem(v, 'v0.2.0')).toMatch(/v0\.2\.0.*0\.1\.0/);
  expect(versionProblem({ ...v, cargo: '0.1.1' })).toMatch(/Cargo\.toml/);
  expect(versionProblem(v, 'release-1')).toMatch(/v/);
});

const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')) as {
  identifier: string;
  bundle: {
    targets: string | string[];
    publisher?: string;
    category?: string;
    shortDescription?: string;
    windows?: {
      webviewInstallMode?: { type: string };
      nsis?: { installMode?: string; installerHooks?: string };
      wix?: { language?: string[]; fragmentPaths?: string[]; componentRefs?: string[] };
    };
    macOS?: { minimumSystemVersion?: string };
  };
};

test('bundle config targets per-user installs with WebView2 bootstrap', () => {
  const w = conf.bundle.windows;
  expect(w?.nsis?.installMode).toBe('currentUser');
  expect(w?.webviewInstallMode?.type).toBe('downloadBootstrapper');
  expect(w?.wix?.language).toEqual(expect.arrayContaining(['en-US', 'fr-FR']));
  expect(conf.bundle.macOS?.minimumSystemVersion).toBeTruthy();
  expect(conf.bundle.publisher).toBeTruthy();
  expect(conf.bundle.category).toBe('DeveloperTool');
  expect(conf.bundle.shortDescription).toBeTruthy();
});

test('bundle config declares every target the spec asks for', () => {
  const { targets } = conf.bundle;
  if (targets !== 'all') {
    expect(targets).toEqual(expect.arrayContaining(['msi', 'nsis', 'appimage', 'deb', 'dmg']));
  }
  expect(conf.identifier).toBe('dev.tilde.app');
});

test('both Windows uninstallers remove the "Ouvrir dans Tilde" entry', () => {
  const w = conf.bundle.windows;
  const tauriDir = join(root, 'src-tauri');
  const hooks = readFileSync(join(tauriDir, w?.nsis?.installerHooks ?? 'missing'), 'utf8');
  for (const place of ['Directory', 'Directory\\Background', 'Drive']) {
    expect(hooks).toContain(`DeleteRegKey HKCU "Software\\Classes\\${place}\\shell\\Tilde"`);
  }
  expect(hooks).toContain('!macro NSIS_HOOK_PREUNINSTALL');
  const [fragment] = w?.wix?.fragmentPaths ?? [];
  const wxs = readFileSync(join(tauriDir, fragment ?? 'missing'), 'utf8');
  expect(w?.wix?.componentRefs).toEqual(['ExplorerMenuCleanup']);
  expect(wxs).toContain('Component Id="ExplorerMenuCleanup"');
  expect(wxs.match(/Action="removeOnUninstall"/g)).toHaveLength(4);
});
