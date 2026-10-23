// The panel registry: the contract every pane type implements (spec §4.8), and the one
// future plugins will use. The layout never imports a panel: it looks its module up here
// by the `kind` stored in the layout tree. See docs/panneaux.md.

import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { registerCommands, type Command } from '@/commands/registry';

/** What a pane receives from the layout. */
export interface PanelProps<S> {
  tabId: string;
  leafId: string;
  /** The pane's state, as stored in the layout (and in workspace.json). */
  state: S;
  /** Visible in the active tab and focused. */
  active: boolean;
  /** In the visible tab (focused or not): what a live pane (monitor) polls on. */
  visible: boolean;
  /** Updates fields of the pane's own state (unknown fields are ignored). */
  update: (patch: Partial<S>) => void;
  /** Closes the pane. */
  close: () => void;
}

/** A settings fragment a module contributes (reserved; no module uses it yet). */
export interface SettingsContribution {
  section: string;
  render: ComponentType;
}

export interface PanelModule<S = unknown> {
  /** Unique id, e.g. "core.editor". */
  id: string;
  /** The `kind` of the panes this module renders (stored in the layout). */
  kind: string;
  title: string;
  icon: LucideIcon;
  component: ComponentType<PanelProps<S>>;
  /** Tab label when this pane is active; defaults to `title`. */
  tabTitle?: (state: S) => string;
  /** Commands registered (palette, shortcuts) while the module is. */
  commands?: Command[];
  settings?: SettingsContribution;
  /** What workspace.json keeps; `null`: the pane is not saved (gone after a restart). */
  serialize?: (state: S) => unknown;
  /** Checks a saved state (untrusted file); `null` drops the pane. */
  deserialize?: (raw: Record<string, unknown>) => S | null;
}

const modules = new Map<string, PanelModule>();
const unregisterCommands = new Map<string, () => void>();

/** Adds a module (replacing one of the same kind); returns a function that removes it. */
export function registerPanel<S>(module: PanelModule<S>): () => void {
  const m = module as unknown as PanelModule;
  unregisterCommands.get(m.kind)?.();
  modules.set(m.kind, m);
  const offCommands = m.commands ? registerCommands(m.commands) : () => undefined;
  unregisterCommands.set(m.kind, offCommands);
  return () => {
    if (modules.get(m.kind) !== m) return;
    modules.delete(m.kind);
    offCommands();
    unregisterCommands.delete(m.kind);
  };
}

export function getPanelModule(kind: string): PanelModule | undefined {
  return modules.get(kind);
}

export function listPanelModules(): PanelModule[] {
  return [...modules.values()];
}

/** The saved form of a pane state, or `null` if its module does not save it. */
export function serializePanel(state: { kind: string }): unknown {
  const m = modules.get(state.kind);
  if (!m) return null;
  return m.serialize ? m.serialize(state) : state;
}
