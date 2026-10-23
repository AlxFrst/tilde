/** A tiny line chart of the last values (inline SVG, accent colour). */
export function Sparkline({
  values,
  max,
  label,
}: {
  values: readonly number[];
  /** Top of the scale; defaults to the largest value. */
  max?: number;
  label: string;
}) {
  const width = 120;
  const height = 28;
  const top = Math.max(max ?? Math.max(...values, 0), 1e-9);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - (Math.min(v, top) / top) * height).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="shrink-0 overflow-visible"
    >
      {values.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke="var(--tilde-accent)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
