import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

/** Clickable breadcrumb; click the empty space (or « Modifier le chemin ») to type one. */
export function PathBar({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={t('Chemin')}
        defaultValue={path}
        spellCheck={false}
        className="h-7 font-mono text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const next = e.currentTarget.value.trim();
            setEditing(false);
            if (next) onNavigate(next);
          } else if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => {
          setEditing(false);
        }}
      />
    );
  }
  const parts = path.split('/').filter(Boolean);
  return (
    <div
      className="flex h-7 min-w-0 flex-1 cursor-text items-center gap-0.5 overflow-hidden rounded-md px-1 font-mono text-xs hover:bg-surface-2"
      onClick={(e) => {
        if (e.target === e.currentTarget) setEditing(true);
      }}
    >
      <button
        type="button"
        className="rounded px-1 hover:bg-surface-1"
        onClick={() => {
          onNavigate('/');
        }}
      >
        /
      </button>
      {parts.map((part, i) => {
        const target = `/${parts.slice(0, i + 1).join('/')}`;
        return (
          <span key={target} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <span className="text-text-muted">/</span>}
            <button
              type="button"
              className="truncate rounded px-1 hover:bg-surface-1"
              onClick={() => {
                onNavigate(target);
              }}
            >
              {part}
            </button>
          </span>
        );
      })}
      <button
        type="button"
        aria-label={t('Modifier le chemin')}
        className="ml-auto h-full min-w-6 flex-1"
        onClick={() => {
          setEditing(true);
        }}
      />
    </div>
  );
}
