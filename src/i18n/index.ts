// The interface's language. Strings are written in French in the code and are their own
// keys: t('Fermer') shows « Fermer » in French and the English dictionary's entry in
// English, or the French text when the dictionary has none.
//
// - Placeholders: t('Supprimer « {name} » ?', { name }). Never build a key with `${}`.
// - Plurals: tn(n, '{count} panneau', '{count} panneaux').
// - Text kept in data (command titles, constants) is marked with msg() and translated
//   where it is shown, with t(value). Never call t() at module level: the language can
//   change while the app runs.

import { create } from 'zustand';
import { EN } from './en';

export type Locale = 'fr' | 'en';
export type LanguageSetting = 'auto' | Locale;

/** The language to show: the one chosen, else French on a French system, else English. */
export function resolveLocale(
  setting: LanguageSetting | undefined,
  system: string = typeof navigator === 'undefined' ? 'fr' : navigator.language,
): Locale {
  if (setting === 'fr' || setting === 'en') return setting;
  return /^fr\b/i.test(system) ? 'fr' : 'en';
}

export const useLocale = create<{ locale: Locale }>(() => ({ locale: resolveLocale(undefined) }));

export function setLocale(locale: Locale): void {
  if (useLocale.getState().locale !== locale) useLocale.setState({ locale });
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

type Vars = Readonly<Record<string, string | number>>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** `text` (the French source, also the key) in the interface's language. */
export function t(text: string, vars?: Vars): string {
  const english = useLocale.getState().locale === 'en' ? EN[text] : undefined;
  return fill(english ?? text, vars);
}

/** `one` or `other` for `count`, with `{count}` filled. In French 0 and 1 are singular. */
export function tn(count: number, one: string, other: string, vars?: Vars): string {
  const singular = useLocale.getState().locale === 'fr' ? Math.abs(count) < 2 : count === 1;
  return t(singular ? one : other, { count, ...vars });
}

/** Marks French text kept in data for translation; show it with t(). */
export const msg = (text: string): string => text;

/** The BCP 47 tag for numbers, dates and sorting. */
export function localeTag(): string {
  return useLocale.getState().locale === 'en' ? 'en-US' : 'fr-FR';
}
