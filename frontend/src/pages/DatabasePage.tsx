import { useEffect, useState } from "react";
import clsx from "clsx";
import TopBar from "../components/TopBar";
import { api } from "../api/client";
import type { DbTable, DbTableRows } from "../types";

const PAGE_SIZE = 50;

// A deliberately plain, read-only table browser: no grid library, no
// virtualization, no client-side caching of previous pages — just one
// small paginated request per table/page, so it stays light whatever the
// database's size.
export default function DatabasePage() {
  const [tables, setTables] = useState<DbTable[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<DbTableRows | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    api
      .listDbTables()
      .then((t) => {
        setTables(t);
        setSelected((cur) => cur ?? t[0]?.name ?? null);
      })
      .catch((e) => setError((e as Error).message || "Impossible de lister les tables."));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    api
      .getDbTableRows(selected, PAGE_SIZE, offset)
      .then(setData)
      .catch((e) => setError((e as Error).message || "Chargement impossible."))
      .finally(() => setLoading(false));
  }, [selected, offset]);

  function selectTable(name: string) {
    setSelected(name);
    setOffset(0);
    setData(null);
  }

  function refreshAll() {
    setData(null);
    setOffset(0);
    api.listDbTables().then(setTables).catch(() => {});
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
        subtitle="Consultation brute des tables, en lecture seule — à usage technique uniquement."
      />
      <div className="flex-1 px-8 pb-10 pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {tables.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => selectTable(t.name)}
                className={clsx(
                  "rounded-full border px-3.5 py-1.5 text-xs font-medium",
                  selected === t.name
                    ? "border-geneva-700 bg-geneva-50 text-geneva-800"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                )}
              >
                {tableLabel(t.name)}
                <span className="ml-1.5 text-gray-400">{t.row_count}</span>
              </button>
            ))}
          </div>

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

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {(data?.columns ?? []).map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                      {columnLabel(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!loading && data && data.rows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(data.columns.length, 1)} className="px-3 py-8 text-center text-gray-400">
                      Table vide.
                    </td>
                  </tr>
                )}
                {data?.rows.map((row, i) => (
                  <tr key={i}>
                    {data.columns.map((c) => {
                      const full = formatCell(row[c]);
                      return (
                        <td
                          key={c}
                          title={full}
                          className="max-w-[220px] truncate px-3 py-1.5 text-gray-700"
                        >
                          {shortenForDisplay(full)}
                        </td>
                      );
                    })}
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
              {from}–{to} sur {data.total} ligne(s)
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

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A full UUID (36 chars) makes an id/foreign-key column unreadable and
// crowds out the rest of the table. Shown short, with the full value
// still available as a native tooltip (the `title` attribute on the
// cell) for anyone who needs to copy or cross-reference it.
function shortenForDisplay(value: string): string {
  if (UUID_RE.test(value)) return value.slice(0, 8) + "…";
  return value;
}

const TABLE_LABELS: Record<string, string> = {
  anomalies: "Anomalies",
  buildings: "Bâtiments",
  import_batches: "Imports",
  meter_validations: "Validations de compteurs",
  meters: "Compteurs",
  org_settings: "Paramètres",
  processing_history: "Historique des traitements",
  readings: "Relevés",
};

function tableLabel(name: string): string {
  return TABLE_LABELS[name] ?? name;
}

const COLUMN_LABELS: Record<string, string> = {
  id: "Identifiant",
  import_batch_id: "Import",
  meter_id: "Compteur",
  type: "Type",
  subtype: "Sous-type",
  period_start: "Début de période",
  period_end: "Fin de période",
  description: "Description",
  deviation_pct: "Écart (%)",
  resolution: "Résolution",
  code: "Code",
  name: "Nom",
  address: "Adresse",
  typology: "Typologie",
  surface_m2: "Surface (m²)",
  action: "Action",
  performed_at: "Effectué le",
  reconstruction_method: "Méthode de reconstruction",
  stats: "Statistiques",
  kind: "Type d'import",
  file_count: "Nombre de fichiers",
  storage_path: "Chemin de stockage",
  column_mapping: "Correspondance des colonnes",
  delimiter: "Séparateur",
  decimal_separator: "Séparateur décimal",
  building_count: "Nombre de bâtiments",
  meter_count: "Nombre de compteurs",
  quality_score: "Score de qualité",
  status: "Statut",
  content_hash: "Empreinte du contenu",
  created_at: "Créé le",
  analyzed_at: "Analysé le",
  building_id: "Bâtiment",
  label: "Libellé",
  fluid_type: "Type de fluide",
  unit: "Unité",
  role: "Rôle",
  measurement_kind: "Nature de mesure",
  parent_meter_id: "Compteur parent",
  expected_frequency: "Fréquence attendue",
  service_start: "Mise en service",
  service_end: "Fin de service",
  validated_at: "Validé le",
  points_reconstructed: "Points reconstruits",
  points_smoothed: "Points lissés",
  quality_before: "Qualité avant",
  quality_after: "Qualité après",
  spike_deviation_pct: "Seuil pic (%)",
  drop_deviation_pct: "Seuil chute (%)",
  reference_window_periods: "Fenêtre de référence (périodes)",
  flatline_min_run: "Plateau minimal (points)",
  allow_negative_values: "Valeurs négatives autorisées",
  historical_min_points: "Historique minimal (points)",
  robust_mad_multiplier: "Multiplicateur MAD robuste",
  historical_extreme_ratio: "Ratio extrême historique",
  zero_active_min_history: "Historique minimal (zéro actif)",
  seasonal_activity_min_history: "Historique minimal (saisonnier)",
  timestamp_tolerance_pct: "Tolérance horodatage (%)",
  timestamp: "Horodatage",
  value: "Valeur",
  raw_value: "Valeur brute",
  quality: "Qualité",
};

function columnLabel(key: string): string {
  return COLUMN_LABELS[key] ?? key;
}
