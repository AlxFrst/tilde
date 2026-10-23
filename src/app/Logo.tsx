import { cn } from '@/lib/utils';

/** The Tilde mark: a single tilde stroke in the accent color. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn('text-primary', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
    >
      <path d="M4 14.5c1.2-3 3-4.5 5-4.5 3 0 3 4 6 4 2 0 3.8-1.5 5-4.5" />
    </svg>
  );
}
