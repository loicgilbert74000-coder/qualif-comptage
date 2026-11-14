import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import clsx from "clsx";
import TopBar from "../components/TopBar";
import QualityChart from "../components/QualityChart";
import type { ChartZone } from "../components/QualityChart";
import LoadingOverlay from "../components/LoadingOverlay";
import CorrectionPreviewChart from "../components/CorrectionPreviewChart";
import { api } from "../api/client";
import type {
  ImportBatchDetail,
  AnomalyOut,
  SeriesPoint,
  AnomalyResolution,
  CorrectionOption,
  CorrectionPreviewPoint,
} from "../types";

const RESOLUTION_LABEL: Record<AnomalyResolution, string> = {
  en_attente: "À traiter",
  validee: "Validée",
  corrigee: "Corrigée",
};
const RESOLUTION_STYLE: Record<AnomalyResolution, string> = {
  en_attente: "bg-red-50 text-red-700",
  validee: "bg-green-50 text-green-700",
  corrigee: "bg-blue-50 text-blue-700",
};

export default function TraitementDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyOut[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState("");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `resolve:<id>` | "finalize"
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    if (!batchId) return;
    const [d, a] = await Promise.all([api.getImport(batchId), api.getAnomalies(batchId)]);
    setDetail(d);
    setAnomalies(a);
    setSelectedMeterId((cur) => cur || d.meters[0]?.meter_id || "");
  }

  useEffect(() => {
    setLoadError(null);
    refresh().catch((e) => setLoadError((e as Error).message || "Le chargement du dossier a échoué."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function loadSeries() {
    if (!batchId || !selectedMeterId) return;
    setLoadingSeries(true);
    try {
      setSeries(await api.getSeries(batchId, selectedMeterId));
    } catch (e) {
      setLoadError((e as Error).message || "Le chargement de la courbe a échoué.");
    } finally {
      setLoadingSeries(false);
    }
  }

  useEffect(() => {
    loadSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, selectedMeterId]);

  const selectedMeter = detail?.meters.find((m) => m.meter_id === selectedMeterId);
  const meterAnomalies = useMemo(
    () => anomalies.filter((a) => a.meter_id === selectedMeterId),
    [anomalies, selectedMeterId]
  );
  const selectedAnomaly = anomalies.find((a) => a.id === selectedZoneId) ?? null;

  const pendingCount = anomalies.filter((a) => a.resolution === "en_attente").length;

  const pendingByMeter = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of anomalies) {
      if (a.resolution !== "en_attente") continue;
      counts.set(a.meter_id, (counts.get(a.meter_id) ?? 0) + 1);
    }
    return counts;
  }, [anomalies]);

  const metersWithPending = (detail?.meters ?? []).filter(
    (m) => !m.saved && (pendingByMeter.get(m.meter_id) ?? 0) > 0
  );

  // Save is per meter, not per dossier: a folder import can hold many
  // meters, and forcing every one of them to be treated before any curve
  // could be saved made the whole dossier feel stuck. Each meter can be
  // saved as soon as ITS OWN zones are treated.
  const meterPendingCount = pendingByMeter.get(selectedMeterId) ?? 0;
  const meterResolved = meterPendingCount === 0;
  const meterSaved = selectedMeter?.saved ?? false;
  const savedMeterCount = (detail?.meters ?? []).filter((m) => m.saved).length;
  const totalMeterCount = detail?.meters.length ?? 0;

  const zones: ChartZone[] = meterAnomalies.map((a) => ({
    id: a.id,
    period_start: a.period_start,
    period_end: a.period_end,
    resolution: a.resolution,
  }));

  async function resolve(resolution: "validee" | "corrigee", method?: string) {
    if (!batchId || !selectedAnomaly) return;
    setBusy(`resolve:${selectedAnomaly.id}`);
    setError(null);
    try {
      await api.resolveAnomaly(batchId, selectedAnomaly.id, resolution, method);
      await Promise.all([refresh(), loadSeries()]);
      setSelectedZoneId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveMeter() {
    if (!batchId || !selectedMeterId) return;
    setBusy("finalize");
    setError(null);
    try {
      const result = await api.validateMeter(batchId, selectedMeterId);
      if (result.batch_complete) {
        navigate("/traitements");
        return;
      }
      await refresh();
      // Jump straight to the next meter that still needs treatment, so
      // several meters can be saved one after another without having to
      // hunt for the next one manually.
      const next = metersWithPending.find((m) => m.meter_id !== selectedMeterId);
      if (next) {
        setSelectedMeterId(next.meter_id);
        setSelectedZoneId(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 text-sm text-gray-400">
        {loadError ? (
          <>
            <p className="max-w-md text-center text-red-600">{loadError}</p>
            <button
              onClick={() => {
                setLoadError(null);
                refresh().catch((e) => setLoadError((e as Error).message || "Le chargement du dossier a échoué."));
              }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Réessayer
            </button>
          </>
        ) : (
          "Chargement…"
        )}
      </div>
    );
  }

  const { summary, meters } = detail;

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      {busy === "finalize" && <LoadingOverlay label="Enregistrement de la courbe en base de données…" />}

      <TopBar
        title={summary.name}
        subtitle="Traiter et reconstruire — sélectionnez chaque zone signalée pour la valider ou la corriger, puis enregistrez."
      />

      <div className="flex-1 space-y-5 px-8 pb-10 pt-6">
        <Link to="/traitements" className="text-sm text-geneva-700 hover:underline">
          ← Retour aux traitements
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-500">
            Compteur
            <select
              className="ml-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
              value={selectedMeterId}
              onChange={(e) => {
                setSelectedMeterId(e.target.value);
                setSelectedZoneId(null);
              }}
            >
              {meters.map((m) => {
                const n = pendingByMeter.get(m.meter_id) ?? 0;
                return (
                  <option key={m.meter_id} value={m.meter_id}>
                    {m.meter_code} ({m.fluid_type} · {m.role})
                    {m.saved ? " — enregistré" : n > 0 ? ` — ${n} à traiter` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {anomalies.length - pendingCount} / {anomalies.length} zone(s) traitée(s) pour ce dossier
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {savedMeterCount} / {totalMeterCount} compteur(s) enregistré(s)
          </span>
        </div>

        {metersWithPending.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span className="font-medium">
              {meterAnomalies.length === 0 && selectedMeterId
                ? "Ce compteur n'a plus de zone à traiter — il reste des zones sur :"
                : "Compteurs avec des zones encore à traiter :"}
            </span>
            {metersWithPending.map((m) => (
              <button
                key={m.meter_id}
                onClick={() => {
                  setSelectedMeterId(m.meter_id);
                  setSelectedZoneId(null);
                }}
                className={clsx(
                  "rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100",
                  m.meter_id === selectedMeterId && "bg-amber-100"
                )}
              >
                {m.meter_code} ({pendingByMeter.get(m.meter_id)})
              </button>
            ))}
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {/* Diagnostic + proposition de résolution, au-dessus de la courbe */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {selectedAnomaly ? (
            <DiagnosisPanel
              batchId={batchId ?? ""}
              anomaly={selectedAnomaly}
              busy={busy === `resolve:${selectedAnomaly.id}`}
              onValidate={() => resolve("validee")}
              onCorrect={(method) => resolve("corrigee", method)}
            />
          ) : (
            <div>
              <p className="text-sm font-semibold text-gray-900">Aucune zone sélectionnée</p>
              <p className="mt-1 text-sm text-gray-500">
                {meterAnomalies.length === 0
                  ? "Aucune zone à traiter pour ce compteur."
                  : "Cliquez sur une zone colorée dans la courbe ci-dessous (ou dans la liste en bas de page) pour afficher le diagnostic et choisir une résolution."}
              </p>
            </div>
          )}
        </section>

        {loadingSeries ? (
          <div className="flex h-[30rem] items-center justify-center text-sm text-gray-400">Chargement…</div>
        ) : (
          selectedMeter && (
            <QualityChart
              points={series}
              unit={selectedMeter.unit}
              granularity={selectedMeter.granularity}
              height="h-[30rem]"
              zones={zones}
              selectedZoneId={selectedZoneId}
              onSelectZone={setSelectedZoneId}
            />
          )
        )}

        {meterAnomalies.length > 0 && (
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Zones de ce compteur</h3>
            <div className="divide-y divide-gray-100">
              {meterAnomalies.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedZoneId(a.id)}
                  className={clsx(
                    "flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left text-sm transition-colors hover:bg-gray-50",
                    selectedZoneId === a.id && "bg-geneva-50"
                  )}
                >
                  <span className="text-gray-700">
                    {a.description}
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(a.period_start).toLocaleDateString("fr-CH")}
                      {a.period_start !== a.period_end && ` – ${new Date(a.period_end).toLocaleDateString("fr-CH")}`}
                    </span>
                  </span>
                  <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", RESOLUTION_STYLE[a.resolution])}>
                    {RESOLUTION_LABEL[a.resolution]}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">
            {meterSaved
              ? "La courbe de ce compteur a déjà été enregistrée en base de données."
              : meterResolved
              ? "Toutes les zones de ce compteur ont été validées ou corrigées : sa courbe peut être enregistrée dès maintenant, sans attendre les autres compteurs du dossier."
              : `${meterPendingCount} zone(s) de ce compteur encore à traiter avant de pouvoir l'enregistrer.`}
          </p>
          <button
            onClick={saveMeter}
            disabled={!meterResolved || meterSaved || busy === "finalize"}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy === "finalize" ? "…" : meterSaved ? "Compteur déjà enregistré" : "Enregistrer la courbe de ce compteur"}
          </button>
        </section>

        <p className="text-xs text-gray-400">
          L'échantillonnage utilisé lors de l'enregistrement (fréquence conservée en base selon le type de compteur)
          reste à définir ; les données sont pour l'instant enregistrées au pas détecté à l'import.
        </p>
      </div>
    </div>
  );
}

function DiagnosisPanel({
  batchId,
  anomaly,
  busy,
  onValidate,
  onCorrect,
}: {
  batchId: string;
  anomaly: AnomalyOut;
  busy: boolean;
  onValidate: () => void;
  onCorrect: (method: string) => void;
}) {
  const resolved = anomaly.resolution !== "en_attente";
  const correctionPrimary = anomaly.recommended_action !== "valider";

  const [options, setOptions] = useState<CorrectionOption[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [preview, setPreview] = useState<CorrectionPreviewPoint[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    setOptions([]);
    setSelectedMethod("");
    setPreview([]);
    if (resolved || !batchId) return;
    setLoadingOptions(true);
    api
      .getCorrectionOptions(batchId, anomaly.id)
      .then((opts) => {
        setOptions(opts);
        setSelectedMethod(opts[0]?.method ?? "");
      })
      .finally(() => setLoadingOptions(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, anomaly.id, resolved]);

  useEffect(() => {
    setPreview([]);
    if (!selectedMethod || !batchId || resolved) return;
    setLoadingPreview(true);
    api
      .getCorrectionPreview(batchId, anomaly.id, selectedMethod)
      .then(setPreview)
      .finally(() => setLoadingPreview(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, anomaly.id, selectedMethod, resolved]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", RESOLUTION_STYLE[anomaly.resolution])}>
          {RESOLUTION_LABEL[anomaly.resolution]}
        </span>
        <span className="text-sm font-semibold text-gray-900">{anomaly.description}</span>
        <span className="text-xs text-gray-400">
          {new Date(anomaly.period_start).toLocaleString("fr-CH")}
          {anomaly.period_start !== anomaly.period_end && ` – ${new Date(anomaly.period_end).toLocaleString("fr-CH")}`}
        </span>
      </div>

      <div className="rounded-lg bg-gray-50 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-geneva-700">
          <AiIcon className="h-3.5 w-3.5" />
          Diagnostic proposé par l'IA (en apprentissage — information à titre indicatif, pas une décision automatique)
        </div>
        <p className="text-sm text-gray-700">{anomaly.diagnosis}</p>
        <p className="mt-1.5 text-sm text-gray-600">
          <span className="font-medium text-gray-700">Proposition : </span>
          {anomaly.suggestion}
        </p>
      </div>

      {!resolved ? (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500">
              Choisissez un correctif — adapté au type de compteur ({anomaly.meter_code}) :
            </p>
            {loadingOptions ? (
              <p className="text-xs text-gray-400">Chargement des correctifs disponibles…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {options.map((opt, i) => (
                  <button
                    key={opt.method}
                    type="button"
                    onClick={() => setSelectedMethod(opt.method)}
                    title={opt.description}
                    className={clsx(
                      "rounded-lg border px-3 py-1.5 text-left text-xs font-medium",
                      selectedMethod === opt.method
                        ? "border-geneva-700 bg-geneva-50 text-geneva-800"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    )}
                  >
                    {opt.label}
                    {i === 0 && <span className="ml-1 font-normal text-geneva-600">(recommandé)</span>}
                  </button>
                ))}
              </div>
            )}
            {options.find((o) => o.method === selectedMethod) && (
              <p className="mt-1.5 text-xs text-gray-500">
                {options.find((o) => o.method === selectedMethod)!.description}
              </p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500">Aperçu du correctif avant application :</p>
            {loadingPreview ? (
              <p className="text-xs text-gray-400">Calcul de l'aperçu…</p>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <CorrectionPreviewChart points={preview} />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onCorrect(selectedMethod)}
              disabled={busy || !selectedMethod}
              className={clsx(
                "rounded-lg px-3.5 py-1.5 text-sm font-medium disabled:opacity-50",
                correctionPrimary
                  ? "bg-geneva-700 text-white hover:bg-geneva-800"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-100"
              )}
            >
              {busy ? "…" : "Appliquer ce correctif"}
            </button>
            <button
              onClick={onValidate}
              disabled={busy}
              className={clsx(
                "rounded-lg px-3.5 py-1.5 text-sm font-medium disabled:opacity-50",
                !correctionPrimary
                  ? "bg-geneva-700 text-white hover:bg-geneva-800"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-100"
              )}
            >
              {busy ? "…" : "Valider en l'état"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-400">
          Zone déjà traitée — sélectionnez une autre zone depuis la courbe ou la liste ci-dessous pour continuer.
        </p>
      )}
    </div>
  );
}

function AiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"
        fill="currentColor"
      />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" fill="currentColor" />
    </svg>
  );
}
