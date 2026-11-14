import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import TopBar from "../components/TopBar";
import StepIndicator from "../components/StepIndicator";
import QualityBar from "../components/QualityBar";
import { api } from "../api/client";
import type { ImportBatchDetail } from "../types";

export default function ExportPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId) return;
    setLoadError(null);
    api
      .getImport(batchId)
      .then(setDetail)
      .catch((e) => setLoadError((e as Error).message || "Le chargement du dossier a échoué."));
  }, [batchId]);

  async function handleExport(format: "csv" | "json") {
    if (!batchId) return;
    setBusy(format);
    setError(null);
    try {
      const { blob, filename } = await api.exportBatch(batchId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-1 flex-col">
        <TopBar title="Valider et exporter" />
        <StepIndicator current={3} />
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
          {loadError ? <p className="text-red-600">{loadError}</p> : "Chargement…"}
        </div>
      </div>
    );
  }

  const { summary, building_name, meters } = detail;
  const qualifiedMeters = meters.filter((m) => m.saved);
  const pendingMeters = meters.filter((m) => !m.saved);
  const notReady = qualifiedMeters.length === 0;

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title={summary.name}
        subtitle="Valider et exporter — les compteurs déjà qualifiés sont exportables dès maintenant, sans attendre les autres."
      />
      <StepIndicator current={3} />

      <div className="flex-1 space-y-5 px-8 pb-10 pt-6">
        <Link to="/traitements" className="text-sm text-geneva-700 hover:underline">
          ← Retour aux traitements
        </Link>

        {notReady ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            Aucun compteur de ce dossier n'est encore qualifié — qualifiez au moins un compteur pour pouvoir
            l'exporter.{" "}
            <Link to={`/traitements/${batchId}`} className="font-medium underline">
              Reprendre le traitement →
            </Link>
          </section>
        ) : (
          <>
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Résumé du dossier</h2>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-gray-400">Bâtiment</dt>
                  <dd className="font-medium text-gray-800">{building_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-400">Compteurs qualifiés</dt>
                  <dd className="font-medium text-gray-800">
                    {qualifiedMeters.length} / {meters.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Période</dt>
                  <dd className="font-medium text-gray-800">
                    {summary.period_start ? new Date(summary.period_start).toLocaleDateString("fr-CH") : "—"} –{" "}
                    {summary.period_end ? new Date(summary.period_end).toLocaleDateString("fr-CH") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 text-gray-400">Qualité du dossier</dt>
                  <dd>
                    <QualityBar value={summary.quality_score} invalid={summary.status === "refuse" || summary.status === "deja_traite"} />
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Compteurs de ce dossier</h2>
              <ul className="divide-y divide-gray-100 text-sm">
                {meters.map((m) => (
                  <li key={m.meter_id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-gray-700">
                      {m.meter_code}
                      <span className="ml-2 text-xs text-gray-400">
                        ({m.fluid_type} · {m.role})
                      </span>
                    </span>
                    <span
                      className={
                        m.saved
                          ? "rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                          : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500"
                      }
                    >
                      {m.saved ? "Qualifié — inclus dans l'export" : "En attente de traitement"}
                    </span>
                  </li>
                ))}
              </ul>
              {pendingMeters.length > 0 && (
                <p className="mt-3 text-xs text-gray-400">
                  {pendingMeters.length} compteur(s) pas encore qualifié(s) — ils rejoindront automatiquement
                  l'export dès qu'ils seront traités.{" "}
                  <Link to={`/traitements/${batchId}`} className="underline">
                    Continuer le traitement →
                  </Link>
                </p>
              )}
            </section>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Exporter les données qualifiées</h2>
              <p className="mb-4 text-sm text-gray-500">
                Une ligne par relevé, pour chacun des {qualifiedMeters.length} compteur(s) déjà qualifié(s) —
                valeur finale (après reconstruction) et valeur brute d'origine.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleExport("csv")}
                  disabled={busy !== null}
                  className="rounded-lg bg-geneva-700 px-4 py-2 text-sm font-medium text-white hover:bg-geneva-800 disabled:opacity-50"
                >
                  {busy === "csv" ? "Export en cours…" : "⬇ Exporter en CSV"}
                </button>
                <button
                  onClick={() => handleExport("json")}
                  disabled={busy !== null}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {busy === "json" ? "Export en cours…" : "⬇ Exporter en JSON"}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
