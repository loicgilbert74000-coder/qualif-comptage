import { useEffect, useState } from "react";
import TopBar from "../components/TopBar";
import { api } from "../api/client";
import type { HistoryEntry } from "../types";

const ACTION_LABELS: Record<string, string> = {
  analyse: "Analyse",
  reanalyse: "Réanalyse",
  refuse: "Refus",
  valide_et_traite: "Validé et traité",
  deja_traite: "Déjà traité (doublon)",
};

export default function HistoriquePage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    api.listHistory().then(setEntries);
  }, []);

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Historique des traitements"
        subtitle="Chaque analyse, réanalyse, refus et reconstruction est tracé pour audit."
      />
      <div className="flex-1 px-8 pb-10 pt-6">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Fichier / Dossier</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Méthode de reconstruction</th>
                <th className="px-4 py-3 font-medium">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                    Aucun traitement enregistré pour l'instant.
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {new Date(e.performed_at).toLocaleString("fr-CH")}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{e.import_batch_name}</td>
                  <td className="px-4 py-2.5 text-gray-700">{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className="px-4 py-2.5 text-gray-600">{e.reconstruction_method ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {Object.entries(e.stats)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
