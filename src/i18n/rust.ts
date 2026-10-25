// Messages written by Rust (errors, connection states, validation) are French. Each
// entry of en/rust.ts is a French template whose `{name}` parts stand for any text,
// with its English. The parts are translated in turn: an error often wraps another.

import { useLocale } from '.';
import { RUST } from './en/rust';

interface Rule {
  re: RegExp;
  names: string[];
  en: string;
  fixed: string;
}

let rules: Rule[] | null = null;

const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

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
          return '([\\s\\S]+?)';
        })
        .join('');
      return { re: new RegExp(`^${pattern}$`), names, en, fixed: fr.replace(/\{\w+\}/g, '') };
    })
    .sort((a, b) => b.fixed.length - a.fixed.length);
}

/** A message from Rust in the interface's language. */
export function tRust(message: string, depth = 0): string {
  if (useLocale.getState().locale !== 'en') return message;
  const exact = RUST[message];
  if (exact !== undefined) return exact;
  if (depth > 3) return message;
  for (const rule of (rules ??= compile())) {
    const m = rule.re.exec(message);
    if (!m) continue;
    return rule.en.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const i = rule.names.indexOf(name);
      return i < 0 ? whole : tRust(m[i + 1] ?? '', depth + 1);
    });
  }
  return message;
}
