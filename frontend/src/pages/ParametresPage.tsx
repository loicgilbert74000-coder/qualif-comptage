import { useEffect, useState } from "react";
import TopBar from "../components/TopBar";
import { api } from "../api/client";
import type { OrgSettings } from "../types";

export default function ParametresPage() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Paramètres"
        subtitle="Seuils du moteur de qualification, valables pour tous les types de compteurs."
      />
      <div className="flex-1 px-8 pb-10 pt-6">
        <div className="max-w-xl space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <Field
            label="Seuil de détection d'un pic (%)"
            help="Un relevé supérieur de ce pourcentage à sa référence est signalé comme incohérence."
            value={settings.spike_deviation_pct}
            onChange={(v) => setSettings({ ...settings, spike_deviation_pct: v })}
          />
          <Field
            label="Seuil de détection d'une chute (%)"
            help="Un relevé inférieur de ce pourcentage à sa référence est signalé comme incohérence."
            value={settings.drop_deviation_pct}
            onChange={(v) => setSettings({ ...settings, drop_deviation_pct: v })}
          />
          <Field
            label="Fenêtre de référence (nombre de périodes)"
            help="Nombre de relevés comparables utilisés pour construire la valeur de référence."
            value={settings.reference_window_periods}
            onChange={(v) => setSettings({ ...settings, reference_window_periods: Math.round(v) })}
          />
          <Field
            label="Paliers suspects (nombre de valeurs identiques)"
            help="Au-delà de ce nombre de relevés consécutifs identiques, le compteur est signalé comme potentiellement bloqué."
            value={settings.flatline_min_run}
            onChange={(v) => setSettings({ ...settings, flatline_min_run: Math.round(v) })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={settings.allow_negative_values}
              onChange={(e) => setSettings({ ...settings, allow_negative_values: e.target.checked })}
            />
            Autoriser les valeurs négatives (ex. compteurs bidirectionnels)
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-geneva-700 px-4 py-2 text-sm font-medium text-white hover:bg-geneva-800 disabled:opacity-50"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            {saved && <span className="text-sm text-green-600">Paramètres enregistrés.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-800">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
      />
      <p className="mt-1 text-xs text-gray-500">{help}</p>
    </div>
  );
}
