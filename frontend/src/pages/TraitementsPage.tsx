import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import TopBar from "../components/TopBar";
import StatusBadge from "../components/StatusBadge";
import QualityBar from "../components/QualityBar";
import { api } from "../api/client";
import type { ImportBatchSummary } from "../types";

export default function TraitementsPage() {
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setImports(await api.listImports());
  }

  useEffect(() => {
    refresh();
  }, []);

  const pending = imports.filter((i) => i.status === "a_valider" || i.status === "a_corriger");
  const treated = imports.filter((i) => i.status === "valide" || i.status === "refuse");

  async function reject(id: string) {
    setBusyId(id);
    try {
      await api.reject(id);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Traitements & reconstructions"
        subtitle="Validez les fichiers qualifiés pour lancer la reconstruction par simulation (comblement des manquants, lissage des incohérences)."
      />
      <div className="flex-1 space-y-6 px-8 pb-10 pt-6">
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">En attente de traitement ({pending.length})</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Fichier / Dossier</th>
                  <th className="px-3 py-2 font-medium">Compteurs</th>
                  <th className="px-3 py-2 font-medium">Qualité</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pending.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                      Rien à traiter pour le moment.
                    </td>
                  </tr>
                )}
                {pending.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      <Link to={`/traitements/${b.id}`} className="hover:text-geneva-700 hover:underline">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{b.meter_count}</td>
                    <td className="px-3 py-2">
                      <QualityBar value={b.quality_score} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <Link
                          to={`/traitements/${b.id}`}
                          className="rounded-md bg-geneva-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-geneva-800"
                        >
                          Traiter les zones →
                        </Link>
                        <button
                          disabled={busyId === b.id}
                          onClick={() => reject(b.id)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Refuser
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Traités récemment ({treated.length})</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Fichier / Dossier</th>
                  <th className="px-3 py-2 font-medium">Qualité finale</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {treated.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-gray-400">
                      Aucun traitement effectué pour l'instant.
                    </td>
                  </tr>
                )}
                {treated.map((b) => (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-medium text-gray-800">{b.name}</td>
                    <td className="px-3 py-2">
                      <QualityBar value={b.quality_score} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={b.status} />
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
