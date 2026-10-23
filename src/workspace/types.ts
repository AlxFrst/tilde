/** `row` = side by side, `column` = stacked. */
export type Direction = 'row' | 'column';

export type FocusDirection = 'left' | 'right' | 'up' | 'down';

export interface TerminalPanel {
  kind: 'terminal';
  profileId: string;
  /** Last known working directory (OSC 7), used to restore and to split in place. */
  cwd: string | null;
  /** Title set by the shell (OSC 0/2). */
  title: string | null;
}

export interface SshPanel {
  kind: 'ssh';
  /** An alias of ~/.ssh/config or `user@host:port` (a saved connection's host). */
  target: string;
  /** The saved connection opened here; `target` is used if it no longer exists. */
  connectionId: string | null;
  /** Last known remote directory (OSC 7). */
  cwd: string | null;
  title: string | null;
}

/** Files of the SSH session running in another pane (SFTP). */
export interface SftpPanel {
  kind: 'sftp';
  /** The SSH pane whose session and working directory it uses. */
  linkedLeafId: string;
  /** The directory shown; `null` until known (home). */
  path: string | null;
  /** Follows the linked terminal's directory (OSC 7). */
  follow: boolean;
  cwd: null;
  title: null;
}

/** Where an editor's (or a preview's) file comes from. */
export type FileSource =
  | {
      kind: 'remote';
      /** The SSH pane whose session reads and writes the file. */
      linkedLeafId: string;
      path: string;
    }
  | {
      kind: 'local';
      /** Given by Rust when the file was picked in the native dialog. */
      docId: number;
      name: string;
    };

/** The built-in text editor. Not saved in workspace.json. */
export interface EditorPanel {
  kind: 'editor';
  source: FileSource;
  cwd: null;
  title: null;
}

/** What a preview shows: a file, or an editor's text as it is typed. */
export type PreviewSource = FileSource | { kind: 'editor'; editorLeafId: string; name: string };

/** Markdown, image or JSON preview. Not saved in workspace.json. */
export interface PreviewPanel {
  kind: 'preview';
  source: PreviewSource;
  cwd: null;
  title: null;
}

/** System monitor: this machine, or the server of an SSH pane. */
export interface MonitorPanel {
  kind: 'monitor';
  source: { kind: 'local' } | { kind: 'remote'; linkedLeafId: string };
  cwd: null;
  title: null;
}

export type Panel =
  TerminalPanel | SshPanel | SftpPanel | EditorPanel | PreviewPanel | MonitorPanel;

/** What a pane may update in its own panel (fields it does not have are ignored). */
export type PanelPatch = Record<string, unknown>;

export interface LeafNode {
  type: 'leaf';
  id: string;
  panel: Panel;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: Direction;
  children: LayoutNode[];
  /** Percentages, one per child, summing to 100. */
  sizes: number[];
}

export type LayoutNode = LeafNode | SplitNode;

export interface Tab {
  id: string;
  customTitle: string | null;
  color: string | null;
  root: LayoutNode;
  activeLeafId: string;
}

export interface WorkspaceSnapshot {
  version: 1;
  tabs: Tab[];
  activeTabId: string | null;
}
