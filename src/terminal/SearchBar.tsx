import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';
import { ArrowDown, ArrowUp, CaseSensitive, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ThemeDefinition } from '@/themes';

function searchOptions(caseSensitive: boolean, theme: ThemeDefinition): ISearchOptions {
  return {
    caseSensitive,
    decorations: {
      matchBackground: theme.terminal.selectionBackground.slice(0, 7),
      matchOverviewRuler: theme.ui.accent,
      activeMatchBackground: theme.ui.accent,
      activeMatchColorOverviewRuler: theme.ui.accent2,
    },
  };
}

/** Find-in-scrollback overlay (Ctrl+Shift+F). Enter / Shift+Enter: next / previous. */
export function SearchBar({
  search,
  theme,
  onClose,
}: {
  search: SearchAddon;
  theme: ThemeDefinition;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [found, setFound] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    return () => {
      search.clearDecorations();
    };
  }, [search]);

  const find = (backwards = false, q = query) => {
    if (!q) {
      search.clearDecorations();
      setFound(true);
      return;
    }
    const opts = searchOptions(caseSensitive, theme);
    setFound(backwards ? search.findPrevious(q, opts) : search.findNext(q, opts));
  };

  const iconButton = 'rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text';
  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg">
      <Input
        ref={input}
        value={query}
        placeholder="Rechercher"
        aria-label="Rechercher dans le terminal"
        className={cn('h-7 w-56', !found && 'border-error')}
        onChange={(e) => {
          setQuery(e.target.value);
          find(false, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(e.shiftKey);
          else if (e.key === 'Escape') onClose();
          else return;
          e.preventDefault();
        }}
      />
      <button
        type="button"
        aria-label="Respecter la casse"
        aria-pressed={caseSensitive}
        className={cn(iconButton, caseSensitive && 'bg-surface-2 text-primary')}
        onClick={() => {
          setCaseSensitive((v) => !v);
        }}
      >
        <CaseSensitive className="size-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Précédent"
        className={iconButton}
        onClick={() => {
          find(true);
        }}
      >
        <ArrowUp className="size-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Suivant"
        className={iconButton}
        onClick={() => {
          find(false);
        }}
      >
        <ArrowDown className="size-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Fermer la recherche"
        className={iconButton}
        onClick={onClose}
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
