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
  if (granularity === "horaire") return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit" });
  if (granularity === "mensuelle") return d.toLocaleDateString("fr-CH", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("fr-CH", { day: "2-digit", month: "short" });
}

function formatNumber(v: number) {
  return v.toLocaleString("fr-CH", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 });
}

interface Props {
  points: SeriesPoint[];
  unit: string;
  granularity: string;
}

export default function QualityChart({ points, unit, granularity }: Props) {
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
    let yMin = finite.length ? Math.min(...finite) : 0;
    let yMax = finite.length ? Math.max(...finite) : 1;
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

    // shaded bands for contiguous "manquante" runs
    ctx.fillStyle = "rgba(156,163,175,0.18)";
    const halfStep = n > 1 ? plotW / (n - 1) / 2 : 6;
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
  }, [visiblePoints, unit, granularity, hover]);

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
        className="relative h-80 w-full select-none"
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
      <div className="mt-2 flex items-center gap-6 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-geneva-600" /> Valeur valide
        </span>
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
      </div>
    </div>
  );
}
