/** Moves focus between sidebar entries with ↑/↓. */
export function focusSibling(from: HTMLElement, delta: 1 | -1): void {
  const rows = Array.from(
    from.closest('[data-sidebar-list]')?.querySelectorAll<HTMLElement>('[data-sidebar-row]') ?? [],
  );
  rows[rows.indexOf(from) + delta]?.focus();
}
