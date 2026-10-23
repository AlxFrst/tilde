import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

/** Beyond this many values, only the root level starts open. */
const OPEN_LIMIT = 5000;
/** Children rendered at a time in a big array or object. */
const PAGE = 500;

function count(value: unknown, limit: number): number {
  let n = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && n <= limit) {
    const v = stack.pop();
    n++;
    if (v && typeof v === 'object') stack.push(...Object.values(v as Record<string, unknown>));
  }
  return n;
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    return <span className="text-[var(--tilde-success)]">{JSON.stringify(value)}</span>;
  }
  if (typeof value === 'number') return <span className="text-warning">{String(value)}</span>;
  return <span className="text-accent-2">{String(value)}</span>;
}

function Node({
  name,
  value,
  depth,
  openDepth,
  path,
}: {
  name: string | null;
  value: unknown;
  depth: number;
  openDepth: number;
  path: string;
}) {
  const container = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < openDepth);
  const [shown, setShown] = useState(PAGE);
  const label = name === null ? null : <span className="text-accent">{name}</span>;
  if (!container) {
    return (
      <div className="pl-4" style={{ marginLeft: depth * 12 }} title={path}>
        {label}
        {label && <span className="text-text-muted">: </span>}
        <Scalar value={value} />
      </div>
    );
  }
  const isArray = Array.isArray(value);
  const entries: (readonly [string, unknown])[] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const summary = isArray
    ? `[${String(entries.length)} élément${entries.length === 1 ? '' : 's'}]`
    : `{${String(entries.length)} clé${entries.length === 1 ? '' : 's'}}`;
  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-0.5 rounded px-0.5 text-left hover:bg-surface-2"
        style={{ marginLeft: depth * 12 }}
        title={path}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.5} />
        )}
        {label ?? <span className="text-text-muted">racine</span>}
        {!open && <span className="ml-1 text-text-muted">{summary}</span>}
      </button>
      {open &&
        entries
          .slice(0, shown)
          .map(([k, v]) => (
            <Node
              key={k}
              name={isArray ? `[${k}]` : k}
              value={v}
              depth={depth + 1}
              openDepth={openDepth}
              path={isArray ? `${path}[${k}]` : `${path}.${k}`}
            />
          ))}
      {open && entries.length > shown && (
        <button
          type="button"
          className="ml-6 text-accent hover:underline"
          style={{ marginLeft: (depth + 1) * 12 + 16 }}
          onClick={() => {
            setShown((n) => n + PAGE);
          }}
        >
          Afficher {Math.min(PAGE, entries.length - shown)} de plus ({entries.length - shown}{' '}
          restants)
        </button>
      )}
    </div>
  );
}

/** A foldable JSON view; children are only rendered when their parent is open. */
export function JsonTree({ value }: { value: unknown }) {
  const openDepth = count(value, OPEN_LIMIT) > OPEN_LIMIT ? 1 : Infinity;
  return (
    <div className="font-mono text-xs leading-5">
      <Node name={null} value={value} depth={0} openDepth={openDepth} path="$" />
    </div>
  );
}
