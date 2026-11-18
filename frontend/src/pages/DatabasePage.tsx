import { useEffect, useState } from "react";
import clsx from "clsx";
import TopBar from "../components/TopBar";
import { api } from "../api/client";
import type { SimplifiedReadingsPage, ReadingFilters, ReadingFilterOptions } from "../types";

const PAGE_SIZE = 50;
const EMPTY_FILTERS: ReadingFilters = {};

// A deliberately simple, read-only view: one flat table of exactly what a
// non-technical user needs to check a reading — compteur, bâtiment,
// horodatage (UTC), valeurs brute/corrigée, indice de fiabilité et
// validité — rather than the app's raw internal tables. Each column can be
// filtered; filtering happens in the database query itself (see the API
// client), not on the current page only, so it stays correct across pages.
export default function DatabasePage() {
  const [data, setData] = useState<SimplifiedReadingsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [filters, setFilters] = useState<ReadingFilters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<ReadingFilterOptions | null>(null);
  // Which meter's delete is being confirmed (meter_id), if any — only one
  // row's confirmation is shown at a time.
  const [confirmingMeterId, setConfirmingMeterId] = useState<string | null>(null);
  const [deletingMeterId, setDeletingMeterId] = useState<string | null>(null);

  useEffect(() => {
    api.getReadingFilterOptions().then(setFilterOptions).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getReadings(PAGE_SIZE, offset, filters)
      .then(setData)
      .catch((e) => setError((e as Error).message || "Chargement impossible."))
      .finally(() => setLoading(false));
  }, [offset, filters]);

  function updateFilter(key: keyof ReadingFilters, value: string) {
    setOffset(0);
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (!value) delete next[key];
      return next;
    });
  }

  function resetFilters() {
    setOffset(0);
    setFilters(EMPTY_FILTERS);
  }

  function refreshAll() {
    setData(null);
    setOffset(0);
    api.getReadings(PAGE_SIZE, 0, filters).then(setData).catch(() => {});
    api.getReadingFilterOptions().then(setFilterOptions).catch(() => {});
  }

  const activeFilterCount = Object.keys(filters).length;

  function deleteMeter(meterId: string) {
    setDeletingMeterId(meterId);
    api
      .deleteMeter(meterId)
      .then(() => {
        setConfirmingMeterId(null);
        refreshAll();
      })
      .catch((e) => setError((e as Error).message || "La suppression du compteur a échoué."))
      .finally(() => setDeletingMeterId(null));
  }

  function wipeDatabase() {
    setWiping(true);
    api
      .wipeDatabase()
      .then(() => {
        setConfirmingWipe(false);
        refreshAll();
      })
      .catch((e) => setError((e as Error).message || "La suppression a échoué."))
      .finally(() => setWiping(false));
  }

  const from = data && data.total > 0 ? data.offset + 1 : 0;
  const to = data ? Math.min(data.offset + data.rows.length, data.total) : 0;

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Base de données"
        subtitle="Relevés de compteurs, en lecture seule — horodatage en UTC."
      />
      <div className="flex-1 px-8 pb-10 pt-6">
        <div className="mb-4 flex items-center justify-end">
          {!confirmingWipe ? (
            <button
              type="button"
              onClick={() => setConfirmingWipe(true)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Vider la base de données
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
              <span>Supprimer toutes les données, sans retour en arrière possible ?</span>
              <button
                type="button"
                disabled={wiping}
                onClick={wipeDatabase}
                className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {wiping ? "Suppression…" : "Confirmer"}
              </button>
              <button
                type="button"
                disabled={wiping}
                onClick={() => setConfirmingWipe(false)}
                className="rounded-md border border-red-300 px-2.5 py-1 font-medium text-red-700 hover:bg-red-100"
              >
                Annuler
              </button>
            </div>
          )}
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {activeFilterCount > 0 && (
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>
              {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""} actif{activeFilterCount > 1 ? "s" : ""}
            </span>
            <button type="button" onClick={resetFilters} className="font-medium text-geneva-700 hover:underline">
              Réinitialiser les filtres
            </button>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Compteur</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Bâtiment</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Fluide</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Horodatage (UTC)</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Valeur brute</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Valeur corrigée</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Unité</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Indice de fiabilité</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Validité</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Actions</th>
                </tr>
                <tr className="border-t border-gray-200 bg-white">
                  <th className="px-3 py-1.5 font-normal">
                    <select
                      value={filters.meter_code ?? ""}
                      onChange={(e) => updateFilter("meter_code", e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs text-gray-700"
                    >
                      <option value="">Tous</option>
                      {filterOptions?.meter_codes.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-3 py-1.5 font-normal">
                    <select
                      value={filters.building ?? ""}
                      onChange={(e) => updateFilter("building", e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs text-gray-700"
                    >
                      <option value="">Tous</option>
                      {filterOptions?.buildings.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-3 py-1.5 font-normal">
                    <select
                      value={filters.fluid_type ?? ""}
                      onChange={(e) => updateFilter("fluid_type", e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs text-gray-700"
                    >
                      <option value="">Tous</option>
                      {filterOptions?.fluid_types.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-3 py-1.5 font-normal">
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={filters.timestamp_from?.slice(0, 10) ?? ""}
                        onChange={(e) => updateFilter("timestamp_from", e.target.value ? `${e.target.value}T00:00:00Z` : "")}
                        className="w-full rounded border border-gray-200 px-1 py-1 text-xs text-gray-700"
                        title="Depuis (UTC)"
                      />
                      <input
                        type="date"
                        value={filters.timestamp_to?.slice(0, 10) ?? ""}
                        onChange={(e) => updateFilter("timestamp_to", e.target.value ? `${e.target.value}T23:59:59Z` : "")}
                        className="w-full rounded border border-gray-200 px-1 py-1 text-xs text-gray-700"
                        title="Jusqu'à (UTC)"
                      />
                    </div>
                  </th>
                  <th className="px-3 py-1.5" />
                  <th className="px-3 py-1.5" />
                  <th className="px-3 py-1.5" />
                  <th className="px-3 py-1.5" />
                  <th className="px-3 py-1.5 font-normal">
                    <select
                      value={filters.validity ?? ""}
                      onChange={(e) => updateFilter("validity", e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs text-gray-700"
                    >
                      <option value="">Toutes</option>
                      {filterOptions?.validities.map((v) => (
                        <option key={v} value={v}>{VALIDITY_LABEL[v] ?? v}</option>
                      ))}
                    </select>
                  </th>
                  <th className="px-3 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!loading && data && data.rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-gray-400">
                      Aucun relevé.
                    </td>
                  </tr>
                )}
                {data?.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-gray-800">{row.meter_code}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{row.building}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{row.fluid_type ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{formatUtc(row.timestamp_utc)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{formatNumber(row.raw_value)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{formatNumber(row.corrected_value)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{row.unit ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">
                      {row.reliability_index === null ? "—" : `${row.reliability_index.toFixed(1)}%`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", VALIDITY_STYLE[row.validity])}>
                        {VALIDITY_LABEL[row.validity] ?? row.validity}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {confirmingMeterId === row.meter_id ? (
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={deletingMeterId === row.meter_id}
                            onClick={() => deleteMeter(row.meter_id)}
                            className="rounded-md bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingMeterId === row.meter_id ? "…" : "Confirmer"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingMeterId === row.meter_id}
                            onClick={() => setConfirmingMeterId(null)}
                            className="rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          title={`Supprimer le compteur ${row.meter_code} et tous ses relevés`}
                          onClick={() => setConfirmingMeterId(row.meter_id)}
                          className="rounded-md border border-red-200 px-2 py-0.5 font-medium text-red-600 hover:bg-red-50"
                        >
                          Supprimer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading && <p className="px-3 py-3 text-xs text-gray-400">Chargement…</p>}
        </div>

        {data && data.total > 0 && (
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>
              {from}–{to} sur {data.total} relevé(s)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                className="rounded-lg border border-gray-300 px-3 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Précédent
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className="rounded-lg border border-gray-300 px-3 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("fr-CH", { maximumFractionDigits: 2 });
}

function formatUtc(iso: string): string {
  // Kept as plain text rather than Date.toLocaleString(), which would
  // re-render it in the browser's own local time — the whole point here
  // is to show UTC, unambiguously, regardless of where it's opened.
  const [date, time] = iso.replace("+00:00", "").split("T");
  return `${date} ${time?.slice(0, 8) ?? ""} UTC`;
}

const VALIDITY_LABEL: Record<string, string> = {
  a_valider: "À valider",
  valide: "Validée",
  corrige: "Corrigée",
  invalide: "Invalide",
};

const VALIDITY_STYLE: Record<string, string> = {
  a_valider: "bg-amber-50 text-amber-700",
  valide: "bg-green-50 text-green-700",
  corrige: "bg-blue-50 text-blue-700",
  invalide: "bg-red-50 text-red-700",
};
