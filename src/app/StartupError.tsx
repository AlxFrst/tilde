import { TriangleAlert } from 'lucide-react';

/** Shown instead of the shell when the backend cannot be reached at startup. */
export function StartupError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
        <TriangleAlert className="size-8 text-error" strokeWidth={1.5} />
        <h1 className="text-lg font-semibold">Tilde n’a pas pu démarrer</h1>
        <p className="text-text-muted">{message}</p>
        <p className="text-xs text-text-muted">
          Les logs (dossier Tilde/logs de votre profil) contiennent plus de détails.
        </p>
      </div>
    </div>
  );
}
