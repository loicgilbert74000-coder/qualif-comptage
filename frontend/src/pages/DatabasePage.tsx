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

  const from = data && data.total > 0 ? data.offset + 1 : 0;
  const to = data ? Math.min(data.offset + data.rows.length, data.total) : 0;

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Base de données"
        subtitle="Consultation brute des tables, en lecture seule — à usage technique uniquement."
      />
      <div className="flex-1 px-8 pb-10 pt-6">
        <div className="mb-4 flex flex-wrap gap-2">
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
              {t.name}
              <span className="ml-1.5 text-gray-400">{t.row_count}</span>
            </button>
          ))}
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {(data?.columns ?? []).map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                      {c}
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
