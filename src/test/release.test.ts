import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readVersions, versionProblem } from '../../scripts/check-version.ts';
import { missingPlatforms, updaterJson } from '../../scripts/updater-json.ts';

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

describe('the updater’s latest.json', () => {
  const sigs = new Map([
    ['Tilde_0.3.0_x64-setup.exe', 'sig-nsis'],
    ['Tilde_0.3.0_x64_en-US.msi', 'sig-msi-en'],
    ['Tilde_0.3.0_x64_fr-FR.msi', 'sig-msi-fr'],
    ['Tilde_0.3.0_amd64.AppImage', 'sig-appimage'],
    ['Tilde_0.3.0_amd64.deb', 'sig-deb'],
    ['Tilde_universal.app.tar.gz', 'sig-mac'],
  ]);
  const base = 'https://github.com/AlxFrst/tilde/releases/download/v0.3.0/';

  test('lists every platform from the signed installers, whichever job built them', () => {
    const json = updaterJson('v0.3.0', sigs, 'Notes', new Date('2026-10-26T16:00:00Z'));
    expect(json.version).toBe('0.3.0');
    expect(json.notes).toBe('Notes');
    expect(json.pub_date).toBe('2026-10-26T16:00:00.000Z');
    const urls = Object.fromEntries(
      Object.entries(json.platforms).map(([k, v]) => [k, v.url.slice(base.length)]),
    );
    expect(urls).toEqual({
      'windows-x86_64': 'Tilde_0.3.0_x64-setup.exe',
      'windows-x86_64-nsis': 'Tilde_0.3.0_x64-setup.exe',
      'windows-x86_64-msi': 'Tilde_0.3.0_x64_en-US.msi',
      'linux-x86_64': 'Tilde_0.3.0_amd64.AppImage',
      'linux-x86_64-appimage': 'Tilde_0.3.0_amd64.AppImage',
      'linux-x86_64-deb': 'Tilde_0.3.0_amd64.deb',
      'darwin-x86_64': 'Tilde_universal.app.tar.gz',
      'darwin-x86_64-app': 'Tilde_universal.app.tar.gz',
      'darwin-aarch64': 'Tilde_universal.app.tar.gz',
      'darwin-aarch64-app': 'Tilde_universal.app.tar.gz',
    });
    expect(json.platforms['windows-x86_64-nsis']?.signature).toBe('sig-nsis');
    expect(missingPlatforms(json.platforms)).toEqual([]);
  });

  test('a release missing a platform is caught before it ships', () => {
    const linuxOnly = new Map([...sigs].filter(([name]) => /AppImage|deb/.test(name)));
    const json = updaterJson('v0.3.0', linuxOnly, '', new Date());
    expect(missingPlatforms(json.platforms)).toEqual([
      'windows-x86_64',
      'windows-x86_64-nsis',
      'windows-x86_64-msi',
      'darwin-x86_64',
      'darwin-aarch64',
    ]);
  });
});
