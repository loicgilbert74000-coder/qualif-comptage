"""Generates a human-readable diagnosis and a suggested resolution for one
detected anomaly, tailored to the meter's fluid/role/measurement_kind.

This is a rule-based heuristic today, not a trained model — it mirrors the
knowledge already documented on the "Types d'erreurs" page. It is exposed to
the user framed as an assistant still "learning" (an early, informative-only
suggestion the person can accept or override), both because that is an
honest description of a hand-written rule set and because it leaves room to
later replace this module with something that actually learns from the
corrections people make, without changing the API shape.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Diagnosis:
    diagnosis: str
    suggestion: str
    recommended_action: str  # "corriger" | "valider" | "a_decider"


def _is_production_or_injection(role: str) -> bool:
    role = (role or "").lower()
    return "production" in role or "injection" in role


def diagnose(
    *,
    subtype: str,
    anomaly_type: str,
    measurement_kind: str,
    fluid_type: str,
    role: str,
    deviation_pct: float | None,
) -> Diagnosis:
    fluid = fluid_type or "ce fluide"
    dev_txt = f"{deviation_pct:+.0f}%" if deviation_pct is not None else None

    if subtype == "chute" and measurement_kind == "index":
        return Diagnosis(
            diagnosis=(
                f"Chute de l'index sur un compteur à cumul ({fluid}). Deux causes typiques : un remplacement "
                "de compteur ou une remise à zéro (événement normal, l'index redémarre à 0), ou une erreur de "
                "saisie/transcription du relevé."
            ),
            suggestion=(
                "Si un changement de compteur est confirmé pour cette période, validez la zone en l'état. "
                "Sinon, une correction par profil type (valeur similaire aux relevés comparables) est proposée."
            ),
            recommended_action="a_decider",
        )

    if subtype == "pic" and measurement_kind == "index":
        return Diagnosis(
            diagnosis=(
                f"Pic ponctuel sur un compteur à cumul ({fluid}){' (' + dev_txt + ' vs référence)' if dev_txt else ''} "
                "— le plus souvent un chiffre mal recopié (zéro en trop, inversion, virgule décalée) à la saisie."
            ),
            suggestion="Correction par profil type recommandée : la valeur sera ramenée à la tendance des relevés voisins.",
            recommended_action="corriger",
        )

    if subtype in ("pic", "chute") and measurement_kind == "consommation":
        label = "Pic" if subtype == "pic" else "Chute"
        return Diagnosis(
            diagnosis=(
                f"{label} ponctuel sur une courbe de charge ({fluid}){' (' + dev_txt + ')' if dev_txt else ''} — "
                "généralement un défaut capteur, un transitoire électrique ou une erreur de transmission isolée."
            ),
            suggestion="Correction par profil type recommandée (même créneau horaire sur les jours comparables).",
            recommended_action="corriger",
        )

    if subtype == "valeur_negative":
        if _is_production_or_injection(role):
            return Diagnosis(
                diagnosis=(
                    f"Valeur négative sur un compteur de {role} ({fluid}). Pour ce rôle, une convention de signe "
                    "différente (production/injection) peut rendre une valeur négative normale."
                ),
                suggestion="Vérifiez le sens de comptage attendu : validez en l'état si c'est cohérent, sinon corrigez.",
                recommended_action="a_decider",
            )
        return Diagnosis(
            diagnosis=f"Valeur négative relevée sur un compteur de consommation ({fluid}) — presque toujours une erreur de saisie ou de calcul en amont.",
            suggestion="Correction par profil type recommandée.",
            recommended_action="corriger",
        )

    if subtype == "palier_suspect":
        return Diagnosis(
            diagnosis=(
                f"Valeur strictement identique sur plusieurs périodes consécutives ({fluid}) — compteur ou "
                "télétransmission bloqués, ou relevé recopié par erreur. Peut aussi être une vraie période "
                "d'inoccupation (nuit, fermeture) si la valeur est 0."
            ),
            suggestion="Si une inoccupation réelle explique ce palier, validez en l'état ; sinon, correction par profil type.",
            recommended_action="a_decider",
        )

    if subtype == "absence_releve":
        if measurement_kind == "livraison":
            return Diagnosis(
                diagnosis=(
                    f"Aucune livraison enregistrée pour cette période ({fluid}). Sans modèle de consommation, "
                    "impossible de savoir avec certitude si une livraison a simplement été omise ou si la cuve "
                    "n'était pas encore vide."
                ),
                suggestion="Vérification manuelle recommandée (bon de livraison, niveau de cuve) plutôt qu'une correction automatique.",
                recommended_action="a_decider",
            )
        if measurement_kind == "index":
            return Diagnosis(
                diagnosis=f"Relevé manquant pour cette période ({fluid}) — relevé oublié ou fichier incomplet.",
                suggestion="Comblement par profil type / interpolation entre les relevés voisins recommandé.",
                recommended_action="corriger",
            )
        return Diagnosis(
            diagnosis=f"Trou dans la courbe de charge ({fluid}) — coupure de télérelève ou maintenance, le plus souvent bref.",
            suggestion="Comblement par profil type (même créneau horaire sur les jours comparables) recommandé.",
            recommended_action="corriger",
        )

    return Diagnosis(
        diagnosis=f"Anomalie détectée sur {fluid}.",
        suggestion="Examinez la zone et choisissez de la valider en l'état ou de la corriger par simulation.",
        recommended_action="a_decider",
    )
