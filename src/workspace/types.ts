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

export interface LeafNode {
  type: 'leaf';
  id: string;
  panel: TerminalPanel;
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
