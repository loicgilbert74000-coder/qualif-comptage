import { useMemo, useState } from "react";
import type { CorrectionPreviewPoint } from "../types";

// Validated categorical palette, slots 1 & 2 (blue/orange) — run through
// scripts/validate_palette.js "#2a78d6,#eb6834" --mode light: passes every
// check (chroma floor, CVD separation, normal-vision floor, contrast).
// Secondary encoding (solid vs. dashed line, filled vs. ring marker) keeps
// the two series distinguishable even without color.
const COLOR_CURRENT = "#2a78d6"; // blue — "what's there today"
const COLOR_PROPOSED = "#eb6834"; // orange — "what this correctif would write"

const WIDTH = 560;
const HEIGHT = 170;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 26;

export default function CorrectionPreviewChart({ points }: { points: CorrectionPreviewPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const values = useMemo(
    () => points.flatMap((p) => [p.current_value, p.proposed_value]).filter((v): v is number => v !== null),
    [points]
  );

  if (points.length === 0) {
    return <p className="text-xs text-gray-400">—</p>;
  }
  if (values.length === 0) {
    return <p className="text-xs text-gray-400">Aucune valeur à afficher pour cet aperçu.</p>;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const min = rawMin - span * 0.1;
  const max = rawMax + span * 0.1;

  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const x = (i: number) => PAD_LEFT + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD_TOP + innerH - ((v - min) / (max - min)) * innerH;

  function pathFor(key: "current_value" | "proposed_value"): string {
    let d = "";
    let drawing = false;
    points.forEach((p, i) => {
      const v = p[key];
      if (v === null) {
        drawing = false;
        return;
      }
      const cmd = drawing ? "L" : "M";
      d += `${cmd}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      drawing = true;
    });
    return d.trim();
  }

  // Show at most ~6 x-axis labels regardless of how many points the
  // anomaly's period contains, so a long zone doesn't turn into unreadable
  // overlapping ticks.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const gridlines = [min + (max - min) * 0.25, min + (max - min) * 0.5, min + (max - min) * 0.75];

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden>
            <line x1="0" y1="4" x2="16" y2="4" stroke={COLOR_CURRENT} strokeWidth="2" />
          </svg>
          Valeur actuelle
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden>
            <line x1="0" y1="4" x2="16" y2="4" stroke={COLOR_PROPOSED} strokeWidth="2" strokeDasharray="4 2" />
          </svg>
          Valeur proposée par ce correctif
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Comparaison entre la valeur actuelle et la valeur proposée par le correctif sélectionné"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {gridlines.map((gv, i) => (
          <g key={i}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(gv)} y2={y(gv)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD_LEFT - 6} y={y(gv) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
              {gv.toLocaleString("fr-CH", { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}

        <path d={pathFor("current_value")} fill="none" stroke={COLOR_CURRENT} strokeWidth="2" />
        <path d={pathFor("proposed_value")} fill="none" stroke={COLOR_PROPOSED} strokeWidth="2" strokeDasharray="4 2" />

        {points.map((p, i) =>
          p.current_value !== null ? (
            <circle key={`c-${i}`} cx={x(i)} cy={y(p.current_value)} r="3" fill="#fff" stroke={COLOR_CURRENT} strokeWidth="1.5" />
          ) : null
        )}
        {points.map((p, i) =>
          p.proposed_value !== null ? (
            <circle key={`p-${i}`} cx={x(i)} cy={y(p.proposed_value)} r="3.5" fill={COLOR_PROPOSED} />
          ) : null
        )}

        {points.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={x(i) - innerW / Math.max(points.length, 1) / 2}
            y={PAD_TOP}
            width={innerW / Math.max(points.length, 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {hoverIdx !== null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD_TOP} y2={PAD_TOP + innerH} stroke="#9ca3af" strokeWidth="1" strokeDasharray="2 2" />
        )}

        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={`lbl-${i}`} x={x(i)} y={HEIGHT - 8} textAnchor="middle" fontSize="9" fill="#9ca3af">
              {new Date(p.timestamp).toLocaleString("fr-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </text>
          ) : null
        )}
      </svg>

      <div className="mt-1 h-5 text-xs text-gray-600">
        {hovered && (
          <span>
            {new Date(hovered.timestamp).toLocaleString("fr-CH")} — actuelle :{" "}
            <span className="font-medium text-gray-700">{hovered.current_value?.toLocaleString("fr-CH") ?? "—"}</span> · proposée :{" "}
            <span className="font-medium text-gray-700">{hovered.proposed_value?.toLocaleString("fr-CH") ?? "—"}</span>
          </span>
        )}
      </div>
    </div>
  );
}
