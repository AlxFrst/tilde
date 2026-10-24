/** A small labelled button at the end of a Library line (« Ouvrir », « Adopter »…). */
export function RowAction({
  label,
  children,
  onClick,
  disabled,
  title,
}: {
  label: string;
  children: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
