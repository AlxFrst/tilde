import {
  Box,
  Cloud,
  Cpu,
  Database,
  Globe,
  House,
  Rocket,
  Server,
  Shield,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';

/** Lucide components for `CONNECTION_ICONS`; unknown or missing → Server. */
const ICONS: Record<string, LucideIcon> = {
  server: Server,
  database: Database,
  cloud: Cloud,
  globe: Globe,
  terminal: SquareTerminal,
  box: Box,
  cpu: Cpu,
  shield: Shield,
  house: House,
  rocket: Rocket,
};

export const connectionIcon = (name: string | null | undefined): LucideIcon =>
  (name ? ICONS[name] : undefined) ?? Server;
