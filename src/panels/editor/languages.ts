// Syntax highlighting by file name. Each language is loaded on demand (dynamic import),
// so opening a YAML file never downloads the SQL grammar.

import type { Extension } from '@codemirror/state';

interface Language {
  label: string;
  matches: (name: string, ext: string) => boolean;
  load: () => Promise<Extension>;
}

const legacy = async (mode: Promise<{ [k: string]: unknown }>, key: string) => {
  const [{ StreamLanguage }, m] = await Promise.all([import('@codemirror/language'), mode]);
  return StreamLanguage.define(m[key] as never);
};

const exts =
  (...list: string[]) =>
  (_name: string, ext: string) =>
    list.includes(ext);

const LANGUAGES: Language[] = [
  {
    label: 'TypeScript',
    matches: exts('ts', 'tsx', 'mts', 'cts'),
    load: async () =>
      (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  },
  {
    label: 'JavaScript',
    matches: exts('js', 'jsx', 'mjs', 'cjs'),
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  },
  {
    label: 'JSON',
    matches: exts('json', 'jsonc'),
    load: async () => (await import('@codemirror/lang-json')).json(),
  },
  {
    label: 'Markdown',
    matches: exts('md', 'markdown'),
    load: async () => (await import('@codemirror/lang-markdown')).markdown(),
  },
  {
    label: 'Python',
    matches: exts('py', 'pyw'),
    load: async () => (await import('@codemirror/lang-python')).python(),
  },
  {
    label: 'Rust',
    matches: exts('rs'),
    load: async () => (await import('@codemirror/lang-rust')).rust(),
  },
  {
    label: 'HTML',
    matches: exts('html', 'htm'),
    load: async () => (await import('@codemirror/lang-html')).html(),
  },
  {
    label: 'CSS',
    matches: exts('css', 'scss', 'less'),
    load: async () => (await import('@codemirror/lang-css')).css(),
  },
  {
    label: 'YAML',
    matches: exts('yml', 'yaml'),
    load: async () => (await import('@codemirror/lang-yaml')).yaml(),
  },
  {
    label: 'XML',
    matches: exts('xml', 'svg', 'plist', 'xaml', 'csproj'),
    load: async () => (await import('@codemirror/lang-xml')).xml(),
  },
  {
    label: 'SQL',
    matches: exts('sql'),
    load: async () => (await import('@codemirror/lang-sql')).sql(),
  },
  {
    label: 'Shell',
    matches: (name, ext) =>
      ['sh', 'bash', 'zsh', 'ksh'].includes(ext) ||
      ['.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.profile'].includes(name),
    load: () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  },
  {
    label: 'TOML',
    matches: exts('toml'),
    load: () => legacy(import('@codemirror/legacy-modes/mode/toml'), 'toml'),
  },
  {
    label: 'Dockerfile',
    matches: (name, ext) => name === 'dockerfile' || ext === 'dockerfile',
    load: () => legacy(import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile'),
  },
  {
    label: 'Nginx',
    matches: (name) => name === 'nginx.conf' || name.endsWith('.nginx'),
    load: () => legacy(import('@codemirror/legacy-modes/mode/nginx'), 'nginx'),
  },
  {
    label: 'Propriétés',
    matches: (name, ext) =>
      ['ini', 'conf', 'cfg', 'properties', 'env'].includes(ext) || name.startsWith('.env'),
    load: () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  },
];

function find(fileName: string): Language | undefined {
  const name = (fileName.split(/[/\\]/).pop() ?? fileName).toLowerCase();
  // `.bashrc` has no extension; `app.ts` has `ts`.
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  return LANGUAGES.find((l) => l.matches(name, ext));
}

/** The language shown in the editor's status bar. */
export function languageLabel(fileName: string): string {
  return find(fileName)?.label ?? 'Texte brut';
}

/** The highlighting for this file, loaded on demand; `null` for plain text. */
export async function languageFor(fileName: string): Promise<Extension | null> {
  const lang = find(fileName);
  return lang ? lang.load() : null;
}
