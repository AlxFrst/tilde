// The single list of user commands, read by the command palette and the keyboard
// shortcut handler alike (spec §4.8). Panels and plugins add theirs with
// `registerCommands`.

import type { CommandId } from '@/terminal/keys';

export type CommandGroup = 'Onglets' | 'Panneaux' | 'Terminal' | 'Connexions' | 'Application';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  run: () => void;
  /** Its keyboard shortcut, shown in the palette. */
  keybinding?: CommandId;
  /** Hidden from the palette (still reachable by its shortcut). */
  hidden?: boolean;
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
