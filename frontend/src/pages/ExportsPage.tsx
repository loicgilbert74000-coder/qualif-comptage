import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import TopBar from "../components/TopBar";
import QualityBar from "../components/QualityBar";
import { api } from "../api/client";
import type { ImportBatchSummary } from "../types";

export default function ExportsPage() {
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listImports()
      .then(setImports)
      .finally(() => setLoading(false));
  }, []);

  // Only fully qualified dossiers (every meter treated and saved) have
  // final data worth exporting — a dossier still "à valider"/"à corriger",
  // refused, or a detected duplicate has nothing reconciled to hand out.
  const exportable = imports.filter((b) => b.status === "valide");

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Gestion des exports"
        subtitle="Téléchargez en CSV ou JSON les données des fichiers de compteurs entièrement qualifiés."
      />
      <div className="flex-1 px-8 pb-10 pt-6">
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Fichiers qualifiés disponibles pour export ({exportable.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Fichier / Dossier</th>
                  <th className="px-3 py-2 font-medium">Compteurs</th>
                  <th className="px-3 py-2 font-medium">Période</th>
                  <th className="px-3 py-2 font-medium">Qualité finale</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!loading && exportable.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-gray-400">
                      Aucun fichier de compteurs qualifié pour l'instant — terminez le traitement d'un dossier pour
                      le voir apparaître ici.
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
                    <td className="px-3 py-2 text-gray-600">{b.meter_count}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                      {b.period_start ? new Date(b.period_start).toLocaleDateString("fr-CH") : "—"} -{" "}
                      {b.period_end ? new Date(b.period_end).toLocaleDateString("fr-CH") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <QualityBar value={b.quality_score} />
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
