// English for every French string of the interface, one file per area. The French text
// is the key; src/i18n/i18n.test.ts checks that every string the code shows is here.

import app from './app';
import core from './core';
import panels from './panels';
import rail from './rail';
import settings from './settings';
import shell from './shell';

export const AREAS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  app,
  core,
  panels,
  rail,
  settings,
  shell,
};

export const EN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(AREAS).flatMap((entries) => Object.entries(entries)),
);
