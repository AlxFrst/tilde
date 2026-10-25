// The single list of user commands, read by the command palette and the keyboard
// shortcut handler alike (spec §4.8). Panels and plugins add theirs with
// `registerCommands`. Shortcuts are looked up by command id in the keybindings store.

import { msg, t } from '@/i18n';

export type CommandGroup =
  'Sessions' | 'Espaces' | 'Panneaux' | 'Terminal' | 'Connexions' | 'Application';

/** The groups' names, French like the titles: show them with t() (or `groupTitle`). */
export const COMMAND_GROUP_NAMES: Readonly<Record<CommandGroup, string>> = {
  Sessions: msg('Sessions'),
  Espaces: msg('Espaces'),
  Panneaux: msg('Panneaux'),
  Terminal: msg('Terminal'),
  Connexions: msg('Connexions'),
  Application: msg('Application'),
};

export interface Command {
  id: string;
  /** French, marked with msg(): show it with `commandTitle` (t() with `titleVars`). */
  title: string;
  /** Values of the title's `{placeholders}` (« Aller à l’espace {n} »). */
  titleVars?: Readonly<Record<string, string | number>>;
  group: CommandGroup;
  run: () => void;
  /** Hidden from the palette (still reachable by its shortcut). */
  hidden?: boolean;
  /** Other words that find it in the palette (English, synonyms). */
  keywords?: string[];
}

/** A command's title in the interface's language. */
export function commandTitle(c: Pick<Command, 'title' | 'titleVars'>): string {
  return t(c.title, c.titleVars);
}

/** A group's name in the interface's language. */
export function groupTitle(group: CommandGroup): string {
  return t(COMMAND_GROUP_NAMES[group]);
}

const commands = new Map<string, Command>();

/** Adds (or replaces, by id) commands; returns a function that removes them. */
export function registerCommands(list: Command[]): () => void {
  for (const c of list) commands.set(c.id, c);
  return () => {
    for (const c of list) if (commands.get(c.id) === c) commands.delete(c.id);
  };
}

export function listCommands(): Command[] {
  return [...commands.values()];
}

export function hasCommand(id: string): boolean {
  return commands.has(id);
}

/** Runs a command by id; `false` if none is registered. */
export function runCommand(id: string): boolean {
  const c = commands.get(id);
  if (!c) return false;
  c.run();
  return true;
}
