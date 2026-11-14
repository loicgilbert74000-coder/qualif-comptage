"""Reconstruction by simulation.

Missing points are filled, and inconsistent points (pics, chutes, valeurs
négatives, paliers suspects) are smoothed, using a *typical profile* learned
from the meter's own valid history: same hour-of-day for hourly series, same
weekday/month for daily series, same calendar month for monthly series. This
is what the mock-up's bottom banner calls "comblement des manquants, lissage
des incohérences" — it never invents consumption out of thin air, it
simulates what a comparable, valid period looked like.

When the profile has too few comparable points (edges of the series, very
short history) the engine falls back to linear interpolation, then to a
simple forward/backward fill as a last resort.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class ReconstructionResult:
    values: pd.Series           # same index as input, holes/anomalies replaced
    methods_used: dict          # timestamp -> method name, for the audit trail
    n_missing_filled: int
    n_incoherence_smoothed: int


def _profile_key(ts: pd.Timestamp, granularity: str):
    if granularity in {"15min", "30min"}:
        return (ts.dayofweek, ts.hour, ts.minute)
    if granularity == "horaire":
        return (ts.dayofweek, ts.hour)
    if granularity == "journaliere":
        return (ts.month, ts.dayofweek)
    return ts.month  # mensuelle


# Every reconstruction technique the engine knows, keyed the same way as
# ReconstructionResult.methods_used, so a person can be offered a specific
# one instead of always getting the automatic profil_type -> interpolation
# -> report cascade.
METHOD_PROFIL_TYPE = "profil_type"
METHOD_INTERPOLATION = "interpolation_lineaire"
METHOD_REPORT_DERNIER = "report_dernier_releve"
METHOD_VALEUR_ZERO = "valeur_zero"
METHOD_FALLBACK = "report_valeur_proche"  # only ever chosen automatically, as a last resort


def available_correction_methods(measurement_kind: str, role: str) -> list[dict]:
    """Which correction techniques make sense to offer as a choice for one
    meter, given its nature (index à cumul, courbe de consommation,
    livraison, ...) and its role (consommation, production, injection).
    Returned in a sensible default order; the first is the one already
    highlighted elsewhere as "recommandée"."""
    role_l = (role or "").lower()
    is_prod_or_inj = "production" in role_l or "injection" in role_l

    options = [
        {
            "method": METHOD_PROFIL_TYPE,
            "label": "Profil type",
            "description": (
                "Valeur reprise du profil type du compteur : la médiane des périodes comparables "
                "(même jour de la semaine et même créneau horaire)."
            ),
        },
        {
            "method": METHOD_INTERPOLATION,
            "label": "Interpolation linéaire",
            "description": "Valeur interpolée linéairement entre le point valide précédent et le point valide suivant.",
        },
    ]

    if measurement_kind == "index":
        options.append(
            {
                "method": METHOD_REPORT_DERNIER,
                "label": "Report du dernier relevé",
                "description": (
                    "L'index reste inchangé jusqu'au prochain relevé valide — pertinent après un remplacement "
                    "de compteur ou une remise à zéro, en attendant un relevé fiable."
                ),
            }
        )
    else:
        options.append(
            {
                "method": METHOD_REPORT_DERNIER,
                "label": "Report de la dernière valeur",
                "description": "La dernière valeur valide connue est reconduite jusqu'au prochain point valide.",
            }
        )

    if measurement_kind == "consommation" or is_prod_or_inj:
        options.append(
            {
                "method": METHOD_VALEUR_ZERO,
                "label": "Valeur nulle",
                "description": (
                    "Consommation ou production nulle sur la période — pertinent pour un site fermé, une "
                    "installation à l'arrêt, ou une injection nocturne nulle pour un compteur de production."
                ),
            }
        )

    return options


def reconstruct_series(
    expected_index: pd.DatetimeIndex,
    aligned_values: pd.Series,          # may contain NaN for missing
    bad_timestamps: set[pd.Timestamp],  # points flagged incoherent -> to smooth
    granularity: str,
    skip_timestamps: set[pd.Timestamp] | None = None,  # left untouched even if missing/incoherent
    method: str | None = None,          # force one specific technique instead of the automatic cascade
) -> ReconstructionResult:
    skip_timestamps = skip_timestamps or set()
    values = aligned_values.copy()
    valid_mask = (~values.index.isin(bad_timestamps)) & values.notna()

    # 1) build the typical profile from valid points only
    keys = pd.Series([_profile_key(ts, granularity) for ts in expected_index], index=expected_index)
    profile: dict = {}
    for key, grp in values[valid_mask].groupby(keys[valid_mask]):
        profile[key] = float(grp.median())

    methods: dict = {}
    targets = sorted((set(bad_timestamps) | set(values.index[values.isna()])) - skip_timestamps)
    result = values.copy()

    def _apply_profile():
        for ts in targets:
            if ts in methods:
                continue
            key = _profile_key(ts, granularity)
            if key in profile:
                result[ts] = profile[key]
                methods[ts] = METHOD_PROFIL_TYPE

    def _apply_interpolation():
        interp = values.copy()
        interp[list(bad_timestamps)] = np.nan
        interp = interp.interpolate(method="linear", limit_direction="both")
        for ts in targets:
            if ts in methods:
                continue
            if pd.notna(interp.get(ts)):
                result[ts] = interp[ts]
                methods[ts] = METHOD_INTERPOLATION

    def _apply_report_dernier():
        ff = values.copy()
        ff[list(bad_timestamps)] = np.nan
        ff = ff.ffill()
        for ts in targets:
            if ts in methods:
                continue
            if pd.notna(ff.get(ts)):
                result[ts] = ff[ts]
                methods[ts] = METHOD_REPORT_DERNIER

    def _apply_zero():
        for ts in targets:
            if ts in methods:
                continue
            result[ts] = 0.0
            methods[ts] = METHOD_VALEUR_ZERO

    if method == METHOD_PROFIL_TYPE:
        _apply_profile()
    elif method == METHOD_INTERPOLATION:
        _apply_interpolation()
    elif method == METHOD_REPORT_DERNIER:
        _apply_report_dernier()
    elif method == METHOD_VALEUR_ZERO:
        _apply_zero()
    else:
        # Default, automatic cascade (unchanged behaviour when no specific
        # method is requested): try the typical profile first, then fall
        # back to interpolation for whatever it couldn't cover.
        _apply_profile()
        _apply_interpolation()

    # Last resort for whatever is still unresolved, whichever path was
    # taken above — guarantees the result never contains NaN.
    result = result.ffill().bfill()
    for ts in targets:
        if ts not in methods:
            methods[ts] = METHOD_FALLBACK

    n_missing = sum(1 for ts in targets if pd.isna(aligned_values.get(ts)))
    n_smoothed = sum(1 for ts in targets if ts in bad_timestamps)

    return ReconstructionResult(
        values=result,
        methods_used=methods,
        n_missing_filled=n_missing,
        n_incoherence_smoothed=n_smoothed,
    )
