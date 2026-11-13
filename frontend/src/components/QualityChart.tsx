import { useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
  Dot,
} from "recharts";
import type { SeriesPoint } from "../types";

const CHART_MARGIN = { top: 10, right: 20, left: 0, bottom: 0 };
const MIN_VISIBLE_POINTS = 5;

function formatTick(ts: string, granularity: string) {
  const d = new Date(ts);
  if (granularity === "horaire") return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit" });
  if (granularity === "mensuelle") return d.toLocaleDateString("fr-CH", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "short" });
}

interface Props {
  points: SeriesPoint[];
  unit: string;
  granularity: string;
}

export default function QualityChart({ points, unit, granularity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastIndex = Math.max(points.length - 1, 0);
  const [range, setRange] = useState<[number, number]>([0, lastIndex]);

  // Reset the zoom whenever a different series is loaded (new meter/import).
  useEffect(() => {
    setRange([0, Math.max(points.length - 1, 0)]);
  }, [points]);

  const [start, end] = range;
  const visiblePoints = useMemo(() => points.slice(start, end + 1), [points, start, end]);

  const data = useMemo(
    () =>
      visiblePoints.map((p) => ({
        ts: p.timestamp,
        value: p.quality === "manquante" ? null : p.value,
        quality: p.quality,
      })),
    [visiblePoints]
  );

  // contiguous "manquante" bands -> shaded reference areas, limited to what's visible
  const missingBands: { x1: string; x2: string }[] = [];
  let bandStart: string | null = null;
  visiblePoints.forEach((p, i) => {
    if (p.quality === "manquante") {
      if (bandStart === null) bandStart = p.timestamp;
    } else if (bandStart !== null) {
      missingBands.push({ x1: bandStart, x2: visiblePoints[i - 1].timestamp });
      bandStart = null;
    }
  });
  if (bandStart !== null) missingBands.push({ x1: bandStart, x2: visiblePoints[visiblePoints.length - 1].timestamp });

  const IncoherenceDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.quality !== "incoherence") return null;
    return <Dot cx={cx} cy={cy} r={4.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />;
  };

  const isZoomed = start > 0 || end < lastIndex;

  function resetZoom() {
    setRange([0, lastIndex]);
  }

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    if (lastIndex < MIN_VISIBLE_POINTS - 1) return; // not enough points to zoom usefully
    e.preventDefault();

    const span = end - start;
    const rect = containerRef.current?.getBoundingClientRect();

    // Map the cursor's x position onto the visible index range, so the
    // zoom stays centered under the mouse rather than snapping to a side.
    let frac = 0.5;
    if (rect) {
      const usableLeft = CHART_MARGIN.left;
      const usableWidth = Math.max(rect.width - CHART_MARGIN.left - CHART_MARGIN.right, 1);
      frac = (e.clientX - rect.left - usableLeft) / usableWidth;
      frac = Math.min(1, Math.max(0, frac));
    }
    const centerIndex = start + frac * span;

    // Wheel up (deltaY < 0) zooms in by shrinking the visible span; wheel
    // down zooms back out. Clamp so it can neither over-zoom past a handful
    // of points nor expand past the full series.
    const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;
    const newSpan = Math.min(lastIndex, Math.max(MIN_VISIBLE_POINTS - 1, span * zoomFactor));

    let newStart = Math.round(centerIndex - frac * newSpan);
    let newEnd = Math.round(newStart + newSpan);
    if (newStart < 0) {
      newEnd -= newStart;
      newStart = 0;
    }
    if (newEnd > lastIndex) {
      newStart -= newEnd - lastIndex;
      newEnd = lastIndex;
    }
    newStart = Math.max(0, newStart);

    setRange([newStart, newEnd]);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs text-gray-400">Molette de la souris pour zoomer sur la courbe</p>
        {isZoomed && (
          <button
            onClick={resetZoom}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-geneva-700 hover:bg-geneva-50"
          >
            ⟲ Réinitialiser le zoom
          </button>
        )}
      </div>
      <div ref={containerRef} onWheel={handleWheel} className="h-80 w-full select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
            <XAxis
              dataKey="ts"
              tickFormatter={(ts) => formatTick(ts, granularity)}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              minTickGap={30}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6b7280" }}
              width={50}
              domain={["auto", "auto"]}
              label={{ value: unit, angle: -90, position: "insideLeft", fontSize: 11, fill: "#6b7280" }}
            />
            <Tooltip
              formatter={(value: any) => [value === null ? "—" : `${Number(value).toLocaleString("fr-CH")} ${unit}`, "Valeur"]}
              labelFormatter={(ts) => new Date(ts).toLocaleString("fr-CH")}
            />
            {missingBands.map((b, i) => (
              <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill="#9ca3af" fillOpacity={0.15} />
            ))}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#2563eb"
              strokeWidth={2}
              dot={<IncoherenceDot />}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-6 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-geneva-600" /> Valeur valide
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> Incohérence (valeur anomale)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 bg-gray-400/30" style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(107,114,128,.5) 0, rgba(107,114,128,.5) 2px, transparent 2px, transparent 5px)" }} />
          Valeur manquante (absence de relevé)
        </span>
      </div>
    </div>
  );
}
