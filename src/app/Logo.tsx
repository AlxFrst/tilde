import { useId } from 'react';

/** The Tilde mark, as in src-tauri/icons/icon.svg: a tilde and a cursor on a dark tile. */
export function Logo({ className }: { className?: string }) {
  const tile = `tile-${useId()}`;
  return (
    <svg viewBox="80 80 864 864" aria-hidden className={className}>
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2130" />
          <stop offset="1" stopColor="#0b0e14" />
        </linearGradient>
      </defs>
      <rect x="80" y="80" width="864" height="864" rx="196" fill={`url(#${tile})`} />
      <rect
        x="84"
        y="84"
        width="856"
        height="856"
        rx="192"
        fill="none"
        stroke="#2a3242"
        strokeWidth="8"
      />
      <path
        d="M244 580C284 440 412 424 512 512S740 584 780 444"
        transform="translate(410 512) scale(0.68) translate(-512 -512)"
        fill="none"
        stroke="#7aa2f7"
        strokeWidth="170"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="680" y="384" width="140" height="256" rx="18" fill="#5eead4" />
    </svg>
  );
}
