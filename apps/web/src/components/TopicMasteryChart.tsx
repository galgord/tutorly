import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TopicProgress } from '@tutor-app/shared';

interface Props {
  topics: TopicProgress[];
  /** Tutor's locale — drives label direction. */
  rtl?: boolean;
}

const PALETTE = [
  '#2563eb', // blue-600
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#9333ea', // purple-600
  '#ea580c', // orange-600
  '#0891b2', // cyan-600
  '#ca8a04', // yellow-600
  '#475569', // slate-600
];

/**
 * Line-per-topic chart over UTC-month buckets. Pure SVG so RTL is a single
 * transform; no chart-lib dep to drag in.
 *
 * Time axis: months ascending in input order. In RTL the x-axis is mirrored
 * so "now" is on the inline-end (visually rightmost in LTR, leftmost in RTL)
 * — same orientation a tutor expects in their language.
 */
export function TopicMasteryChart({ topics, rtl = false }: Props) {
  const { t } = useTranslation();

  // Collect all month-keys across all topics → unified x-axis.
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const tp of topics) {
      for (const p of tp.points) set.add(p.month);
    }
    return [...set].sort();
  }, [topics]);

  if (months.length === 0 || topics.length === 0) {
    return (
      <div
        data-testid="topic-mastery-empty"
        className="rounded border border-dashed border-line bg-surface-muted p-4 text-center text-sm text-ink-muted"
      >
        {t('progress.topics.empty')}
      </div>
    );
  }

  const width = 480;
  const height = 200;
  const padX = 32;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = months.length > 1 ? innerW / (months.length - 1) : 0;

  const xFor = (i: number): number => {
    const xLogical = padX + i * stepX;
    return rtl ? width - xLogical : xLogical;
  };
  const yFor = (acc: number): number => padY + (1 - acc) * innerH;

  const monthIndex = new Map<string, number>();
  months.forEach((m, i) => monthIndex.set(m, i));

  return (
    <div data-testid="topic-mastery-chart" className="space-y-3">
      <svg
        role="img"
        aria-label={t('progress.topics.chartAria')}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Horizontal grid lines at 25/50/75/100% */}
        {[0, 0.25, 0.5, 0.75, 1].map((acc) => (
          <line
            key={acc}
            x1={padX}
            x2={width - padX}
            y1={yFor(acc)}
            y2={yFor(acc)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}
        {/* X-axis baseline */}
        <line
          x1={padX}
          x2={width - padX}
          y1={padY + innerH}
          y2={padY + innerH}
          stroke="#cbd5e1"
          strokeWidth={1}
        />

        {/* Month tick labels */}
        {months.map((m, i) => (
          <text
            key={m}
            x={xFor(i)}
            y={height - 4}
            fontSize={10}
            textAnchor="middle"
            fill="#64748b"
          >
            {m}
          </text>
        ))}

        {/* Topic lines */}
        {topics.map((tp, idx) => {
          const color = PALETTE[idx % PALETTE.length]!;
          const pts = tp.points
            .map((p) => {
              const i = monthIndex.get(p.month);
              if (i === undefined) return null;
              return { x: xFor(i), y: yFor(p.accuracy) };
            })
            .filter((p): p is { x: number; y: number } => p !== null);
          if (pts.length === 0) return null;
          const path = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ');
          return (
            <g key={tp.topic}>
              <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle
                  key={`${tp.topic}-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={2.5}
                  fill={color}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend — placed on the inline-start edge via logical Tailwind */}
      <ul
        data-testid="topic-mastery-legend"
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted"
      >
        {topics.map((tp, idx) => (
          <li
            key={tp.topic}
            data-testid={`topic-legend-${tp.topic}`}
            className="flex items-center gap-1.5"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: PALETTE[idx % PALETTE.length] }}
            />
            <span>{tp.topic}</span>
            <span className="text-ink-subtle">
              {t('progress.topics.accuracySuffix', {
                pct: Math.round(tp.accuracy * 100),
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
