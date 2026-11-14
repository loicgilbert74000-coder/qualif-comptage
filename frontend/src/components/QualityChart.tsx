import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesPoint } from "../types";

// Rendered on a plain <canvas> instead of Recharts (SVG + a per-point React
// Dot renderer): for a year of hourly or quarter-hourly readings that was
// thousands of SVG nodes and function calls reconciled by React on every
// pan/zoom. A canvas redraw of the same points is a handful of imperative
// drawing calls, so it stays smooth at any series length. All the existing
// zoom/drag/reset interaction logic below is unchanged from the Recharts
// version — only the margin constant was renamed and the thing it draws on
// switched from an SVG chart to this canvas.
const MARGIN = { top: 10, right: 16, bottom: 26, left: 54 };
const MIN_VISIBLE_POINTS = 5;

function formatTick(ts: string, granularity: string) {
  const d = new Date(ts);
  if (["15min", "30min", "horaire"].includes(granularity)) return d.toLocaleString("fr-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: granularity === "horaire" ? undefined : "2-digit" });
  if (granularity === "mensuelle") return d.toLocaleDateString("fr-CH", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "short" });
}

function formatNumber(v: number) {
  return v.toLocaleString("fr-CH", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 });
}

// Binary search helpers over an ascending array of epoch-ms timestamps.
function lowerBound(arr: number[], target: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function upperBound(arr: number[], target: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export interface ChartZone {
  id: string;
  period_start: string;
  period_end: string;
  resolution: "en_attente" | "validee" | "corrigee";
}

const ZONE_COLORS: Record<ChartZone["resolution"], { fill: string; stroke: string }> = {
  en_attente: { fill: "rgba(239,68,68,0.12)", stroke: "rgba(220,38,38,0.55)" },
  validee: { fill: "rgba(34,197,94,0.14)", stroke: "rgba(22,163,74,0.5)" },
  corrigee: { fill: "rgba(59,130,246,0.12)", stroke: "rgba(37,99,235,0.45)" },
};

export interface PreviewPoint {
  timestamp: string;
  proposed_value: number | null;
}

// Validated categorical palette, slot 2 (orange) — passes
// scripts/validate_palette.js "#2a78d6,#eb6834" --mode light against the
// chart's existing blue value line. Dashed stroke is the secondary
// encoding, so the overlay stays legible without relying on color alone.
const PREVIEW_COLOR = "#eb6834";

interface Props {
  points: SeriesPoint[];
  unit: string;
  granularity: string;
  /** Tailwind height class for the plot area; defaults to "h-80". */
  height?: string;
  /** Clickable problem zones drawn over the chart (step 2 of the wizard). */
  zones?: ChartZone[];
  selectedZoneId?: string | null;
  onSelectZone?: (id: string | null) => void;
  /**
   * Correction preview for the currently selected zone: the values a
   * correctif would write, overlaid on the main chart (dashed orange)
   * instead of a separate chart — confined to that zone's own pixel span,
   * positioned by interpolating each point's timestamp across the zone's
   * period rather than by array index, so it still draws even for
   * timestamps that have no materialized Reading row (true gaps).
   */
  previewPoints?: PreviewPoint[];
}

export default function QualityChart({
  points,
  unit,
  granularity,
  height,
  zones = [],
  selectedZoneId = null,
  onSelectZone,
  previewPoints = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastIndex = Math.max(points.length - 1, 0);
  const [range, setRange] = useState<[number, number]>([0, lastIndex]);

  // Reset the zoom whenever a different series is loaded (new meter/import).
  useEffect(() => {
    setRange([0, Math.max(points.length - 1, 0)]);
  }, [points]);

  const [start, end] = range;
  const visiblePoints = useMemo(() => points.slice(start, end + 1), [points, start, end]);
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
    const usableWidth = Math.max(rect.width - MARGIN.left - MARGIN.right, 1);
    const f = (clientX - rect.left - MARGIN.left) / usableWidth;
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
    const usableWidth = Math.max(rect.width - MARGIN.left - MARGIN.right, 1);
    const lo = Math.min(dragVisual[0], dragVisual[1]);
    const hi = Math.max(dragVisual[0], dragVisual[1]);
    return {
      left: `${MARGIN.left + lo * usableWidth}px`,
      width: `${(hi - lo) * usableWidth}px`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragVisual]);

  // --- hover tooltip (plain React handler; gated off while drag-zooming) ---
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null);

  function onMouseMoveReact(e: React.MouseEvent<HTMLDivElement>) {
    if (dragStateRef.current || visiblePoints.length === 0) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const plotW = Math.max(rect.width - MARGIN.left - MARGIN.right, 1);
    const relX = e.clientX - rect.left - MARGIN.left;
    if (relX < -4 || relX > plotW + 4) {
      setHover(null);
      return;
    }
    const n = visiblePoints.length;
    const i = Math.min(Math.max(Math.round((relX / plotW) * (n - 1)), 0), n - 1);
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, i });
  }

  function onMouseLeaveReact() {
    if (!dragStateRef.current) setHover(null);
  }

  // --- clickable problem zones ---
  // Index ranges are computed against the FULL points array (not the
  // zoomed-in visible slice) once per points/zones change, then converted
  // to visible-slice pixel ranges on every draw() for hit-testing clicks.
  const zoneIndexRanges = useMemo(() => {
    if (zones.length === 0) return [];
    const times = points.map((p) => +new Date(p.timestamp));
    return zones
      .map((z) => {
        const startIdx = lowerBound(times, +new Date(z.period_start));
        const endIdx = upperBound(times, +new Date(z.period_end));
        return { id: z.id, resolution: z.resolution, startIdx, endIdx };
      })
      .filter((z) => z.endIdx >= z.startIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, zones]);

  const zonesPxRef = useRef<{ id: string; x1: number; x2: number }[]>([]);
  const onSelectZoneRef = useRef(onSelectZone);
  useEffect(() => {
    onSelectZoneRef.current = onSelectZone;
  }, [onSelectZone]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onClick(e: globalThis.MouseEvent) {
      if (!onSelectZoneRef.current) return;
      const rect = el!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hit = zonesPxRef.current.find((z) => x >= z.x1 && x <= z.x2);
      onSelectZoneRef.current(hit ? hit.id : null);
    }
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  // --- canvas drawing ---
  function draw() {
    const canvas = canvasRef.current;
    const wrap = containerRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const plotLeft = MARGIN.left;
    const plotTop = MARGIN.top;
    const plotW = Math.max(w - MARGIN.left - MARGIN.right, 1);
    const plotH = Math.max(h - MARGIN.top - MARGIN.bottom, 1);

    const n = visiblePoints.length;
    if (n === 0) return;

    const values = visiblePoints.map((p) => (p.quality === "manquante" || p.value === null ? NaN : p.value));
    const finite = values.filter((v): v is number => Number.isFinite(v));
    const previewFinite = previewPoints
      .map((p) => p.proposed_value)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const allFinite = finite.concat(previewFinite);
    let yMin = allFinite.length ? Math.min(...allFinite) : 0;
    let yMax = allFinite.length ? Math.max(...allFinite) : 1;
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;

    const xAt = (i: number) => plotLeft + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yAt = (v: number) => plotTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // horizontal gridlines + y-axis tick labels
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const yTicks = 4;
    for (let t = 0; t <= yTicks; t++) {
      const v = yMin + ((yMax - yMin) * t) / yTicks;
      const y = yAt(v);
      ctx.strokeStyle = "#eef0f3";
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotW, y);
      ctx.stroke();
      ctx.fillStyle = "#6b7280";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatNumber(v), plotLeft - 8, y);
    }

    // unit label, rotated along the left edge
    ctx.save();
    ctx.translate(12, plotTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(unit, 0, 0);
    ctx.restore();

    const halfStep = n > 1 ? plotW / (n - 1) / 2 : 6;

    if (zoneIndexRanges.length > 0) {
      // Clickable problem zones (step 2 of the wizard): colored by
      // resolution status, with a stronger outline on the selected one.
      const zonesPx: { id: string; x1: number; x2: number }[] = [];
      for (const z of zoneIndexRanges) {
        const visStart = z.startIdx - start;
        const visEnd = z.endIdx - start;
        if (visEnd < 0 || visStart > n - 1) continue;
        const x1 = xAt(Math.max(visStart, 0)) - halfStep;
        const x2 = xAt(Math.min(visEnd, n - 1)) + halfStep;
        const colors = ZONE_COLORS[z.resolution];
        ctx.fillStyle = colors.fill;
        ctx.fillRect(x1, plotTop, x2 - x1, plotH);
        const selected = z.id === selectedZoneId;
        ctx.strokeStyle = selected ? "#0f4c75" : colors.stroke;
        ctx.lineWidth = selected ? 2.5 : 1.2;
        ctx.setLineDash(selected ? [] : [4, 3]);
        ctx.strokeRect(x1, plotTop, x2 - x1, plotH);
        ctx.setLineDash([]);
        zonesPx.push({ id: z.id, x1, x2 });
      }
      zonesPxRef.current = zonesPx;
    } else {
      zonesPxRef.current = [];
      // No zones to review here (e.g. step 1's read-only preview): fall
      // back to plain shaded bands for contiguous "manquante" runs.
      ctx.fillStyle = "rgba(156,163,175,0.18)";
      let bandStart: number | null = null;
      for (let i = 0; i <= n; i++) {
        const missing = i < n && visiblePoints[i].quality === "manquante";
        if (missing && bandStart === null) bandStart = i;
        if (!missing && bandStart !== null) {
          const x1 = xAt(bandStart) - halfStep;
          const x2 = xAt(i - 1) + halfStep;
          ctx.fillRect(x1, plotTop, x2 - x1, plotH);
          bandStart = null;
        }
      }
    }

    // the value line itself — skip across NaN (missing) gaps, matching the
    // previous connectNulls={false} behaviour
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      const x = xAt(i);
      const y = yAt(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // red dots for flagged incoherence points
    for (let i = 0; i < n; i++) {
      if (visiblePoints[i].quality !== "incoherence") continue;
      const x = xAt(i);
      const y = yAt(visiblePoints[i].value ?? 0);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    // Correction-preview overlay: dashed orange line + markers, confined
    // to the selected zone's own pixel span. Positioned by each point's
    // relative timestamp within the zone's period rather than by array
    // index, so it still draws for timestamps absent from `points` (a
    // true gap that was never materialized as a Reading row).
    if (previewPoints.length > 0 && selectedZoneId) {
      const zonePx = zonesPxRef.current.find((z) => z.id === selectedZoneId);
      const zoneMeta = zones.find((z) => z.id === selectedZoneId);
      if (zonePx && zoneMeta) {
        const zoneStartMs = +new Date(zoneMeta.period_start);
        const zoneEndMs = +new Date(zoneMeta.period_end);
        const spanMs = zoneEndMs - zoneStartMs || 1;
        const xAtPreview = (ts: string) => {
          const frac = Math.min(1, Math.max(0, (+new Date(ts) - zoneStartMs) / spanMs));
          return zonePx.x1 + frac * (zonePx.x2 - zonePx.x1);
        };
        ctx.strokeStyle = PREVIEW_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        let drawingPreview = false;
        for (const p of previewPoints) {
          if (p.proposed_value === null) {
            drawingPreview = false;
            continue;
          }
          const x = xAtPreview(p.timestamp);
          const y = yAt(p.proposed_value);
          if (!drawingPreview) {
            ctx.moveTo(x, y);
            drawingPreview = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of previewPoints) {
          if (p.proposed_value === null) continue;
          const x = xAtPreview(p.timestamp);
          const y = yAt(p.proposed_value);
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fillStyle = PREVIEW_COLOR;
          ctx.fill();
        }
      }
    }

    // x-axis tick labels, spaced so they don't overlap
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const maxLabels = Math.max(Math.floor(plotW / 70), 2);
    const step = Math.max(Math.ceil(n / maxLabels), 1);
    for (let i = 0; i < n; i += step) {
      ctx.fillText(formatTick(visiblePoints[i].timestamp, granularity), xAt(i), plotTop + plotH + 8);
    }

    // plot frame
    ctx.strokeStyle = "#e5e7eb";
    ctx.strokeRect(plotLeft, plotTop, plotW, plotH);

    // hover crosshair + highlighted point
    if (hover && hover.i >= 0 && hover.i < n) {
      const v = values[hover.i];
      const x = xAt(hover.i);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotH);
      ctx.stroke();
      if (Number.isFinite(v)) {
        const y = yAt(v);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#1d4ed8";
        ctx.fill();
      }
    }
  }

  useEffect(() => {
    draw();
    const wrap = containerRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePoints, unit, granularity, hover, zoneIndexRanges, selectedZoneId, start, previewPoints, zones]);

  const hoverTooltip = useMemo(() => {
    if (!hover) return null;
    const p = visiblePoints[hover.i];
    if (!p) return null;
    return {
      left: hover.x,
      top: Math.max(hover.y - 8, 0),
      date: new Date(p.timestamp).toLocaleString("fr-CH"),
      value: p.quality === "manquante" ? "—" : `${Number(p.value).toLocaleString("fr-CH")} ${unit}`,
    };
  }, [hover, visiblePoints, unit]);

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
        className={`relative w-full select-none ${height ?? "h-80"} ${zones.length > 0 ? "cursor-pointer" : ""}`}
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
        onMouseMove={onMouseMoveReact}
        onMouseLeave={onMouseLeaveReact}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {dragBoxStyle && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 border-x-2 border-geneva-600 bg-geneva-600/10"
            style={dragBoxStyle}
          />
        )}
        {hoverTooltip && (
          <div
            className="pointer-events-none absolute z-20 -translate-y-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: hoverTooltip.left, top: hoverTooltip.top }}
          >
            <p className="font-medium text-gray-900">{hoverTooltip.value}</p>
            <p className="text-gray-400">{hoverTooltip.date}</p>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-geneva-600" /> Valeur valide
        </span>
        {zones.length === 0 ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> Incohérence (valeur anomale)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-4 bg-gray-400/30"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(107,114,128,.5) 0, rgba(107,114,128,.5) 2px, transparent 2px, transparent 5px)",
                }}
              />
              Valeur manquante (absence de relevé)
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-red-400 bg-red-500/10" /> Zone à traiter (cliquer)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-green-500 bg-green-500/10" /> Validée en l'état
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-blue-500 bg-blue-500/10" /> Corrigée
            </span>
          </>
        )}
        {previewPoints.length > 0 && (
          <span className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden>
              <line x1="0" y1="4" x2="16" y2="4" stroke={PREVIEW_COLOR} strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            Proposition du correctif sélectionné
          </span>
        )}
      </div>
    </div>
  );
}
