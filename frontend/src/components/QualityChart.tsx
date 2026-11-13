import { useEffect, useMemo, useRef, useState } from "react";
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

  // Attached as native, non-passive listeners (rather than React's onWheel)
  // so preventDefault() reliably stops the browser from also scrolling the
  // page underneath the chart — with a passive listener (which some browsers
  // default to for wheel events) preventDefault is silently ignored and the
  // whole page jumps up while the chart zooms.
  const pointsLengthRef = useRef(points.length);
  useEffect(() => {
    pointsLengthRef.current = points.length;
  }, [points]);

  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Drag-to-zoom with the right mouse button held down: [startFraction,
  // currentFraction] of the plot area, only set while actively dragging —
  // used both to apply the zoom on release and to draw the selection box.
  const dragStateRef = useRef<{ rect: DOMRect; startFrac: number } | null>(null);
  const [dragVisual, setDragVisual] = useState<[number, number] | null>(null);

  function fracFromClientX(clientX: number, rect: DOMRect) {
    const usableWidth = Math.max(rect.width - CHART_MARGIN.left - CHART_MARGIN.right, 1);
    const f = (clientX - rect.left - CHART_MARGIN.left) / usableWidth;
    return Math.min(1, Math.max(0, f));
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onWheel(e: globalThis.WheelEvent) {
      const lastIdx = Math.max(pointsLengthRef.current - 1, 0);
      if (lastIdx < MIN_VISIBLE_POINTS - 1) return; // not enough points to zoom usefully
      e.preventDefault();
      e.stopPropagation();

      const rect = el!.getBoundingClientRect();
      const frac = fracFromClientX(e.clientX, rect);

      // Wheel up (deltaY < 0) zooms in by shrinking the visible span; wheel
      // down zooms back out, centered under the cursor either way.
      const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;

      setRange(([s, en]) => {
        const span = en - s;
        const centerIndex = s + frac * span;
        const newSpan = Math.min(lastIdx, Math.max(MIN_VISIBLE_POINTS - 1, span * zoomFactor));
        let newStart = Math.round(centerIndex - frac * newSpan);
        let newEnd = Math.round(newStart + newSpan);
        if (newStart < 0) {
          newEnd -= newStart;
          newStart = 0;
        }
        if (newEnd > lastIdx) {
          newStart -= newEnd - lastIdx;
          newEnd = lastIdx;
        }
        newStart = Math.max(0, newStart);
        return [newStart, newEnd];
      });
    }

    // The right mouse button is repurposed for drag-to-zoom below, so its
    // usual context menu would just get in the way here.
    function onContextMenu(e: globalThis.MouseEvent) {
      e.preventDefault();
    }

    function onMouseDown(e: globalThis.MouseEvent) {
      if (e.button !== 2) return; // right button only
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const startFrac = fracFromClientX(e.clientX, rect);
      dragStateRef.current = { rect, startFrac };
      setDragVisual([startFrac, startFrac]);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e: globalThis.MouseEvent) {
      const drag = dragStateRef.current;
      if (!drag) return;
      setDragVisual([drag.startFrac, fracFromClientX(e.clientX, drag.rect)]);
    }

    function onMouseUp(e: globalThis.MouseEvent) {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      const drag = dragStateRef.current;
      dragStateRef.current = null;
      setDragVisual(null);
      if (!drag) return;

      const endFrac = fracFromClientX(e.clientX, drag.rect);
      const lo = Math.min(drag.startFrac, endFrac);
      const hi = Math.max(drag.startFrac, endFrac);
      if (hi - lo < 0.02) return; // a plain right-click, not a drag: ignore

      const lastIdx = Math.max(pointsLengthRef.current - 1, 0);
      const [s, en] = rangeRef.current;
      const span = en - s;
      let newStart = Math.round(s + lo * span);
      let newEnd = Math.round(s + hi * span);
      if (newEnd - newStart < MIN_VISIBLE_POINTS - 1) {
        const mid = (newStart + newEnd) / 2;
        newStart = Math.round(mid - (MIN_VISIBLE_POINTS - 1) / 2);
        newEnd = newStart + (MIN_VISIBLE_POINTS - 1);
      }
      newStart = Math.max(0, newStart);
      newEnd = Math.min(lastIdx, newEnd);
      setRange([newStart, newEnd]);
    }

    function onDoubleClick() {
      setRange([0, Math.max(pointsLengthRef.current - 1, 0)]);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("dblclick", onDoubleClick);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const dragBoxStyle = useMemo(() => {
    if (!dragVisual || !dragStateRef.current) return null;
    const { rect } = dragStateRef.current;
    const usableWidth = Math.max(rect.width - CHART_MARGIN.left - CHART_MARGIN.right, 1);
    const lo = Math.min(dragVisual[0], dragVisual[1]);
    const hi = Math.max(dragVisual[0], dragVisual[1]);
    return {
      left: `${CHART_MARGIN.left + lo * usableWidth}px`,
      width: `${(hi - lo) * usableWidth}px`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragVisual]);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Molette pour zoomer · clic droit maintenu pour sélectionner une zone · double-clic pour réinitialiser
        </p>
        {isZoomed && (
          <button
            onClick={resetZoom}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-geneva-700 hover:bg-geneva-50"
          >
            ⟲ Réinitialiser le zoom
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative h-80 w-full select-none"
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        {dragBoxStyle && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 border-x-2 border-geneva-600 bg-geneva-600/10"
            style={dragBoxStyle}
          />
        )}
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
