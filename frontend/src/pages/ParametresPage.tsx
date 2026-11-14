import TopBar from "../components/TopBar";

type ErrorKind = "incoherence" | "manquante" | "info";

interface ErrorEntry {
  title: string;
  kind: ErrorKind;
  description: string;
  detection: string;
}

interface MeterCategory {
  title: string;
  subtitle: string;
  examples: string;
  errors: ErrorEntry[];
}

const CATEGORIES: MeterCategory[] = [
  {
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
        detection: "Seuil « valeurs négatives autorisées » à piloter selon le rôle du compteur (consommation / production / injection), pas globalement pour tout l'import.",
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
          "Idéalement : comparer chaque point à son propre créneau horaire sur les jours voisins (comme le fait déjà le moteur de reconstruction pour combler les trous), plutôt qu'à ses voisins immédiats dans le temps.",
      },
    ],
  },
  {
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

export default function ParametresPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Types d'erreurs recherchées"
        subtitle="Les erreurs typiques pour chaque famille de compteur, et comment l'application les détecte."
      />
      <div className="flex-1 space-y-6 px-8 pb-10 pt-6">
        {CATEGORIES.map((cat) => (
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
          </section>
        ))}
      </div>
    </div>
  );
}
