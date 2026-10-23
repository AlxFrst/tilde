import { Server } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { isValidTarget, sshHosts, type SshHostEntry } from '@/ipc/ssh';
import { cn } from '@/lib/utils';

const LIST_ID = 'quick-connect-hosts';

interface QuickConnectProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (target: string) => void;
  loadHosts?: () => Promise<SshHostEntry[]>;
}

/** Ctrl+Shift+K: pick an ssh_config alias or type `user@host:port`. */
export function QuickConnectDialog({ open, onOpenChange, ...rest }: QuickConnectProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-3 sm:max-w-lg">
        {/* Mounted only while open: every opening starts from an empty field. */}
        <QuickConnectForm onOpenChange={onOpenChange} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

function QuickConnectForm({
  onOpenChange,
  onConnect,
  loadHosts = sshHosts,
}: Omit<QuickConnectProps, 'open'>) {
  const [hosts, setHosts] = useState<SshHostEntry[]>([]);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadHosts().then(
      (h) => {
        if (!cancelled) setHosts(h);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [loadHosts]);

  const query = text.trim().toLowerCase();
  const matches = useMemo(
    () =>
      hosts.filter(
        (h) => h.alias.toLowerCase().includes(query) || h.hostname.toLowerCase().includes(query),
      ),
    [hosts, query],
  );
  const highlighted = matches[Math.min(selected, matches.length - 1)];

  const connect = () => {
    // A suggestion wins unless the text is already a complete target of its own.
    const exact = hosts.some((h) => h.alias === text.trim());
    const target = !exact && highlighted && query ? highlighted.alias : text.trim();
    if (!isValidTarget(target)) {
      setInvalid(true);
      return;
    }
    onConnect(target);
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connexion SSH</DialogTitle>
        <DialogDescription>
          Un alias de ~/.ssh/config ou user@hôte:port. Entrée pour ouvrir un onglet.
        </DialogDescription>
      </DialogHeader>
      <Input
        role="combobox"
        aria-label="Hôte SSH"
        aria-expanded={matches.length > 0}
        aria-controls={LIST_ID}
        aria-invalid={invalid}
        autoFocus
        spellCheck={false}
        placeholder="prod, deploy@10.0.0.4:2222…"
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setSelected(0);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelected((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            connect();
          }
        }}
      />
      {invalid && (
        <p className="text-sm text-error">
          Hôte invalide : indiquez un alias de ~/.ssh/config ou user@hôte:port.
        </p>
      )}
      <ul id={LIST_ID} role="listbox" className="max-h-64 overflow-auto">
        {matches.map((h) => (
          <li
            key={h.alias}
            role="option"
            aria-selected={h === highlighted}
            className={cn(
              'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              h === highlighted && 'bg-surface-2',
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              onConnect(h.alias);
              onOpenChange(false);
            }}
          >
            <Server className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.5} />
            <span className="font-medium">{h.alias}</span>
            <span className="truncate text-text-muted">
              {h.user}@{h.hostname}
              {h.port === 22 ? '' : `:${String(h.port)}`}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
