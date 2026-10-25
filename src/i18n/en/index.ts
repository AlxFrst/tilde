// English for every French string of the interface, one file per area. The French text
// is the key; src/i18n/i18n.test.ts checks that every string the code shows is here.

import app from './app';

export const AREAS: Readonly<Record<string, Readonly<Record<string, string>>>> = { app };

export const EN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(AREAS).flatMap((entries) => Object.entries(entries)),
);
