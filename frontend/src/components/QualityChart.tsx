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
  const data = points.map((p) => ({
    ts: p.timestamp,
    value: p.quality === "manquante" ? null : p.value,
    quality: p.quality,
  }));

  // contiguous "manquante" bands -> shaded reference areas
  const missingBands: { x1: string; x2: string }[] = [];
  let bandStart: string | null = null;
  points.forEach((p, i) => {
    if (p.quality === "manquante") {
      if (bandStart === null) bandStart = p.timestamp;
    } else if (bandStart !== null) {
      missingBands.push({ x1: bandStart, x2: points[i - 1].timestamp });
      bandStart = null;
    }
  });
  if (bandStart !== null) missingBands.push({ x1: bandStart, x2: points[points.length - 1].timestamp });

  const IncoherenceDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.quality !== "incoherence") return null;
    return <Dot cx={cx} cy={cy} r={4.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />;
  };

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
          <XAxis
            dataKey="ts"
            tickFormatter={(ts) => formatTick(ts, granularity)}
            tick={{ fontSize: 11, fill: "#6b7280" }}
            minTickGap={30}
          />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} width={50} label={{ value: unit, angle: -90, position: "insideLeft", fontSize: 11, fill: "#6b7280" }} />
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
