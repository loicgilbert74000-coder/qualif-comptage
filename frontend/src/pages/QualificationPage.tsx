import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import TopBar from "../components/TopBar";
import StepIndicator from "../components/StepIndicator";
import StatusBadge from "../components/StatusBadge";
import QualityBar from "../components/QualityBar";
import ProgressBar from "../components/ProgressBar";
import LoadingOverlay from "../components/LoadingOverlay";
import DetailedAnalysis from "../components/DetailedAnalysis";
import { api } from "../api/client";
import type { ImportBatchSummary, ImportBatchDetail, ImportPreview, UnmappedFileInfo } from "../types";

export default function QualificationPage() {
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  // The manual column mapping, once confirmed on the mapping form — kept
  // so the final import call reuses exactly what made the preview work,
  // instead of re-guessing.
  const [columnMapping, setColumnMapping] = useState<Record<string, string> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const refreshList = useCallback(async () => {
    const data = await api.listImports();
    setImports(data);
    return data;
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    api.getImport(activeId).then(setDetail);
  }, [activeId]);

  async function refreshActive() {
    await refreshList();
    if (activeId) api.getImport(activeId).then(setDetail);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.previewImport(fileArray);
      setPendingFiles(fileArray);
      setPreview(result);
      // Pre-check every detected meter, including the ones already in
      // base — the warning is there so the person can decide, not to
      // silently skip them.
      setSelectedCodes(new Set(result.meters.map((m) => m.meter_code)));
    } catch (e) {
      setError((e as Error).message);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    } finally {
      setPreviewing(false);
    }
  }

  function cancelPreview() {
    setPendingFiles(null);
    setPreview(null);
    setSelectedCodes(new Set());
    setColumnMapping(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  function toggleMeter(code: string) {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function submitMapping(mapping: Record<string, string>) {
    if (!pendingFiles) return;
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.previewImport(pendingFiles, mapping);
      setPreview(result);
      setColumnMapping(mapping);
      setSelectedCodes(new Set(result.meters.map((m) => m.meter_code)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmImport() {
    if (!pendingFiles) return;
    setUploading(true);
    setError(null);
    try {
      const batch = await api.uploadImport(pendingFiles, Array.from(selectedCodes), columnMapping ?? undefined);
      await refreshList();
      setActiveId(batch.id);
      cancelPreview();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function reanalyzeAll() {
    setReanalyzing(true);
    try {
      for (const b of imports) {
        await api.reanalyze(b.id);
      }
      await refreshActive();
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    const target = imports.find((i) => i.id === id);
    if (!window.confirm(`Supprimer « ${target?.name ?? "ce fichier"} » de la liste des imports ?`)) return;
    try {
      await api.deleteImport(id);
      if (activeId === id) setActiveId(null);
      await refreshList();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Qualification des données de compteurs"
        subtitle="Contrôle, qualification et préparation des données de compteurs de tout type (électricité, gaz, eau, chaleur, mazout, granulés…)"
      />
      <StepIndicator current={detail ? 2 : 1} />

      {reanalyzing && <LoadingOverlay label="Réanalyse de tous les fichiers en cours…" />}
      {previewing && !preview && <LoadingOverlay label="Lecture du fichier…" />}
      {preview && pendingFiles && (
        <ImportPreviewModal
          preview={preview}
          selectedCodes={selectedCodes}
          onToggle={toggleMeter}
          onCancel={cancelPreview}
          onConfirm={confirmImport}
          onSubmitMapping={submitMapping}
          importing={uploading}
          mappingBusy={previewing}
        />
      )}

      <div className="flex-1 px-8 pb-6">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Importer des données de compteurs</h2>
              {uploading && <ProgressBar label="Import et analyse en cours…" className="w-56" />}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UploadCard
                icon={<FileIcon />}
                title="Fichier CSV"
                description="Un ou plusieurs fichiers (données de compteurs)"
                buttonLabel="Sélectionner un fichier"
                onClick={() => fileInputRef.current?.click()}
              />
              <UploadCard
                icon={<FolderIcon />}
                title="Dossier (traitement multiple)"
                description="Traiter tous les fichiers CSV d'un dossier"
                buttonLabel="Choisir un dossier"
                onClick={() => folderInputRef.current?.click()}
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
              // non-standard attributes, supported by Chromium/Firefox for folder picking;
              // spread as a plain object so TypeScript's JSX typing doesn't need to know them
              {...({ webkitdirectory: "true", directory: "" } as Record<string, string>)}
            />
            <p className="mt-3 flex items-start gap-2 text-xs text-gray-500">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              Formats acceptés : .csv (UTF-8, ; ou ,) — Données attendues : horodatage, id_compteur, valeur, unité
              (selon configuration). N'importe quel type de fluide est accepté (électricité, gaz, eau, chaleur,
              mazout, granulés, etc.).
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                Fichiers importés et analysés ({imports.length})
              </h2>
              <button
                onClick={reanalyzeAll}
                disabled={reanalyzing}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                ⟳ Tout réanalyser
              </button>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200">
              <div className="max-h-[172px] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Fichier / Dossier</th>
                      <th className="px-3 py-2 font-medium">Bâtiments</th>
                      <th className="px-3 py-2 font-medium">Compteurs</th>
                      <th className="px-3 py-2 font-medium">Période</th>
                      <th className="px-3 py-2 font-medium">Qualité des données</th>
                      <th className="px-3 py-2 font-medium">Statut</th>
                      <th className="w-9 px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {imports.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                          Aucun fichier importé pour l'instant.
                        </td>
                      </tr>
                    )}
                    {imports.map((b) => (
                      <tr
                        key={b.id}
                        className={`cursor-pointer hover:bg-gray-50 ${activeId === b.id ? "bg-geneva-50" : ""}`}
                        onClick={() => setActiveId(b.id)}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 font-medium text-gray-800">
                            {b.kind === "dossier" ? <FolderIcon className="h-4 w-4 text-gray-400" /> : <FileIcon className="h-4 w-4 text-gray-400" />}
                            {b.name}
                            {b.kind === "dossier" && (
                              <span className="text-xs font-normal text-gray-400">({b.file_count} fichiers)</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{b.building_count}</td>
                        <td className="px-3 py-2 text-gray-600">{b.meter_count}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                          {b.period_start ? new Date(b.period_start).toLocaleDateString("fr-CH") : "—"} -{" "}
                          {b.period_end ? new Date(b.period_end).toLocaleDateString("fr-CH") : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <QualityBar value={b.quality_score} invalid={b.status === "refuse" || b.status === "deja_traite"} />
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={b.status} />
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => handleDelete(b.id, e)}
                            title="Supprimer ce fichier"
                            aria-label="Supprimer ce fichier"
                            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {imports.length > 3 && (
              <p className="mt-1.5 text-xs text-gray-400">
                {imports.length} fichiers — faites défiler la liste pour voir les suivants, ou supprimez les fichiers en trop.
              </p>
            )}
          </section>

          {detail && <DetailedAnalysis detail={detail} onAction={refreshActive} />}
        </div>
      </div>
    </div>
  );
}

// Logical fields the parser understands, in the order the mapping form
// shows them. horodatage/valeur are mandatory — every other field is
// optional and can be left unmapped.
const MAPPING_FIELDS: { key: string; label: string; required: boolean; hint: string }[] = [
  { key: "horodatage", label: "Horodatage (date/heure)", required: true, hint: "La colonne qui donne la date ou la date-heure du relevé." },
  { key: "valeur", label: "Valeur relevée", required: true, hint: "La colonne contenant le relevé lui-même (index ou consommation)." },
  { key: "id_compteur", label: "Identifiant du compteur", required: false, hint: "Si absente, tout le fichier est traité comme un seul compteur." },
  { key: "unite", label: "Unité", required: false, hint: "kWh, m³, litre… Si absente, l'unité du compteur existant est utilisée." },
  { key: "id_batiment", label: "Identifiant du bâtiment / site", required: false, hint: "" },
  { key: "fluide", label: "Fluide", required: false, hint: "Électricité, gaz, eau, chaleur…" },
  { key: "mesure", label: "Rôle / nature de la mesure", required: false, hint: "" },
];

function ColumnMappingForm({
  filename,
  info,
  busy,
  onSubmit,
}: {
  filename: string;
  info: UnmappedFileInfo;
  busy: boolean;
  onSubmit: (mapping: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...info.detected_mapping }));

  const canSubmit = Boolean(draft.horodatage) && Boolean(draft.valeur);

  return (
    <div>
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Le format de « {filename} » n'a pas été reconnu automatiquement. Indiquez ci-dessous à quoi correspond
        chaque colonne du fichier — au moins l'horodatage et la valeur relevée sont nécessaires.
      </div>
      <p className="mb-2 text-xs text-gray-500">
        Colonnes trouvées dans le fichier : <span className="font-medium text-gray-700">{info.columns.join(", ")}</span>
      </p>
      <div className="space-y-2.5">
        {MAPPING_FIELDS.map((field) => (
          <div key={field.key} className="flex items-center gap-3">
            <label className="w-48 shrink-0 text-sm text-gray-700">
              {field.label}
              {field.required && <span className="text-red-500"> *</span>}
            </label>
            <select
              value={draft[field.key] ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
            >
              {!field.required && <option value="">— Aucune —</option>}
              {field.required && !draft[field.key] && <option value="">— Choisir —</option>}
              {info.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!canSubmit || busy}
          onClick={() => {
            const mapping: Record<string, string> = {};
            for (const field of MAPPING_FIELDS) {
              if (draft[field.key]) mapping[field.key] = draft[field.key];
            }
            onSubmit(mapping);
          }}
          className="rounded-lg bg-geneva-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-geneva-800 disabled:opacity-50"
        >
          {busy ? "Lecture…" : "Valider ce mapping"}
        </button>
      </div>
    </div>
  );
}

function ImportPreviewModal({
  preview,
  selectedCodes,
  onToggle,
  onCancel,
  onConfirm,
  onSubmitMapping,
  importing,
  mappingBusy,
}: {
  preview: ImportPreview;
  selectedCodes: Set<string>;
  onToggle: (code: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSubmitMapping: (mapping: Record<string, string>) => void;
  importing: boolean;
  mappingBusy: boolean;
}) {
  function formatPeriod(start: string | null, end: string | null) {
    if (!start || !end) return "—";
    const f = (d: string) => new Date(d).toLocaleDateString("fr-CH");
    return `${f(start)} - ${f(end)}`;
  }

  if (preview.needs_mapping) {
    const [firstFilename, firstInfo] = Object.entries(preview.unmapped_files)[0];
    const otherFilenames = Object.keys(preview.unmapped_files).slice(1);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-base font-semibold text-gray-900">Format non reconnu — mapping manuel</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Indiquez à quoi correspond chaque colonne pour importer ce fichier malgré tout.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <ColumnMappingForm filename={firstFilename} info={firstInfo} busy={mappingBusy} onSubmit={onSubmitMapping} />
            {otherFilenames.length > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                Ce mapping sera aussi appliqué à : {otherFilenames.join(", ")}. Si leurs colonnes diffèrent,
                importez-les séparément.
              </p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={mappingBusy}
              className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Aperçu avant import</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Choisissez les compteurs à importer. Les autres seront ignorés.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {preview.exact_duplicate && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Ce fichier (ou ce dossier) a déjà été importé à l'identique
              {preview.duplicate_of_name ? ` (« ${preview.duplicate_of_name} »)` : ""}. Vous pouvez tout de même
              continuer, mais l'import sera marqué comme déjà traité.
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div className="mb-3 space-y-1">
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}

          {preview.meters.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Aucun compteur détecté dans ce fichier.</p>
          ) : (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {preview.meters.map((m) => (
                <label
                  key={m.meter_code}
                  className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedCodes.has(m.meter_code)}
                    onChange={() => onToggle(m.meter_code)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-geneva-700 focus:ring-geneva-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{m.meter_code}</span>
                      {m.fluid_type && <span className="text-xs text-gray-400">{m.fluid_type}</span>}
                      {m.already_in_base && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Déjà en base ({m.existing_row_count} ligne{m.existing_row_count > 1 ? "s" : ""})
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {m.row_count} ligne{m.row_count > 1 ? "s" : ""} · {formatPeriod(m.period_start, m.period_end)}
                      {m.building_code ? ` · ${m.building_code}` : ""}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={importing}
            className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={importing || selectedCodes.size === 0}
            className="rounded-lg bg-geneva-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-geneva-800 disabled:opacity-50"
          >
            {importing ? "Import en cours…" : `Importer la sélection (${selectedCodes.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadCard({
  icon,
  title,
  description,
  buttonLabel,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 px-3 py-2.5">
      <div className="shrink-0 text-geneva-700">{icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-gray-900">{title}</h3>
        <p className="truncate text-xs text-gray-500">{description}</p>
      </div>
      <button
        onClick={onClick}
        className="shrink-0 rounded-lg border border-geneva-700 px-3 py-1.5 text-xs font-medium text-geneva-700 hover:bg-geneva-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? "h-6 w-6"}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? "h-6 w-6"}>
      <path
        d="M4 6a1 1 0 0 1 1-1h4.5l2 2H19a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
