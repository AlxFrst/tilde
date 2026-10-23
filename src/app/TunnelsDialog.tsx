import { ArrowRight, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  addForward,
  listForwards,
  removeForward,
  type ForwardInfo,
  type ForwardSpec,
} from '@/ipc/ssh';
import { useSsh } from '@/stores/ssh';

const REFRESH_MS = 2000;

function describe(f: ForwardInfo): string {
  const listen = `${f.spec.bind || '*'}:${String(f.boundPort || f.spec.listenPort)}`;
  const target = `${f.spec.host}:${String(f.spec.port)}`;
  return f.spec.kind === 'local'
    ? `ici ${listen} → serveur ${target}`
    : `serveur ${listen} → ici ${target}`;
}

const portOf = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 65535 && s.trim() !== '' ? n : null;
};

/** The tunnels of one SSH session: list, add (local or remote), stop. */
export function TunnelsDialog() {
  const tunnels = useSsh((s) => s.tunnels);
  const setTunnels = useSsh((s) => s.setTunnels);
  const sessionId = tunnels?.sessionId ?? null;
  const [forwards, setForwards] = useState<ForwardInfo[]>([]);
  const [kind, setKind] = useState<ForwardSpec['kind']>('local');
  const [listenPort, setListenPort] = useState('');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('');

  const refresh = useCallback(() => {
    if (sessionId === null) return;
    listForwards(sessionId).then(setForwards, () => {
      setForwards([]);
    });
  }, [sessionId]);

  useEffect(() => {
    if (sessionId === null) return;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [sessionId, refresh]);

  const listen = portOf(listenPort || '0');
  const dest = portOf(port);
  const canAdd = listen !== null && dest !== null && dest > 0 && host.trim() !== '';

  const add = () => {
    if (sessionId === null || !canAdd) return;
    const spec: ForwardSpec = {
      kind,
      bind: '127.0.0.1',
      listenPort: listen,
      host: host.trim(),
      port: dest,
    };
    addForward(sessionId, spec).then(refresh, refresh);
    setListenPort('');
    setPort('');
  };

  return (
    <Dialog
      open={tunnels !== null}
      onOpenChange={(open) => {
        if (!open) setTunnels(null);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tunnels — {tunnels?.title}</DialogTitle>
          <DialogDescription>
            Local : un port de ce PC mène à une adresse vue depuis le serveur. Distant : un port du
            serveur mène à une adresse vue depuis ce PC. Rétablis après une reconnexion.
          </DialogDescription>
        </DialogHeader>

        <ul className="grid gap-1.5">
          {forwards.length === 0 && <li className="text-sm text-text-muted">Aucun tunnel.</li>}
          {forwards.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              <span className="font-mono text-xs">{f.spec.kind === 'local' ? 'L' : 'R'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{describe(f)}</span>
                {f.error ? (
                  <span className="block text-xs text-error">{f.error}</span>
                ) : (
                  <span className="block text-xs text-text-muted">
                    {f.activeConnections} connexion{f.activeConnections > 1 ? 's' : ''}
                  </span>
                )}
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Arrêter le tunnel"
                onClick={() => {
                  if (sessionId !== null) removeForward(sessionId, f.id).then(refresh, refresh);
                }}
              >
                <Trash2 strokeWidth={1.5} />
              </Button>
            </li>
          ))}
        </ul>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <select
            aria-label="Sens du tunnel"
            className="h-8 rounded-lg border bg-transparent px-2 text-sm"
            value={kind}
            onChange={(e) => {
              setKind(e.currentTarget.value === 'remote' ? 'remote' : 'local');
            }}
          >
            <option value="local">Local</option>
            <option value="remote">Distant</option>
          </select>
          <Input
            aria-label="Port d’écoute"
            className="w-28"
            placeholder="port (auto)"
            inputMode="numeric"
            value={listenPort}
            onChange={(e) => {
              setListenPort(e.currentTarget.value);
            }}
          />
          <ArrowRight className="size-4 text-text-muted" strokeWidth={1.5} />
          <Input
            aria-label="Hôte de destination"
            className="w-36"
            value={host}
            onChange={(e) => {
              setHost(e.currentTarget.value);
            }}
          />
          <Input
            aria-label="Port de destination"
            className="w-24"
            placeholder="port"
            inputMode="numeric"
            value={port}
            onChange={(e) => {
              setPort(e.currentTarget.value);
            }}
          />
          <Button type="submit" disabled={!canAdd}>
            Ajouter
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
