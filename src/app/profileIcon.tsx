import { GitBranch, Server, SquareTerminal, Terminal, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  powershell: SquareTerminal,
  cmd: Terminal,
  git: GitBranch,
  linux: Server,
};

export function profileIcon(icon: string | undefined): LucideIcon {
  return (icon && ICONS[icon]) || Terminal;
}
