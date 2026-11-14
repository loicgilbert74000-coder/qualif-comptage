import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import clsx from "clsx";
import TopBar from "../components/TopBar";
import StepIndicator from "../components/StepIndicator";
import QualityChart from "../components/QualityChart";
import QualifAIChatDialog from "../components/QualifAIChatDialog";
import { useQualifAI } from "../context/QualifAIContext";
import type { AIPreviewPoint, ChartZone, PreviewPoint } from "../components/QualityChart";
import LoadingOverlay from "../components/LoadingOverlay";
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
  const location = useLocation();
  // The meter selected on the Qualification page ("page principale"), if
  // we were sent here from there — see DetailedAnalysis.goToTraitement().
  // Treated first instead of defaulting to the batch's first meter.
  const incomingMeterId = (location.state as { meterId?: string } | null)?.meterId;
  const qualifAI = useQualifAI();

  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyOut[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState(incomingMeterId ?? "");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [previewPoints, setPreviewPoints] = useState<PreviewPoint[]>([]);
  const [aiDemoPoints, setAiDemoPoints] = useState<AIPreviewPoint[]>([]);
  const [aiDemoFitPct, setAiDemoFitPct] = useState<number | null>(null);
  const [aiDemoLoading, setAiDemoLoading] = useState(false);
  const autoSelectedAIMeter = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `resolve:<id>` | "finalize"
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    if (!batchId) return;
    const [d, a] = await Promise.all([api.getImport(batchId), api.getAnomalies(batchId)]);
    setDetail(d);
    setAnomalies(a);
    setSelectedMeterId((cur) => {
      if (cur) return cur;
      const incomingIsAIDemo = d.meters.some((meter) => meter.meter_id === incomingMeterId && meter.meter_code.toUpperCase().startsWith("DEMO-GENEVE-IA-"));
      const preferred = incomingMeterId && d.meters.some((m) => m.meter_id === incomingMeterId) && !incomingIsAIDemo ? incomingMeterId : null;
      const demoPV = d.meters.find((meter) => meter.meter_code.toUpperCase().startsWith("DEMO-GENEVE-IA-PV"))?.meter_id;
      return preferred ?? demoPV ?? d.meters[0]?.meter_id ?? "";
    });
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
  const isGenevaAIDemo = selectedMeter?.meter_code.toUpperCase().startsWith("DEMO-GENEVE-IA-") ?? false;
  const showQualifAIDemo = isGenevaAIDemo && qualifAI.enabled && qualifAI.suggestionsEnabled;
  const aiDemoCloseCount = aiDemoPoints.filter((point) =>
    typeof point.current_value === "number" && typeof point.proposed_value === "number"
    && Math.abs(point.proposed_value - point.current_value) <= Math.max(Math.abs(point.current_value), 0.1) * 0.25
  ).length;
  const aiDemoReviewCount = Math.max(aiDemoPoints.length - aiDemoCloseCount, 0);
  const selectedAnomaly = anomalies.find((a) => a.id === selectedZoneId) ?? null;

  // The dedicated demo file opens on its first anomaly so the audience sees
  // both the base signal and the Qualif IA overlay immediately.
  useEffect(() => {
    if (!isGenevaAIDemo || !selectedMeterId || autoSelectedAIMeter.current === selectedMeterId) return;
    const pending = meterAnomalies.filter((anomaly) => anomaly.resolution === "en_attente");
    const firstPending = pending.find((anomaly) => ["pic", "consommation_haute"].includes(anomaly.subtype)) ?? pending[0];
    if (!firstPending) return;
    autoSelectedAIMeter.current = selectedMeterId;
    setSelectedZoneId(firstPending.id);
    setPreviewPoints([]);
  }, [isGenevaAIDemo, selectedMeterId, meterAnomalies]);

  // Demonstration-only Qualif IA layer: request the Geneva-adjusted profile
  // for every base anomaly, then display its estimates together on the chart.
  useEffect(() => {
    if (!batchId || !showQualifAIDemo || meterAnomalies.length === 0) {
      setAiDemoPoints([]);
      setAiDemoFitPct(null);
      setAiDemoLoading(false);
      return;
    }
    let cancelled = false;
    setAiDemoLoading(true);
    Promise.all(meterAnomalies.map(async (anomaly) => {
      try {
        const options = await api.getCorrectionOptions(batchId, anomaly.id);
        const weatherOption = options
          .filter((option) => option.method.startsWith("meteo_") && option.model_fit_pct !== null)
          .sort((a, b) => (b.model_fit_pct ?? -1) - (a.model_fit_pct ?? -1))[0];
        if (!weatherOption) return { points: [] as AIPreviewPoint[], fit: null as number | null };
        const preview = await api.getCorrectionPreview(batchId, anomaly.id, weatherOption.method);
        return {
          points: preview.map((point) => ({
            timestamp: point.timestamp,
            proposed_value: point.proposed_value,
            current_value: point.current_value,
          })),
          fit: weatherOption.model_fit_pct,
        };
      } catch {
        return { points: [] as AIPreviewPoint[], fit: null as number | null };
      }
    })).then((results) => {
      if (cancelled) return;
      setAiDemoPoints(results.flatMap((result) => result.points).sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
      const fits = results.map((result) => result.fit).filter((fit): fit is number => fit !== null);
      setAiDemoFitPct(fits.length ? Math.round(fits.reduce((sum, fit) => sum + fit, 0) / fits.length * 10) / 10 : null);
      setAiDemoLoading(false);
    });
    return () => { cancelled = true; };
  }, [batchId, showQualifAIDemo, selectedMeterId, meterAnomalies]);

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

  // Clears the correction-preview overlay whenever the selected zone
  // changes, so a stale preview for the previous zone never gets drawn
  // inside the newly-selected zone's pixel span while DiagnosisPanel
  // fetches the new one.
  function selectZone(id: string | null) {
    setSelectedZoneId(id);
    setPreviewPoints([]);
  }

  async function resolve(resolution: "validee" | "corrigee", method?: string, comment?: string) {
    if (!batchId || !selectedAnomaly) return;
    setBusy(`resolve:${selectedAnomaly.id}`);
    setError(null);
    try {
      const decisionComment = comment?.trim() || (
        resolution === "validee" ? qualifAI.getLatestUserMessage(selectedAnomaly.id) : undefined
      );
      await api.resolveAnomaly(batchId, selectedAnomaly.id, resolution, method, decisionComment);
      const meter = detail?.meters.find((item) => item.meter_id === selectedAnomaly.meter_id);
      qualifAI.recordDecision({
        anomalyId: selectedAnomaly.id,
        meterCode: selectedAnomaly.meter_code,
        fluidType: meter?.fluid_type ?? "inconnu",
        role: meter?.role ?? "général",
        subtype: selectedAnomaly.subtype,
        decision: resolution,
        method: resolution === "corrigee" ? method : undefined,
        comment: decisionComment,
      });
      await Promise.all([refresh(), loadSeries()]);
      selectZone(null);
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
        // Every meter of this dossier is now saved — move on to step 3
        // ("Valider et exporter") instead of back to the plain list.
        navigate(`/traitements/${batchId}/export`);
        return;
      }
      await refresh();
      // Jump straight to the next meter that still needs treatment, so
      // several meters can be saved one after another without having to
      // hunt for the next one manually.
      const next = metersWithPending.find((m) => m.meter_id !== selectedMeterId);
      if (next) {
        setSelectedMeterId(next.meter_id);
        selectZone(null);
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
      {busy === "finalize" && <LoadingOverlay label="Qualification du compteur en cours…" />}

      <TopBar
        title={summary.name}
        subtitle="Traiter et reconstruire — sélectionnez chaque zone signalée pour la valider ou la corriger, puis enregistrez."
      />
      <StepIndicator current={2} />

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
                selectZone(null);
              }}
            >
              {meters.map((m) => {
                const n = pendingByMeter.get(m.meter_id) ?? 0;
                return (
                  <option key={m.meter_id} value={m.meter_id}>
                    {m.meter_code} ({m.fluid_type} · {m.role})
                    {m.saved ? " — qualifié" : n > 0 ? ` — ${n} à traiter` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {anomalies.length - pendingCount} / {anomalies.length} zone(s) traitée(s) pour ce dossier
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {savedMeterCount} / {totalMeterCount} compteur(s) qualifié(s)
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
                  selectZone(null);
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
              context={{
                anomalyId: selectedAnomaly.id,
                meterCode: selectedAnomaly.meter_code,
                fluidType: selectedMeter?.fluid_type ?? "inconnu",
                role: selectedMeter?.role ?? "général",
                subtype: selectedAnomaly.subtype,
              }}
              busy={busy === `resolve:${selectedAnomaly.id}`}
              onValidate={(comment) => resolve("validee", undefined, comment)}
              onCorrect={(method) => resolve("corrigee", method)}
              onPreviewChange={setPreviewPoints}
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

        {showQualifAIDemo && (
          <div className="qualif-ai-halo flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-violet-50/70 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-800">
                <span aria-hidden>✦</span>
                <span>Simulation de démonstration Qualif IA · Genève</span>
                {aiDemoFitPct !== null && <span className="qualif-ai-badge rounded-full px-2 py-0.5 text-xs">R² {aiDemoFitPct.toLocaleString("fr-CH")} %</span>}
              </div>
              <p className="mt-1 text-xs text-gray-600">
                {aiDemoLoading
                  ? "Calcul du profil météo comparé aux anomalies détectées…"
                  : `Qualif IA simule ${aiDemoCloseCount} point(s) expliqués par la météo et ${aiDemoReviewCount} écart(s) à examiner pour correction.`}
              </p>
            </div>
            <span className="text-[11px] text-violet-700">Violet pointillé = estimation IA simulée · rouge = anomalie du moteur de base</span>
          </div>
        )}

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
              onSelectZone={selectZone}
              previewPoints={previewPoints}
              aiPreviewPoints={showQualifAIDemo ? aiDemoPoints : []}
              aiZoneId={showQualifAIDemo ? selectedZoneId : null}
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
                  onClick={() => selectZone(a.id)}
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
              ? "Ce compteur a déjà été qualifié."
              : meterResolved
              ? "Toutes les zones de ce compteur ont été validées ou corrigées : il peut être qualifié dès maintenant, sans attendre les autres compteurs du dossier."
              : `${meterPendingCount} zone(s) de ce compteur encore à traiter avant de pouvoir le qualifier.`}
          </p>
          <button
            onClick={saveMeter}
            disabled={!meterResolved || meterSaved || busy === "finalize"}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy === "finalize" ? "…" : meterSaved ? "Compteur déjà qualifié" : "Qualifier ce compteur"}
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
  context,
  busy,
  onValidate,
  onCorrect,
  onPreviewChange,
}: {
  batchId: string;
  anomaly: AnomalyOut;
  context: {
    anomalyId: string;
    meterCode: string;
    fluidType: string;
    role: string;
    subtype: string;
  };
  busy: boolean;
  onValidate: (comment: string) => void;
  onCorrect: (method: string) => void;
  /** Lifts the fetched preview up to the parent, which draws it on the
   * main QualityChart inside this (selected) zone instead of a separate
   * chart here. */
  onPreviewChange: (points: CorrectionPreviewPoint[]) => void;
}) {
  const resolved = anomaly.resolution !== "en_attente";
  const correctionPrimary = anomaly.recommended_action !== "valider";

  const [options, setOptions] = useState<CorrectionOption[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [comment, setComment] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const qualifAI = useQualifAI();
  const learnedSuggestion = qualifAI.getSuggestion({
    fluidType: context.fluidType,
    role: context.role,
    subtype: context.subtype,
  }, options);
  const latestChatReason = qualifAI.getLatestUserMessage(context.anomalyId)?.trim();
  const decisionComment = comment.trim() || latestChatReason || "";

  useEffect(() => {
    setOptions([]);
    setSelectedMethod("");
    setComment("");
    setChatOpen(false);
    onPreviewChange([]);
    if (resolved || !batchId) return;
    setLoadingOptions(true);
    api
      .getCorrectionOptions(batchId, anomaly.id)
      .then((opts) => {
        setOptions(opts);
        setSelectedMethod(opts.find((option) => option.eligible)?.method ?? opts[0]?.method ?? "");
      })
      .finally(() => setLoadingOptions(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, anomaly.id, resolved]);

  useEffect(() => {
    onPreviewChange([]);
    if (!selectedMethod || !batchId || resolved) return;
    setLoadingPreview(true);
    api
      .getCorrectionPreview(batchId, anomaly.id, selectedMethod)
      .then(onPreviewChange)
      .finally(() => setLoadingPreview(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, anomaly.id, selectedMethod, resolved]);

  const selectedOption = options.find((option) => option.method === selectedMethod);
  const recommendedMethod = options.find((option) => option.eligible)?.method;
  const hasWeatherCorrection = options.some((option) => option.method.startsWith("meteo_"));

  // Cleared whenever this panel unmounts (e.g. the zone is deselected),
  // so the overlay never lingers on the main chart past this anomaly.
  useEffect(() => {
    return () => onPreviewChange([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {!resolved && learnedSuggestion && (
        <div className="qualif-ai-halo mt-3 rounded-xl border bg-violet-50/60 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-800">
            <AiIcon className="h-4 w-4" />
            <span>Suggestion Qualif IA</span>
            <span className="qualif-ai-badge rounded-full px-2 py-0.5 font-medium">{learnedSuggestion.examples} cas comparable(s)</span>
          </div>
          <p className="mt-1 text-sm font-medium text-gray-800">{learnedSuggestion.title}</p>
          <p className="mt-1 text-xs leading-5 text-gray-600">{learnedSuggestion.explanation}</p>
          {learnedSuggestion.kind === "correction" && (
            <button
              type="button"
              onClick={() => setSelectedMethod(learnedSuggestion.method ?? "")}
              className="mt-2 rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100"
            >
              Afficher cette correction
            </button>
          )}
        </div>
      )}

      {!resolved ? (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500">
              Choisissez un correctif — adapté au type de compteur ({anomaly.meter_code}) :
            </p>
            {loadingOptions ? (
              <p className="text-xs text-gray-400">Chargement des correctifs disponibles…</p>
            ) : options.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {options.map((option) => (
                  <button
                    key={option.method}
                    type="button"
                    onClick={() => setSelectedMethod(option.method)}
                    title={option.description}
                    className={clsx(
                      "rounded-lg border px-3 py-2 text-left",
                      learnedSuggestion?.kind === "correction" && learnedSuggestion.method === option.method && "qualif-ai-halo",
                      selectedMethod === option.method
                        ? "border-geneva-700 bg-geneva-50"
                        : "border-gray-300 hover:bg-gray-50"
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 text-xs font-medium text-gray-800">
                      <span>{option.rank}. {option.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {option.method === recommendedMethod && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">Règle de base</span>
                        )}
                        {learnedSuggestion?.kind === "correction" && learnedSuggestion.method === option.method && (
                          <span className="qualif-ai-badge rounded-full px-2 py-0.5">✦ Qualif IA</span>
                        )}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-gray-600">
                      Fiabilité estimée de la série : {option.original_confidence_pct.toLocaleString("fr-CH")}% → {option.confidence_pct.toLocaleString("fr-CH")}%
                      {option.confidence_gain_pct > 0 && ` (+${option.confidence_gain_pct.toLocaleString("fr-CH")} points)`}
                    </span>
                    {typeof option.model_fit_pct === "number" && (
                      <span className="mt-1 block text-xs text-blue-700">R² météo sur l’historique : {option.model_fit_pct.toLocaleString("fr-CH")} %</span>
                    )}
                    {!option.eligible && (
                      <span className="mt-1 block text-xs text-amber-700">Ne couvre pas toute la zone ou n’améliore pas le score.</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700">Aucune correction compatible n’est disponible pour cette zone.</p>
            )}
            {selectedOption && (
              <p className="mt-1.5 text-xs text-gray-500">
                {selectedOption.description} {selectedOption.confidence_basis}
              </p>
            )}
            {hasWeatherCorrection && (
              <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Données météo de référence : Genève · historique de réanalyse Open-Meteo (2025).
              </p>
            )}
            {!options.some((option) => option.eligible) && !loadingOptions && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Aucun correctif testé n’augmente l’indice de fiabilité de cette série. Vous pouvez la valider en l’état avec un commentaire.
              </p>
            )}
          </div>

          <p className="text-xs text-gray-400">
            {loadingPreview
              ? "Calcul de l'aperçu…"
              : "Aperçu du correctif : la ligne orange en tirets sur la courbe ci-dessous montre les valeurs que ce correctif écrirait dans cette zone."}
          </p>

          <div className="rounded-lg border border-gray-200 p-3">
            <label htmlFor="anomaly-comment" className="mb-1 block text-xs font-medium text-gray-700">
              Commentaire ou explication requis pour valider l’anomalie en l’état
            </label>
            <textarea
              id="anomaly-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Ex. : site en cours de travaux, compteur remplacé… (ou expliquez ce choix à Qualif IA)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-geneva-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setComment("Site en cours de travaux")}
              className="mt-1 text-xs text-geneva-700 underline"
            >
              Insérer « site en cours de travaux »
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onCorrect(selectedMethod)}
              disabled={busy || !selectedMethod || !selectedOption?.eligible}
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
              onClick={() => onValidate(decisionComment)}
              disabled={busy || !decisionComment}
              className={clsx(
                "rounded-lg px-3.5 py-1.5 text-sm font-medium disabled:opacity-50",
                learnedSuggestion?.kind === "detection" && "qualif-ai-halo",
                !correctionPrimary
                  ? "bg-geneva-700 text-white hover:bg-geneva-800"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-100"
              )}
            >
              {busy ? "…" : "Valider en l'état"}
              {learnedSuggestion?.kind === "detection" && <span className="ml-1 text-violet-200">✦ Qualif IA</span>}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2">
            <p className="text-xs text-gray-600">
              {qualifAI.enabled
                ? `${qualifAI.learnedDecisionCount} décision(s) apprises · expliquez un choix pour enrichir le contexte.`
                : "Qualif IA est désactivée. Réactivez-la dans la barre latérale pour mémoriser des retours."}
            </p>
            <button
              type="button"
              disabled={!qualifAI.enabled}
              onClick={() => setChatOpen(true)}
              className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discuter avec Qualif IA
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-400">
          Zone déjà traitée — sélectionnez une autre zone depuis la courbe ou la liste ci-dessous pour continuer.
        </p>
      )}
      <QualifAIChatDialog open={chatOpen} context={context} onClose={() => setChatOpen(false)} />
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
