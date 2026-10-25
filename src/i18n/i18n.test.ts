import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { AREAS, EN } from './en';
import { msg, resolveLocale, setLocale, t, tn } from '.';

const SRC = join(__dirname, '..');
const SKIP = /(\.test\.tsx?$|^test\/|^ipc\/generated\/|^components\/ui\/|^i18n\/en\/)/;

interface Use {
  key: string;
  at: string;
}

/** Every French string passed to t(), tn() or msg(), and keys built from `${}`. */
function scan(): { uses: Use[]; built: string[] } {
  const uses: Use[] = [];
  const built: string[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (f) => /\.tsx?$/.test(f) && !SKIP.test(f.replaceAll('\\', '/')),
  );
  for (const file of files) {
    const text = readFileSync(join(SRC, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const keys = name === 't' || name === 'msg' ? [0] : name === 'tn' ? [1, 2] : [];
        for (const i of keys) {
          const arg = node.arguments[i];
          const line = arg && source.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
          const at = `${file}:${String(line)}`;
          if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
            uses.push({ key: arg.text, at });
          } else if (arg && ts.isTemplateExpression(arg)) built.push(at);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { uses, built };
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the English dictionary', () => {
  const { uses, built } = scan();

  test('has every string the interface shows', () => {
    const missing = uses.filter((u) => !(u.key in EN)).map((u) => `${u.at}  ${u.key}`);
    expect(missing).toEqual([]);
  });

  test('keeps the placeholders of each string', () => {
    const wrong = Object.entries(EN)
      .filter(([fr, en]) => placeholders(fr).join() !== placeholders(en).join())
      .map(([fr]) => fr);
    expect(wrong).toEqual([]);
  });

  test('has no entry the code no longer uses', () => {
    const used = new Set(uses.map((u) => u.key));
    expect(Object.keys(EN).filter((k) => !used.has(k))).toEqual([]);
  });

  test('gives one translation per string, whatever the area', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [area, entries] of Object.entries(AREAS)) {
      for (const [fr, en] of Object.entries(entries)) {
        const before = seen.get(fr);
        if (before !== undefined && before !== en) clashes.push(`${area}: ${fr}`);
        seen.set(fr, en);
      }
    }
    expect(clashes).toEqual([]);
  });

  test('is never looked up with a key built at run time', () => {
    expect(built).toEqual([]);
  });
});

describe('t()', () => {
  afterEach(() => {
    setLocale('fr');
  });

  test('shows the French source in French and the dictionary entry in English', () => {
    expect(t('Langue')).toBe('Langue');
    setLocale('en');
    expect(t('Langue')).toBe('Language');
    expect(t('Pas encore traduit')).toBe('Pas encore traduit');
  });

  test('fills placeholders and leaves other braces alone', () => {
    expect(t('{a} et {b} {c}', { a: 1, b: 'deux' })).toBe('1 et deux {c}');
    expect(t('{ "json": true }')).toBe('{ "json": true }');
  });

  test('picks the plural form by language', () => {
    expect(tn(0, '{count} essai', '{count} essais')).toBe('0 essai');
    setLocale('en');
    expect(tn(0, '{count} essai', '{count} essais')).toBe('0 essais');
    expect(tn(1, '{count} essai', '{count} essais')).toBe('1 essai');
  });

  test('msg() only marks text', () => {
    expect(msg('Langue')).toBe('Langue');
  });
});

test('auto follows the system: French on a French system, English elsewhere', () => {
  expect(resolveLocale('auto', 'fr-CA')).toBe('fr');
  expect(resolveLocale('auto', 'en-GB')).toBe('en');
  expect(resolveLocale('auto', 'de-DE')).toBe('en');
  expect(resolveLocale('fr', 'en-US')).toBe('fr');
  expect(resolveLocale(undefined, 'fr')).toBe('fr');
});
