import { useEffect, useState } from "react";
import TopBar from "../components/TopBar";
import { api } from "../api/client";
import type { CriteriaProfile, CriteriaProfileUpdate } from "../types";
import { USAGE_PROFILE_LABELS } from "../types";

type ErrorKind = "incoherence" | "manquante" | "info";

interface ErrorEntry {
  title: string;
  kind: ErrorKind;
  description: string;
  detection: string;
}

interface MeterCategory {
  /** Matches the backend's measurement_kind value, so the criteria
   * profiles fetched from /api/criteria-profiles can be grouped under the
   * right category — this is what lets the per-usage thresholds live next
   * to the error descriptions they govern, instead of in a separate,
   * disconnected settings screen. */
  kind: string;
  title: string;
  subtitle: string;
  examples: string;
  errors: ErrorEntry[];
}

const CATEGORIES: MeterCategory[] = [
  {
    kind: "index",
    title: "Compteurs à index cumulé",
    subtitle: "Relevés manuels ou mensuels — la valeur ne redescend jamais, elle grimpe à chaque relevé",
    examples: "Gaz, eau, mazout, électricité à index — relevés manuels ou périodiques",
    errors: [
      {
        title: "Erreur de saisie / transcription",
        kind: "incoherence",
        description:
          "Un chiffre mal recopié (zéro en trop, inversion de chiffres, virgule décalée) fait bondir ou chuter l'index d'un coup, avant de revenir dans la tendance au relevé suivant.",
        detection:
          "Comparaison de chaque valeur à la médiane d'une fenêtre « donut » autour du point (ses voisins, sans le point lui-même) — « pic » / « chute ».",
      },
      {
        title: "Remplacement ou remise à zéro du compteur",
        kind: "info",
        description:
          "L'index redescend brutalement : nouveau compteur posé à 0, ou rollover d'un compteur à digits limités qui revient à 0 après son maximum.",
        detection:
          "Détecté comme une « chute », mais c'est un événement légitime, pas une erreur — nécessite une validation humaine plutôt qu'une correction automatique.",
      },
      {
        title: "Compteur bloqué / relevé recopié par erreur",
        kind: "incoherence",
        description: "L'index peut rester inchangé lorsqu'aucune consommation n'est attendue, par exemple le week-end. Le plateau est suspect seulement si les mêmes créneaux saisonniers progressent habituellement.",
        detection: "Pour un index, chaque relevé inchangé est comparé aux mêmes créneaux saisonniers : même mois et jour de semaine pour des données journalières, plus le même créneau horaire pour des données infrajournalières. Un créneau n'est considéré actif que si au moins 3 deltas comparables sont positifs. Le moteur signale 4 créneaux actifs consécutifs sans hausse.",
      },
      {
        title: "Relevé manquant",
        kind: "manquante",
        description: "Aucune ligne pour une période attendue (relevé oublié, fichier incomplet).",
        detection: "Comparaison à l'index temporel théorique, reconstruit à partir de la fréquence déduite de l'historique du compteur.",
      },
      {
        title: "Valeur négative",
        kind: "incoherence",
        description: "Un index ne peut pas être négatif ; si ça arrive, c'est une erreur de saisie ou de calcul en amont.",
        detection: "Vérifiée en premier, indépendamment des autres règles.",
      },
    ],
  },
  {
    kind: "consommation",
    title: "Compteurs de courbe de charge",
    subtitle: "Horaire ou quart d'heure — chaque valeur est une quantité pour la période, pas un cumul",
    examples: "Électricité et gaz télérelevés, courbes de charge au pas de 15 minutes ou horaire",
    errors: [
      {
        title: "Pics et creux ponctuels",
        kind: "incoherence",
        description: "Défaut capteur, transitoire électrique ou erreur de transmission : une valeur isolée très au-dessus ou en-dessous des périodes voisines.",
        detection: "« Pic » / « chute » — même mécanisme de fenêtre de référence que pour les index.",
      },
      {
        title: "Télétransmission figée",
        kind: "incoherence",
        description: "La liaison renvoie la dernière valeur connue en boucle (capteur ou modem bloqué).",
        detection:
          "« Palier suspect » — à condition que la valeur répétée ne soit pas 0 pendant une vraie période d'inoccupation (nuit, week-end), qui elle est normale.",
      },
      {
        title: "Valeurs manquantes",
        kind: "manquante",
        description: "Trous dans le flux (coupure télérelève, maintenance) — souvent courts et fréquents plutôt qu'une longue absence.",
        detection: "Comparaison à l'index temporel théorique au pas détecté (15 min, horaire…).",
      },
      {
        title: "Valeur négative — à nuancer selon le rôle",
        kind: "info",
        description:
          "Pour un compteur de consommation, presque toujours une erreur. Pour un compteur de production ou d'injection (ex. photovoltaïque), une convention de signe différente peut être normale.",
        detection: "Seuil « valeurs négatives autorisées » piloté par le profil d'usage du compteur (le profil « Production » l'autorise, les autres non) plutôt que globalement pour tout l'import.",
      },
      {
        title: "Dérive de facteur d'échelle",
        kind: "info",
        description:
          "Mauvais rapport de transformation (TC/TT), changement de compteur avec un coefficient différent, unité mal convertie : toutes les valeurs d'une période entière sont systématiquement décalées (×N ou ÷N) mais restent cohérentes entre elles.",
        detection:
          "Le plus insidieux : invisible à une comparaison locale, puisque la référence glissante se décale avec les données. Nécessite un seuil absolu (puissance souscrite, capacité du site) ou une comparaison à une période équivalente plus éloignée.",
      },
      {
        title: "Faux positifs liés au profil journalier",
        kind: "info",
        description: "La consommation a une forme marquée (creux de nuit, pic en journée) ; une pointe normale peut ressembler à une anomalie si la référence mélange jour et nuit.",
        detection:
          "C'est tout l'intérêt des profils d'usage ci-dessous : chaque profil (logement, tertiaire, scolaire, production…) adapte la sensibilité et la fenêtre de référence à son propre rythme jour/nuit et semaine/week-end, au lieu d'appliquer les mêmes seuils à tous les compteurs.",
      },
    ],
  },
  {
    kind: "livraison",
    title: "Compteurs par livraison",
    subtitle: "Intervalles irréguliers — la valeur est une quantité livrée en une fois, pas un relevé périodique",
    examples: "Mazout, granulés, bois — bons de livraison",
    errors: [
      {
        title: "Livraison en double",
        kind: "incoherence",
        description: "La même livraison saisie deux fois (même date, même volume).",
        detection: "Détection de doublons par date et volume identiques.",
      },
      {
        title: "Volume aberrant",
        kind: "incoherence",
        description: "Erreur de saisie du bon de livraison (unité, virgule, chiffre).",
        detection: "Comparaison aux volumes livrés habituels pour ce compteur/cette cuve.",
      },
      {
        title: "Incohérence chronologique",
        kind: "incoherence",
        description: "Une livraison datée avant la précédente, ou une date de livraison dans le futur.",
        detection: "Vérification de l'ordre chronologique des bons de livraison.",
      },
      {
        title: "Confusion d'unité",
        kind: "incoherence",
        description: "Litres et kilogrammes mélangés (typiquement pour les granulés de bois), faussant la comparaison des volumes.",
        detection: "Contrôle de cohérence de l'unité déclarée pour un même compteur d'une livraison à l'autre.",
      },
      {
        title: "Livraison manquante",
        kind: "manquante",
        description: "Pas de nouvelle livraison alors que la cuve devrait être vide, vu la consommation estimée — difficile à détecter sans modèle de consommation.",
        detection: "Pas de détection automatique fiable à ce jour ; nécessite une estimation de la consommation entre deux livraisons.",
      },
    ],
  },
];

const KIND_STYLES: Record<ErrorKind, { dot: string; label: string }> = {
  incoherence: { dot: "bg-red-500", label: "Incohérence" },
  manquante: { dot: "bg-amber-500", label: "Valeur manquante" },
  info: { dot: "bg-geneva-600", label: "À surveiller" },
};

// Fixed display order for the usage profiles nested under each category —
// the organisation-wide default first, then each confirmed usage.
const USAGE_ORDER = ["indéterminé", "logement", "tertiaire", "scolaire", "production"];

type FieldKey = keyof CriteriaProfileUpdate;

interface FieldDef {
  key: FieldKey;
  label: string;
  type: "number" | "integer" | "boolean";
  step?: number;
  min?: number;
  max?: number;
}

const FIELD_DEFS: FieldDef[] = [
  { key: "spike_deviation_pct", label: "Seuil de détection d'un pic (%)", type: "number", step: 1, min: 0, max: 500 },
  { key: "drop_deviation_pct", label: "Seuil de détection d'une chute (%)", type: "number", step: 1, min: 0, max: 100 },
  { key: "reference_window_periods", label: "Taille de la fenêtre de référence (points)", type: "integer", min: 3, max: 5000 },
  { key: "flatline_min_run", label: "Relevés inchangés avant alerte (plateau)", type: "integer", min: 2, max: 10000 },
  { key: "allow_negative_values", label: "Autoriser les valeurs négatives", type: "boolean" },
  { key: "historical_min_points", label: "Historique minimum requis (points)", type: "integer", min: 3, max: 10000 },
  { key: "robust_mad_multiplier", label: "Multiplicateur MAD (robustesse statistique)", type: "number", step: 0.5, min: 0, max: 20 },
  { key: "historical_extreme_ratio", label: "Ratio extrême vs historique", type: "number", step: 0.5, min: 1, max: 100 },
  { key: "zero_active_min_history", label: "Historique minimum — créneau actif à zéro", type: "integer", min: 2, max: 10000 },
  { key: "seasonal_activity_min_history", label: "Historique minimum — saisonnalité", type: "integer", min: 2, max: 10000 },
  { key: "timestamp_tolerance_pct", label: "Tolérance sur l'horodatage (%)", type: "number", step: 1, min: 0, max: 50 },
];

export default function ParametresPage() {
  const [profiles, setProfiles] = useState<CriteriaProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCriteriaProfiles()
      .then(setProfiles)
      .catch((e) => setError((e as Error).message));
  }, []);

  function handleSaved(updated: CriteriaProfile) {
    setProfiles((prev) => (prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev));
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Types d'erreurs recherchées"
        subtitle="Les erreurs typiques pour chaque famille de compteur, et les seuils de détection appliqués selon l'usage du compteur."
      />
      <div className="flex-1 space-y-6 px-8 pb-10 pt-6">
        {CATEGORIES.map((cat) => {
          const catProfiles = (profiles ?? [])
            .filter((p) => p.measurement_kind === cat.kind)
            .sort((a, b) => USAGE_ORDER.indexOf(a.usage_profile) - USAGE_ORDER.indexOf(b.usage_profile));
          return (
            <section key={cat.title} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">{cat.title}</h2>
              <p className="mt-1 text-sm text-gray-500">{cat.subtitle}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-geneva-700">{cat.examples}</p>

              <div className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
                {cat.errors.map((err) => (
                  <div key={err.title} className="grid grid-cols-1 gap-2 py-4 md:grid-cols-[1fr_1.4fr]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_STYLES[err.kind].dot}`} />
                        <h3 className="text-sm font-semibold text-gray-900">{err.title}</h3>
                      </div>
                      <p className="mt-1 text-xs font-medium text-gray-400">{KIND_STYLES[err.kind].label}</p>
                      <p className="mt-1.5 text-sm text-gray-600">{err.description}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-700 md:ml-4">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Détection</span>
                      <p className="mt-1">{err.detection}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-900">Seuils de détection par usage</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Chaque profil d'usage applique ses propres seuils à cette famille de compteurs — dépliez-en un pour
                  les ajuster.
                </p>
                {error && <p className="mt-2 text-sm text-red-600">Impossible de charger les profils : {error}</p>}
                {!error && profiles === null && <p className="mt-2 text-sm text-gray-400">Chargement…</p>}
                {!error && profiles !== null && catProfiles.length === 0 && (
                  <p className="mt-2 text-sm text-gray-400">Aucun profil configurable pour cette famille.</p>
                )}
                <div className="mt-3 space-y-2">
                  {catProfiles.map((profile) => (
                    <ProfileEditor key={profile.id} profile={profile} onSaved={handleSaved} />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProfileEditor({ profile, onSaved }: { profile: CriteriaProfile; onSaved: (p: CriteriaProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CriteriaProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const usageLabel = USAGE_PROFILE_LABELS[profile.usage_profile] ?? profile.usage_profile;
  const dirty = FIELD_DEFS.some((f) => values[f.key] !== profile[f.key]);

  function setField(key: FieldKey, value: number | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: CriteriaProfileUpdate = {};
      for (const f of FIELD_DEFS) {
        if (values[f.key] !== profile[f.key]) {
          (payload as Record<string, number | boolean>)[f.key] = values[f.key] as number | boolean;
        }
      }
      const updated = await api.updateCriteriaProfile(profile.id, payload);
      onSaved(updated);
      setValues(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details
      className="group rounded-lg border border-gray-200"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none rounded-lg px-3 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
        {usageLabel}
        {profile.usage_profile === "indéterminé" && (
          <span className="ml-2 text-xs font-normal text-gray-400">(profil par défaut, tant qu'aucun usage n'est confirmé)</span>
        )}
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-gray-100 px-4 py-4 sm:grid-cols-2">
        {FIELD_DEFS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-gray-500">
            {f.label}
            {f.type === "boolean" ? (
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 self-start rounded border-gray-300"
                checked={Boolean(values[f.key])}
                onChange={(e) => setField(f.key, e.target.checked)}
              />
            ) : (
              <input
                type="number"
                step={f.step ?? 1}
                min={f.min}
                max={f.max}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
                value={values[f.key] as number}
                onChange={(e) => setField(f.key, f.type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-4 py-3">
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
        {savedFlash && <span className="text-xs text-green-600">Enregistré</span>}
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-geneva-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-geneva-800 disabled:opacity-40"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </details>
  );
}
