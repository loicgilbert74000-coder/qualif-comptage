import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import TopBar from "../components/TopBar";
import StepIndicator from "../components/StepIndicator";
import StatusBadge from "../components/StatusBadge";
import QualityBar from "../components/QualityBar";
import DetailedAnalysis from "../components/DetailedAnalysis";
import { api } from "../api/client";
import type { ImportBatchSummary, ImportBatchDetail } from "../types";

export default function QualificationPage() {
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setUploading(true);
    setError(null);
    try {
      const batch = await api.uploadImport(Array.from(files));
      await refreshList();
      setActiveId(batch.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function reanalyzeSelection() {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : imports.map((i) => i.id);
    for (const id of ids) {
      await api.reanalyze(id);
    }
    await refreshList();
  }

  async function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    const target = imports.find((i) => i.id === id);
    if (!window.confirm(`Supprimer « ${target?.name ?? "ce fichier"} » de la liste des imports ?`)) return;
    try {
      await api.deleteImport(id);
      if (activeId === id) setActiveId(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refreshList();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selectedBatches = imports.filter((i) => selectedIds.has(i.id));
  const avgQuality =
    selectedBatches.length > 0
      ? selectedBatches.reduce((s, b) => s + (b.quality_score ?? 0), 0) / selectedBatches.length
      : null;

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Qualification des données de compteurs"
        subtitle="Contrôle, qualification et préparation des données de compteurs de tout type (électricité, gaz, eau, chaleur, mazout, granulés…)"
      />
      <StepIndicator current={detail ? 2 : 1} />

      <div className="flex-1 px-8 pb-10">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Importer des données de compteurs</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <p className="mt-4 flex items-start gap-2 text-xs text-gray-500">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              Formats acceptés : .csv (UTF-8, ; ou ,) — Données attendues : horodatage, id_compteur, valeur, unité
              (selon configuration). N'importe quel type de fluide est accepté (électricité, gaz, eau, chaleur,
              mazout, granulés, etc.).
            </p>
            {uploading && <p className="mt-3 text-sm text-geneva-700">Import et analyse en cours…</p>}
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                Fichiers importés et analysés ({imports.length})
              </h2>
              <button
                onClick={reanalyzeSelection}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                ⟳ Tout réanalyser
              </button>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200">
              <div className="max-h-[172px] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="w-8 px-3 py-2"></th>
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
                        <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
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
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(b.id)}
                            onChange={() => toggleSelect(b.id)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 font-medium text-gray-800">
                            {b.kind === "dossier" ? <FolderIcon small /> : <FileIcon small />}
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
                          <QualityBar value={b.quality_score} />
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

            <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
              <span>{selectedIds.size} fichier(s) sélectionné(s)</span>
              {avgQuality !== null && (
                <span>
                  Qualité moyenne (sélection) : <strong className="text-gray-700">{avgQuality.toFixed(1)} %</strong>
                </span>
              )}
            </div>
          </section>
        </div>

        {detail && <DetailedAnalysis detail={detail} onAction={refreshActive} />}
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
    <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 text-center">
      <div className="mb-3 text-geneva-700">{icon}</div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
      <button
        onClick={onClick}
        className="mt-4 rounded-lg border border-geneva-700 px-4 py-2 text-sm font-medium text-geneva-700 hover:bg-geneva-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function FileIcon({ small }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={small ? "h-4 w-4 text-gray-400" : "h-9 w-9"}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ small }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={small ? "h-4 w-4 text-gray-400" : "h-9 w-9"}>
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
