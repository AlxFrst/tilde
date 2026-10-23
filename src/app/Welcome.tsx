import { Logo } from './Logo';

const UPCOMING = [
  ['Ctrl', 'Shift', 'P', 'Palette de commandes'],
  ['Ctrl', 'Shift', 'T', 'Nouveau terminal'],
] as const;

export function Welcome({ version }: { version: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <Logo className="size-20" />
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Tilde</h1>
        <p className="mt-1 text-text-muted">v{version}</p>
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-text-muted">
        {UPCOMING.map(([a, b, c, label]) => (
          <div key={label} className="contents">
            <dt className="flex gap-1">
              {[a, b, c].map((k) => (
                <kbd
                  key={k}
                  className="rounded border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text"
                >
                  {k}
                </kbd>
              ))}
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-text-muted">Les raccourcis arrivent avec les prochaines phases.</p>
    </div>
  );
}
