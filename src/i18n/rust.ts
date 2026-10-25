// Messages written by Rust (errors, connection states, validation) are French. Each
// entry of en/rust.ts is a French message, or a template whose `{part}`s stand for any
// text (possibly empty), with its English. The parts are translated in turn: an error
// often wraps another. A few parts are special:
// - `{name}` is a name someone chose (a connection, a program…): kept as it is;
// - `{field}` is a settings key or a command id (`terminal.fontSize`, `proxyJump`);
// - `{path}` is a file path (`/srv/x`, `~/x`, `./x`, `C:\x`, `\\server\x`);
// - a part whose name ends in `List` (`{fieldList}`) is a list "a, b, c" whose items are
//   translated one by one (an item may itself contain ", ").
// Templates are tried from the most specific (the longest fixed text) to the least.

import { useLocale } from '.';
import { RUST } from './en/rust';

interface Rule {
  key: string;
  re: RegExp;
  names: string[];
  en: string;
  fixed: number;
}

const ANY = '[\\s\\S]*?';
const NARROW = new Map([
  ['field', '[a-z][\\w.-]*'],
  ['path', `(?:[A-Za-z]:[\\\\/]|[/\\\\~.])${ANY}`],
]);
/** Wrappers inside wrappers; real messages stay far below. */
const MAX_DEPTH = 12;

let exact: ReadonlyMap<string, string> | null = null;
let rules: Rule[] | null = null;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The templates with parts, the most specific (longest fixed text) first. */
function compile(): Rule[] {
  return Object.entries(RUST)
    .filter(([fr]) => /\{\w+\}/.test(fr))
    .map(([fr, en]) => {
      const names: string[] = [];
      const pattern = fr
        .split(/(\{\w+\})/)
        .map((piece) => {
          const name = /^\{(\w+)\}$/.exec(piece)?.[1];
          if (!name) return escape(piece);
          names.push(name);
          return `(${NARROW.get(name) ?? ANY})`;
        })
        .join('');
      const fixed = fr.replace(/\{\w+\}/g, '').length;
      return { key: fr, re: new RegExp(`^${pattern}$`), names, en, fixed };
    })
    .sort((a, b) => b.fixed - a.fixed);
}

const compiled = () => (rules ??= compile());

/** The English of `message`, or `undefined` when nothing in the table matches it. */
function translate(message: string, depth: number): string | undefined {
  const english = (exact ??= new Map(Object.entries(RUST))).get(message);
  if (english !== undefined || depth > MAX_DEPTH) return english;
  for (const rule of compiled()) {
    const m = rule.re.exec(message);
    if (!m) continue;
    return rule.en.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const i = rule.names.indexOf(name);
      if (i < 0) return whole;
      const part = m[i + 1] ?? '';
      if (name === 'name') return part;
      if (name.endsWith('List')) return translateList(part, depth + 1);
      return translate(part, depth + 1) ?? part;
    });
  }
  return undefined;
}

/** "a, b, c" item by item: from each item on, the shortest run of items that has an entry. */
function translateList(list: string, depth: number): string {
  const chunks = list.split(', ');
  const out: string[] = [];
  let i = 0;
  while (i < chunks.length) {
    let next = i + 1;
    let english: string | undefined;
    for (let j = i; j < chunks.length && english === undefined; j++) {
      english = translate(chunks.slice(i, j + 1).join(', '), depth);
      if (english !== undefined) next = j + 1;
    }
    out.push(english ?? chunks[i] ?? '');
    i = next;
  }
  return out.join(', ');
}

/** A message from Rust in the interface's language. */
export function tRust(message: string): string {
  if (useLocale.getState().locale !== 'en') return message;
  return translate(message, 0) ?? message;
}

/** The templates matching the whole of `message`, the one used first (for tests). */
export function matchingTemplates(message: string): string[] {
  return compiled()
    .filter((rule) => rule.re.test(message))
    .map((rule) => rule.key);
}

/** How specific a template is: the length of its fixed text (for tests). */
export function templateWeight(key: string): number {
  return compiled().find((rule) => rule.key === key)?.fixed ?? 0;
}
