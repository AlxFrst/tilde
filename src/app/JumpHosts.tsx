import { FileCode2, Keyboard, Plus, Server, X } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';
import type { Connection } from '@/ipc/connections';
import type { SshHostEntry } from '@/ipc/ssh';
import { describeTarget } from './sidebar/Section';

const split = (value: string) =>
  value
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

/**
 * The `ProxyJump` chain as a list of hops, picked from saved connections and
 * ~/.ssh/config or typed. Emits the comma-separated value OpenSSH expects.
 */
export function JumpHosts({
  value,
  onChange,
  invalid,
  connections,
  sshHosts,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  /** Saved connections that can serve as a hop (the edited one already left out). */
  connections: Connection[];
  sshHosts: SshHostEntry[];
}) {
  // Rows are kept as typed, empty ones included, so a new row does not vanish.
  const [hops, setHops] = useState(() => split(value));
  const list = useRef<HTMLDivElement>(null);

  const commit = (next: string[]) => {
    setHops(next);
    onChange(
      next
        .map((h) => h.trim())
        .filter(Boolean)
        .join(','),
    );
  };
  const add = (hop: string) => {
    commit([...hops, hop]);
    if (!hop) {
      // Focus the new empty row once it is rendered.
      requestAnimationFrame(() => {
        list.current?.querySelector<HTMLInputElement>('input:last-of-type')?.focus();
      });
    }
  };

  return (
    <div className="grid gap-1.5">
      {hops.length > 0 && (
        <div ref={list} className="grid gap-1.5">
          {hops.map((hop, i) => {
            const n = String(i + 1);
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-4 shrink-0 text-right text-xs text-text-muted tabular-nums">
                  {n}
                </span>
                <Input
                  id={i === 0 ? 'conn-proxyJump' : undefined}
                  aria-label={t('Rebond {n}', { n })}
                  aria-invalid={invalid}
                  value={hop}
                  placeholder={t('alias, ou user@hôte:port')}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => {
                    commit(hops.map((h, j) => (j === i ? e.currentTarget.value : h)));
                  }}
                />
                <button
                  type="button"
                  aria-label={t('Retirer le rebond {n}', { n })}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
                  onClick={() => {
                    commit(hops.filter((_, j) => j !== i));
                  }}
                >
                  <X className="size-3.5" strokeWidth={1.5} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('Ajouter un rebond')}
            className="flex h-7 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <Plus className="size-3.5" strokeWidth={1.5} />
            {hops.length === 0 ? t('Passer par un bastion') : t('Ajouter un rebond')}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-64 overflow-y-auto">
          {connections.length > 0 && (
            <>
              <DropdownMenuLabel>{t('Connexions enregistrées')}</DropdownMenuLabel>
              {connections.map((c) => {
                const target = describeTarget(c);
                return (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={() => {
                      add(target);
                    }}
                  >
                    <Server className="size-4" strokeWidth={1.5} />
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto truncate pl-3 text-xs text-text-muted">{target}</span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
            </>
          )}
          {sshHosts.length > 0 && (
            <>
              <DropdownMenuLabel>~/.ssh/config</DropdownMenuLabel>
              {sshHosts.map((h) => (
                <DropdownMenuItem
                  key={h.alias}
                  onSelect={() => {
                    add(h.alias);
                  }}
                >
                  <FileCode2 className="size-4" strokeWidth={1.5} />
                  <span className="truncate">{h.alias}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onSelect={() => {
              add('');
            }}
          >
            <Keyboard className="size-4" strokeWidth={1.5} />
            {t('Saisir une adresse…')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
