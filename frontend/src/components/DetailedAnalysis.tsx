import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { api } from "../api/client";
import type { ImportBatchDetail, AnomalyOut, SeriesPoint, SynthesisOut } from "../types";
import QualityChart from "./QualityChart";
import QualityBar from "./QualityBar";
import LoadingOverlay from "./LoadingOverlay";

type Tab = "graphique" | "tableau" | "anomalies" | "manquantes" | "synthese";

const TABS: { id: Tab; label: (counts: { anomalies: number; missing: number }) => string }[] = [
  { id: "graphique", label: () => "Aperçu graphique" },
  { id: "tableau", label: () => "Tableau des données" },
  { id: "anomalies", label: (c) => `Anomalies (${c.anomalies})` },
  { id: "manquantes", label: (c) => `Valeurs manquantes (${c.missing})` },
  { id: "synthese", label: () => "Synthèse" },
];

interface Props {
  detail: ImportBatchDetail;
  onAction: () => void; // refresh parent list after reanalyze/reject
}

export default function DetailedAnalysis({ detail, onAction }: Props) {
  const navigate = useNavigate();
  const { summary, meters } = detail;
  const [tab, setTab] = useState<Tab>("graphique");
  const [selectedMeterId, setSelectedMeterId] = useState(meters[0]?.meter_id ?? "");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyOut[]>([]);
  const [synthesis, setSynthesis] = useState<SynthesisOut | null>(null);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const selectedMeter = meters.find((m) => m.meter_id === selectedMeterId) ?? meters[0];

  useEffect(() => {
    setSelectedMeterId(meters[0]?.meter_id ?? "");
  }, [summary.id]);

  useEffect(() => {
    if (!selectedMeterId) return;
    setLoadingSeries(true);
    api
      .getSeries(summary.id, selectedMeterId)
      .then(setSeries)
      .finally(() => setLoadingSeries(false));
  }, [summary.id, selectedMeterId]);

  useEffect(() => {
    api.getAnomalies(summary.id).then(setAnomalies);
    api.getSynthesis(summary.id).then(setSynthesis);
  }, [summary.id]);

  const meterAnomalies = useMemo(
    () => anomalies.filter((a) => a.meter_id === selectedMeterId),
    [anomalies, selectedMeterId]
  );
  const incoherences = meterAnomalies.filter((a) => a.type === "incoherence");
  const missing = meterAnomalies.filter((a) => a.type === "manquante");

  async function handle(action: "reanalyze" | "reject") {
    setBusy(action);
    try {
      if (action === "reanalyze") await api.reanalyze(summary.id);
      if (action === "reject") await api.reject(summary.id);
      onAction();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // The actual validation + simulation-based reconstruction happens on the
  // "Traiter et reconstruire" page (step 2) — this just hands the file over
  // to it; it's already listed there since quality analysis already gave it
  // the "à valider"/"à corriger" status.
  function goToTraitement() {
    navigate("/traitements");
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      {busy === "reanalyze" && <LoadingOverlay label="Réanalyse du fichier en cours…" />}

      <div className="flex gap-1 border-b border-gray-100 px-6 pt-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-geneva-700 text-geneva-700"
                : "text-gray-500 hover:text-gray-800"
            )}
          >
            {t.label({ anomalies: incoherences.length, missing: missing.length })}
          </button>
        ))}
      </div>

      <div className="px-6 py-5">
        {tab === "graphique" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-500">
                  Compteur
                  <select
                    className="ml-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
                    value={selectedMeterId}
                    onChange={(e) => setSelectedMeterId(e.target.value)}
                  >
                    {meters.map((m) => (
                      <option key={m.meter_id} value={m.meter_id}>
                        {m.meter_code} ({m.fluid_type} · {m.role} · {m.measurement_kind})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedMeter && (
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize text-gray-600">
                    Granularité : {selectedMeter.granularity}
                  </span>
                )}
              </div>
              {loadingSeries ? (
                <div className="flex h-80 items-center justify-center text-sm text-gray-400">Chargement…</div>
              ) : (
                selectedMeter && <QualityChart points={series} unit={selectedMeter.unit} granularity={selectedMeter.granularity} />
              )}
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Constats de qualification</h3>
              {selectedMeter && (
                <div className="space-y-2">
                  <ConstatRow
                    color="green"
                    label="Données valides"
                    count={selectedMeter.valid_count}
                    pct={selectedMeter.quality_pct}
                  />
                  <ConstatRow
                    color="red"
                    label="Incohérences détectées"
                    sub="Valeurs anormales (pics, ruptures, valeurs négatives)"
                    count={selectedMeter.incoherence_count}
                    pct={(selectedMeter.incoherence_count / Math.max(selectedMeter.total_expected, 1)) * 100}
                  />
                  <ConstatRow
                    color="amber"
                    label="Valeurs manquantes"
                    sub="Absence de relevé"
                    count={selectedMeter.missing_count}
                    pct={(selectedMeter.missing_count / Math.max(selectedMeter.total_expected, 1)) * 100}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "tableau" && (
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Horodatage</th>
                  <th className="px-4 py-2 font-medium">Valeur</th>
                  <th className="px-4 py-2 font-medium">Qualité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {series.map((p) => (
                  <tr key={p.timestamp}>
                    <td className="px-4 py-1.5 text-gray-700">{new Date(p.timestamp).toLocaleString("fr-CH")}</td>
                    <td className="px-4 py-1.5 text-gray-700">
                      {p.value === null ? "—" : `${p.value.toLocaleString("fr-CH")} ${selectedMeter?.unit ?? ""}`}
                    </td>
                    <td className="px-4 py-1.5">
                      <QualityTag quality={p.quality} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "anomalies" && <AnomalyList anomalies={incoherences} />}
        {tab === "manquantes" && <AnomalyList anomalies={missing} />}

        {tab === "synthese" && synthesis && (
          <div>
            <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile label="Qualité globale" value={`${synthesis.quality_score.toFixed(1)} %`} />
              <StatTile label="Points valides" value={synthesis.valid_points.toLocaleString("fr-CH")} />
              <StatTile label="Incohérences" value={synthesis.incoherence_points.toLocaleString("fr-CH")} tone="red" />
              <StatTile label="Manquants" value={synthesis.missing_points.toLocaleString("fr-CH")} tone="amber" />
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Compteur</th>
                    <th className="px-4 py-2 font-medium">Fluide</th>
                    <th className="px-4 py-2 font-medium">Rôle</th>
                    <th className="px-4 py-2 font-medium">Nature</th>
                    <th className="px-4 py-2 font-medium">Granularité</th>
                    <th className="px-4 py-2 font-medium">Qualité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {synthesis.by_meter.map((m) => (
                    <tr key={m.meter_id}>
                      <td className="px-4 py-2 font-medium text-gray-800">{m.meter_code}</td>
                      <td className="px-4 py-2 capitalize text-gray-600">{m.fluid_type}</td>
                      <td className="px-4 py-2 capitalize text-gray-600">{m.role}</td>
                      <td className="px-4 py-2 capitalize text-gray-600">{m.measurement_kind}</td>
                      <td className="px-4 py-2 capitalize text-gray-600">{m.granularity}</td>
                      <td className="px-4 py-2">
                        <QualityBar value={m.quality_pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <InfoIcon className="h-4 w-4 shrink-0 text-gray-400" />
            Une fois la qualification satisfaisante, passez à l'étape « Traiter et reconstruire » pour combler les
            valeurs manquantes et lisser les incohérences par simulation.
          </p>
          <div className="flex gap-2">
            <ActionButton onClick={() => handle("reanalyze")} busy={busy === "reanalyze"} variant="ghost">
              Réanalyser
            </ActionButton>
            <ActionButton onClick={() => handle("reject")} busy={busy === "reject"} variant="danger">
              Refuser le fichier
            </ActionButton>
            <ActionButton onClick={goToTraitement} busy={false} variant="primary">
              Passer au traitement →
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConstatRow({
  color,
  label,
  sub,
  count,
  pct,
}: {
  color: "green" | "red" | "amber";
  label: string;
  sub?: string;
  count: number;
  pct: number;
}) {
  const colors = {
    green: "bg-green-50 text-green-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
  }[color];
  const icon = { green: "✓", red: "⚠", amber: "🗓" }[color];
  return (
    <div className={clsx("flex items-start justify-between gap-3 rounded-lg px-3 py-2.5", colors)}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{icon}</span>
        <div>
          <div className="text-sm font-medium">{label}</div>
          {sub && <div className="text-xs opacity-80">{sub}</div>}
        </div>
      </div>
      <div className="whitespace-nowrap text-sm font-semibold">
        {count.toLocaleString("fr-CH")} ({pct.toFixed(1)} %)
      </div>
    </div>
  );
}

function QualityTag({ quality }: { quality: string }) {
  const map: Record<string, string> = {
    valide: "bg-green-50 text-green-700",
    incoherence: "bg-red-50 text-red-700",
    manquante: "bg-amber-50 text-amber-700",
    reconstruite: "bg-blue-50 text-blue-700",
  };
  const labels: Record<string, string> = {
    valide: "Valide",
    incoherence: "Incohérence",
    manquante: "Manquante",
    reconstruite: "Reconstruite",
  };
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", map[quality])}>{labels[quality]}</span>
  );
}

function AnomalyList({ anomalies }: { anomalies: AnomalyOut[] }) {
  if (anomalies.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">Aucune entrée pour ce compteur.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Période</th>
            <th className="px-4 py-2 font-medium">Nature</th>
            <th className="px-4 py-2 font-medium">Description</th>
            <th className="px-4 py-2 font-medium">Écart</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {anomalies.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap px-4 py-2 text-gray-700">
                {new Date(a.period_start).toLocaleDateString("fr-CH")}
                {a.period_start !== a.period_end && ` – ${new Date(a.period_end).toLocaleDateString("fr-CH")}`}
              </td>
              <td className="px-4 py-2 capitalize text-gray-600">{a.subtype.replace(/_/g, " ")}</td>
              <td className="px-4 py-2 text-gray-600">{a.description}</td>
              <td className="px-4 py-2 text-gray-600">{a.deviation_pct !== null ? `${a.deviation_pct.toFixed(0)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "red" | "amber" }) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={clsx(
          "mt-1 text-lg font-semibold",
          tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-gray-900"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  variant,
}: {
  children: ReactNode;
  onClick: () => void;
  busy: boolean;
  variant: "ghost" | "danger" | "primary";
}) {
  const styles = {
    ghost: "border border-gray-300 text-gray-700 hover:bg-gray-100",
    danger: "border border-red-200 text-red-600 hover:bg-red-50",
    primary: "bg-green-600 text-white hover:bg-green-700",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={clsx("rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50", styles)}
    >
      {busy ? "…" : children}
    </button>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v5.5M12 8v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
