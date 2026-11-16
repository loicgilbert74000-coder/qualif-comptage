import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import TopBar from "../components/TopBar";
import QualityBar from "../components/QualityBar";
import { api } from "../api/client";
import type { ImportBatchSummary, ReadingFilters, ReadingFilterOptions, ExportFormat } from "../types";

const EMPTY_FILTERS: ReadingFilters = {};

export default function ExportsPage() {
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState<ReadingFilters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<ReadingFilterOptions | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listImports()
      .then(setImports)
      .finally(() => setLoading(false));
    api.getReadingFilterOptions().then(setFilterOptions).catch(() => {});
  }, []);

  useEffect(() => {
    setCountLoading(true);
    // limit=1: only the "total" field from this call is used, to show how
    // many relevés currently match the filters before exporting them.
    api
      .getReadings(1, 0, filters)
      .then((page) => setMatchCount(page.total))
      .catch(() => setMatchCount(null))
      .finally(() => setCountLoading(false));
  }, [filters]);

  function updateFilter(key: keyof ReadingFilters, value: string) {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (!value) delete next[key];
      return next;
    });
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  async function handleCustomExport(format: ExportFormat) {
    setExporting(format);
    setExportError(null);
    try {
      const { blob, filename } = await api.exportReadings(filters, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  const activeFilterCount = Object.keys(filters).length;

  // A dossier doesn't wait to be entirely finished to show up here: as
  // soon as one of its meters is individually qualified (saved), that
  // meter's data is exportable, even while the rest of the dossier is
  // still "à valider"/"à corriger". Only a dossier with zero qualified
  // meters yet (including refused files and detected duplicates, which
  // never have any) is left out.
  const exportable = imports.filter((b) => b.qualified_meter_count > 0);

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Gestion des exports"
        subtitle="Téléchargez en CSV ou JSON les données des compteurs déjà qualifiés — dossier par dossier, dès qu'au moins un compteur y est prêt."
      />
      <div className="flex-1 space-y-6 px-8 pb-10 pt-6">
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-gray-900">Export personnalisé</h2>
          <p className="mb-4 text-sm text-gray-500">
            Choisissez les compteurs à exporter en filtrant sur le compteur, le bâtiment, le fluide, la validité
            et/ou la période — l'export porte sur l'ensemble de la base, indépendamment des dossiers d'import.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Compteur</label>
              <select
                value={filters.meter_code ?? ""}
                onChange={(e) => updateFilter("meter_code", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
              >
                <option value="">Tous</option>
                {filterOptions?.meter_codes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Bâtiment</label>
              <select
                value={filters.building ?? ""}
                onChange={(e) => updateFilter("building", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
              >
                <option value="">Tous</option>
                {filterOptions?.buildings.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Fluide</label>
              <select
                value={filters.fluid_type ?? ""}
                onChange={(e) => updateFilter("fluid_type", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
              >
                <option value="">Tous</option>
                {filterOptions?.fluid_types.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Validité</label>
              <select
                value={filters.validity ?? ""}
                onChange={(e) => updateFilter("validity", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
              >
                <option value="">Toutes</option>
                {filterOptions?.validities.map((v) => (
                  <option key={v} value={v}>{VALIDITY_LABEL[v] ?? v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Depuis (UTC)</label>
              <input
                type="date"
                value={filters.timestamp_from?.slice(0, 10) ?? ""}
                onChange={(e) => updateFilter("timestamp_from", e.target.value ? `${e.target.value}T00:00:00Z` : "")}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Jusqu'à (UTC)</label>
              <input
                type="date"
                value={filters.timestamp_to?.slice(0, 10) ?? ""}
                onChange={(e) => updateFilter("timestamp_to", e.target.value ? `${e.target.value}T23:59:59Z` : "")}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700"
              />
            </div>
          </div>

          {exportError && <p className="mt-3 text-sm text-red-600">{exportError}</p>}

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {activeFilterCount > 0 && (
                <button type="button" onClick={resetFilters} className="mr-3 font-medium text-geneva-700 hover:underline">
                  Réinitialiser les filtres
                </button>
              )}
              {countLoading ? "Comptage…" : `${matchCount ?? 0} relevé(s) correspondant(s)`}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleCustomExport("csv")}
                disabled={exporting !== null || !matchCount}
                className="rounded-lg bg-geneva-700 px-4 py-2 text-sm font-medium text-white hover:bg-geneva-800 disabled:opacity-50"
              >
                {exporting === "csv" ? "Export en cours…" : "⬇ Exporter en CSV"}
              </button>
              <button
                type="button"
                onClick={() => handleCustomExport("json")}
                disabled={exporting !== null || !matchCount}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {exporting === "json" ? "Export en cours…" : "⬇ Exporter en JSON"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Dossiers avec au moins un compteur qualifié ({exportable.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Fichier / Dossier</th>
                  <th className="px-3 py-2 font-medium">Compteurs qualifiés</th>
                  <th className="px-3 py-2 font-medium">Période</th>
                  <th className="px-3 py-2 font-medium">Qualité</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!loading && exportable.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                      Aucun compteur qualifié pour l'instant — qualifiez au moins un compteur dans un dossier pour le
                      voir apparaître ici.
                    </td>
                  </tr>
                )}
                {exportable.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      <Link to={`/traitements/${b.id}/export`} className="hover:text-geneva-700 hover:underline">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {b.qualified_meter_count} / {b.meter_count}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                      {b.period_start ? new Date(b.period_start).toLocaleDateString("fr-CH") : "—"} -{" "}
                      {b.period_end ? new Date(b.period_end).toLocaleDateString("fr-CH") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <QualityBar value={b.quality_score} invalid={b.status === "refuse" || b.status === "deja_traite"} />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/traitements/${b.id}/export`}
                        className="rounded-md bg-geneva-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-geneva-800"
                      >
                        Exporter →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

const VALIDITY_LABEL: Record<string, string> = {
  a_valider: "À valider",
  valide: "Validée",
  corrige: "Corrigée",
  invalide: "Invalide",
};
