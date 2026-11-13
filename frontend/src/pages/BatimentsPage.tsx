import { useEffect, useState } from "react";
import TopBar from "../components/TopBar";
import { api } from "../api/client";
import type { Building } from "../types";

export default function BatimentsPage() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.listBuildings().then(setBuildings);
  }, []);

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Bâtiments & compteurs"
        subtitle="Le patrimoine bâti et ses points de comptage, créés automatiquement à l'import ou saisis manuellement."
      />
      <div className="flex-1 px-8 pb-10 pt-6">
        <div className="space-y-3">
          {buildings.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-400">
              Aucun bâtiment pour l'instant — importez un fichier pour en créer automatiquement.
            </div>
          )}
          {buildings.map((b) => (
            <div key={b.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <button
                onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50"
              >
                <div>
                  <div className="font-semibold text-gray-900">
                    {b.code} — {b.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {b.typology ?? "Typologie non renseignée"}
                    {b.surface_m2 ? ` · ${b.surface_m2.toLocaleString("fr-CH")} m²` : ""}
                  </div>
                </div>
                <span className="text-sm text-gray-500">{b.meters.length} compteur(s)</span>
              </button>
              {expanded === b.id && (
                <div className="border-t border-gray-100 px-5 py-3">
                  <table className="w-full text-left text-sm">
                    <thead className="text-gray-500">
                      <tr>
                        <th className="py-1.5 font-medium">Code</th>
                        <th className="py-1.5 font-medium">Libellé</th>
                        <th className="py-1.5 font-medium">Fluide</th>
                        <th className="py-1.5 font-medium">Unité</th>
                        <th className="py-1.5 font-medium">Rôle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {b.meters.map((m) => (
                        <tr key={m.id}>
                          <td className="py-1.5 font-medium text-gray-800">{m.code}</td>
                          <td className="py-1.5 text-gray-600">{m.label}</td>
                          <td className="py-1.5 capitalize text-gray-600">{m.fluid_type}</td>
                          <td className="py-1.5 text-gray-600">{m.unit}</td>
                          <td className="py-1.5 capitalize text-gray-600">{m.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
