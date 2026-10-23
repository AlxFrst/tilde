import { ChevronDown, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProfiles } from '@/stores/profiles';
import { useWorkspace } from '@/stores/workspace';
import { profileIcon } from './profileIcon';

/** Chevron next to "+": open a tab with any profile. */
export function NewTabMenu() {
  const profiles = useProfiles((s) => s.profiles);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Choisir un profil"
          className="flex h-6 w-4 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <ChevronDown className="size-3.5" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {profiles.map((p) => {
          const Icon = profileIcon(p.icon);
          return (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => {
                useWorkspace.getState().openTab(p.id);
              }}
            >
              <Icon strokeWidth={1.5} style={p.color ? { color: p.color } : undefined} />
              {p.name}
            </DropdownMenuItem>
          );
        })}
        {profiles.length === 0 && <DropdownMenuItem disabled>Aucun shell détecté</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void useProfiles.getState().refresh();
          }}
        >
          <RefreshCw strokeWidth={1.5} />
          Rechercher à nouveau les shells
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
