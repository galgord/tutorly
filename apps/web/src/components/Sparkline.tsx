interface Point {
  accuracy: number;
}

interface Props {
  points: Point[];
  /** Default 80×24 px — fits the game card line. */
  width?: number;
  height?: number;
  /** When true the polyline reads right-to-left (Hebrew). */
  rtl?: boolean;
  /** Trend tone tints the stroke. */
  tone?: 'improving' | 'stable' | 'declining' | 'insufficient';
}

const TONE_STROKE: Record<NonNullable<Props['tone']>, string> = {
  improving: '#16a34a', // green-600
  stable: '#475569',    // slate-600
  declining: '#dc2626', // red-600
  insufficient: '#94a3b8', // slate-400
};

/**
 * Pure-SVG sparkline. Accepts accuracy fractions (0..1) and draws a polyline
 * from oldest → newest in input order; in RTL the rendered path is mirrored
 * horizontally so "newest" stays on the inline-end edge visually for the
 * reader (so a Hebrew tutor sees the same "trending into the future"
 * direction as an English one).
 */
export function Sparkline({
  points,
  width = 80,
  height = 24,
  rtl = false,
  tone = 'stable',
}: Props) {
  if (points.length === 0) {
    return <div aria-hidden className="text-xs text-slate-400">—</div>;
  }
  const stroke = TONE_STROKE[tone];

  // Avoid divide-by-zero when there's exactly one point.
  const n = points.length;
  const step = n > 1 ? width / (n - 1) : 0;

  const path = points
    .map((p, i) => {
      const xLogical = i * step;
      const x = rtl ? width - xLogical : xLogical;
      // Map [0,1] accuracy → [height-2 .. 2] (higher accuracy = higher on chart).
      const y = (1 - p.accuracy) * (height - 4) + 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      role="img"
      aria-label={`sparkline-${tone}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
      {points.length === 1 && (
        <circle
          cx={rtl ? width / 2 : width / 2}
          cy={(1 - points[0]!.accuracy) * (height - 4) + 2}
          r={2}
          fill={stroke}
        />
      )}
    </svg>
  );
}
