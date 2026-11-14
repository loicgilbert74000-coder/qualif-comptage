import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/client";
import type { OrgSettings } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

const EMPTY: OrgSettings = {
  spike_deviation_pct: 60,
  drop_deviation_pct: 60,
  reference_window_periods: 30,
  flatline_min_run: 4,
  allow_negative_values: false,
  historical_min_points: 6,
  robust_mad_multiplier: 6,
  historical_extreme_ratio: 3,
  zero_active_min_history: 4,
  seasonal_activity_min_history: 3,
  timestamp_tolerance_pct: 10,
};

export default function QualityCriteriaDialog({ open, onClose }: Props) {
  const [settings, setSettings] = useState<OrgSettings>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setReady(false);
    setError(null);
    api.getSettings()
      .then((value) => { setSettings(value); setReady(true); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  function setNumber(key: Exclude<keyof OrgSettings, "allow_negative_values">, value: number) {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      setSettings(await api.updateSettings(settings));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="criteria-dialog-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-gray-100 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-geneva-700">Configuration</p>
            <h2 id="criteria-dialog-title" className="mt-1 text-xl font-semibold text-gray-900">
              Critères de détection des anomalies
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Réglez les seuils communs aux compteurs et les comparaisons avec leur historique.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            autoFocus
            aria-label="Fermer la fenêtre"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="py-12 text-center text-sm text-gray-500">Chargement des critères…</p>
          ) : (
            <div className="space-y-6">
              <SettingsSection title="Variations et compteurs bloqués">
                <NumberField label="Seuil d’un pic (%)" help="Écart local minimal par rapport aux périodes voisines." value={settings.spike_deviation_pct} min={1} max={500} onChange={(v) => setNumber("spike_deviation_pct", v)} />
                <NumberField label="Seuil d’une chute (%)" help="Baisse locale minimale par rapport aux périodes voisines." value={settings.drop_deviation_pct} min={1} max={100} onChange={(v) => setNumber("drop_deviation_pct", v)} />
                <NumberField label="Fenêtre de comparaison (périodes)" help="Taille de la fenêtre locale utilisée pour les pics et chutes." value={settings.reference_window_periods} min={3} max={5000} onChange={(v) => setNumber("reference_window_periods", v)} />
                <NumberField label="Longueur minimale d’un plateau" help="Nombre de relevés consécutifs identiques avant signalement." value={settings.flatline_min_run} min={2} max={10000} onChange={(v) => setNumber("flatline_min_run", v)} />
                <label className="flex items-start gap-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  <input className="mt-0.5" type="checkbox" checked={settings.allow_negative_values} onChange={(e) => { setSettings({ ...settings, allow_negative_values: e.target.checked }); setSaved(false); }} />
                  <span><strong className="block font-medium text-gray-800">Autoriser les valeurs négatives</strong><span className="text-xs text-gray-500">À activer pour les compteurs bidirectionnels dont les valeurs négatives sont valides.</span></span>
                </label>
              </SettingsSection>

              <SettingsSection title="Référence statistique historique">
                <NumberField label="Historique comparable minimal" help="Nombre de points du même mois et créneau requis avant comparaison." value={settings.historical_min_points} min={3} max={10000} onChange={(v) => setNumber("historical_min_points", v)} />
                <NumberField label="Multiplicateur MAD" help="Sensibilité robuste aux valeurs inhabituellement hautes ou basses." value={settings.robust_mad_multiplier} min={0.1} max={20} step={0.1} onChange={(v) => setNumber("robust_mad_multiplier", v)} />
                <NumberField label="Ratio extrême vs médiane" help="Plancher du seuil haut : par défaut, trois fois la médiane comparable." value={settings.historical_extreme_ratio} min={1.1} max={100} step={0.1} onChange={(v) => setNumber("historical_extreme_ratio", v)} />
              </SettingsSection>

              <SettingsSection title="Saisonnalité et horodatages">
                <NumberField label="Points positifs pour valider un zéro saisonnier" help="Le zéro est signalé seulement si autant de points comparables ont déjà été positifs." value={settings.zero_active_min_history} min={2} max={10000} onChange={(v) => setNumber("zero_active_min_history", v)} />
                <NumberField label="Points actifs pour confirmer la saison d’un index" help="Nombre de hausses historiques comparables qui confirment qu’un plateau est en période active." value={settings.seasonal_activity_min_history} min={2} max={10000} onChange={(v) => setNumber("seasonal_activity_min_history", v)} />
                <NumberField label="Tolérance d’horodatage (%)" help="Écart maximal autour du pas attendu avant de signaler un horodatage décalé." value={settings.timestamp_tolerance_pct} min={0.1} max={50} step={0.1} onChange={(v) => setNumber("timestamp_tolerance_pct", v)} />
              </SettingsSection>
            </div>
          )}
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {saved && <p role="status" className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Critères enregistrés. Ils seront utilisés au prochain import ou à la prochaine réanalyse.</p>}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-gray-100 bg-gray-50 px-6 py-4">
          <p className="text-xs text-gray-500">Un historique trop court limite les comparaisons saisonnières.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50">Fermer</button>
            <button type="button" onClick={save} disabled={!ready || loading || saving} className="rounded-lg bg-geneva-700 px-4 py-2 text-sm font-medium text-white hover:bg-geneva-800 disabled:opacity-50">
              {saving ? "Enregistrement…" : "Enregistrer les critères"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function NumberField({ label, help, value, min, max, step = 1, onChange }: { label: string; help: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="block rounded-lg border border-gray-200 p-3">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 focus:border-geneva-700 focus:outline-none focus:ring-1 focus:ring-geneva-700" />
      <span className="mt-1 block text-xs text-gray-500">{help}</span>
    </label>
  );
}
