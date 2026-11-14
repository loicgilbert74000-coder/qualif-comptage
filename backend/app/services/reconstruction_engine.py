"""Reconstruction by simulation.

Missing points are filled, and inconsistent points (pics, chutes, valeurs
négatives, paliers suspects) are smoothed, using a *typical profile* learned
from the meter's own valid history: same month and usage slot (weekday/hour)
for sub-daily series, same weekday/month for daily series, same calendar month
for monthly series. This
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
    model_fit_pct: float | None = None  # R² of an environmental model, when one was used


def _profile_key(ts: pd.Timestamp, granularity: str):
    if granularity in {"15min", "30min"}:
        return (ts.month, ts.dayofweek, ts.hour, ts.minute)
    if granularity == "horaire":
        return (ts.month, ts.dayofweek, ts.hour)
    if granularity == "journaliere":
        return (ts.month, ts.dayofweek)
    return (ts.month,)  # mensuelle


# Every reconstruction technique the engine knows, keyed the same way as
# ReconstructionResult.methods_used, so a person can be offered a specific
# one instead of always getting the automatic profil_type -> interpolation
# -> report cascade.
METHOD_PROFIL_TYPE = "profil_type"
METHOD_INTERPOLATION = "interpolation_lineaire"
METHOD_REPORT_DERNIER = "report_dernier_releve"
METHOD_VALEUR_ZERO = "valeur_zero"
METHOD_INDEX_DELTA_PROFILE = "profil_delta_saisonnier"
METHOD_WEATHER_TEMPERATURE = "meteo_temperature"
METHOD_WEATHER_COOLING = "meteo_refroidissement"
METHOD_WEATHER_SOLAR = "meteo_solaire"
METHOD_FALLBACK = "report_valeur_proche"  # only ever chosen automatically, as a last resort


def available_correction_methods(
    measurement_kind: str,
    role: str,
    *,
    fluid_type: str = "",
    anomaly_subtype: str = "",
    has_weather: bool = False,
) -> list[dict]:
    """List corrections suited to this reading, in a safe default order.

    The caller re-ranks these using the simulated series-quality gain. For a
    cumulative index we never use a median of absolute index levels: seasonal
    index *increments* are the comparable quantity.
    """
    role_l = (role or "").lower()
    fluid_l = (fluid_type or "").lower()
    context_l = f"{fluid_l} {role_l}"
    is_prod_or_inj = "production" in role_l or "injection" in role_l

    if measurement_kind == "index":
        options = []
        if anomaly_subtype == "index_plateau_saison":
            options.append({
                "method": METHOD_INDEX_DELTA_PROFILE,
                "label": "Hausse du profil saisonnier",
                "description": "Ré-estime l'index en ajoutant la hausse médiane des mêmes créneaux saisonniers, uniquement si au moins trois hausses comparables sont disponibles.",
            })
        options.extend([
            {"method": METHOD_INTERPOLATION, "label": "Interpolation linéaire", "description": "Interpole entre les index valides avant et après la zone."},
            {"method": METHOD_REPORT_DERNIER, "label": "Report du dernier index", "description": "Conserve le dernier index valide; adapté à une remise à zéro ou un remplacement confirmé."},
        ])
    else:
        options = [
            {"method": METHOD_PROFIL_TYPE, "label": "Profil type", "description": "Médiane des valeurs du même créneau saisonnier et horaire."},
            {"method": METHOD_INTERPOLATION, "label": "Interpolation linéaire", "description": "Valeur interpolée entre les points valides qui encadrent la zone."},
            {"method": METHOD_REPORT_DERNIER, "label": "Report de la dernière valeur", "description": "Reconduit la dernière valeur valide jusqu'au prochain point fiable."},
        ]
        if measurement_kind == "consommation" or is_prod_or_inj:
            options.append({
                "method": METHOD_VALEUR_ZERO,
                "label": "Valeur nulle",
                "description": "À retenir seulement si l'historique du même créneau ou un contexte confirmé (fermeture, travaux, arrêt) justifie une activité nulle.",
            })

    if has_weather and measurement_kind == "consommation":
        if any(word in context_l for word in ("froid", "climatisation", "clim", "fad")):
            options.append({
                "method": METHOD_WEATHER_COOLING,
                "label": "Profil ajusté à la température (climatisation)",
                "description": "Régression sur les degrés-jours de refroidissement (base 22 °C) et les températures historiques de Genève.",
            })
        elif any(word in context_l for word in ("chaleur", "chauffage", "chaud", "cad", "granul", "pellet", "bois", "fuel", "mazout")) or (
            "gaz" in fluid_l and "chauff" in role_l
        ):
            options.append({
                "method": METHOD_WEATHER_TEMPERATURE,
                "label": "Profil ajusté à la température (chauffage)",
                "description": "Régression sur les degrés-jours de chauffage (base 18 °C) et les températures historiques de Genève.",
            })
        if is_prod_or_inj and any(word in fluid_l for word in ("électricité", "electricite", "elec")):
            options.append({
                "method": METHOD_WEATHER_SOLAR,
                "label": "Profil ajusté au rayonnement solaire",
                "description": "Régression de la production sur le rayonnement solaire horaire de Genève fourni avec la démonstration.",
            })
    return options


def reconstruct_series(
    expected_index: pd.DatetimeIndex,
    aligned_values: pd.Series,          # may contain NaN for missing
    bad_timestamps: set[pd.Timestamp],  # points flagged incoherent -> to smooth
    granularity: str,
    skip_timestamps: set[pd.Timestamp] | None = None,  # left untouched even if missing/incoherent
    method: str | None = None,          # force one specific technique instead of the automatic cascade
    environmental_features: pd.DataFrame | None = None,
) -> ReconstructionResult:
    skip_timestamps = skip_timestamps or set()
    values = aligned_values.copy()
    valid_mask = (~values.index.isin(bad_timestamps)) & values.notna().to_numpy(dtype=bool)
    n = len(values)

    # 1) build the typical profile from valid points only
    keys = pd.Series([_profile_key(ts, granularity) for ts in expected_index], index=expected_index)
    profile: dict = {}
    for key, grp in values[valid_mask].groupby(keys[valid_mask]):
        profile[key] = float(grp.median())

    methods: dict = {}
    model_fit_pct: float | None = None
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

    def _apply_index_delta_profile():
        comparable_deltas: dict[tuple, list[tuple[pd.Timestamp, float]]] = {}
        value_array = values.to_numpy(dtype=float)
        previous = None
        for i in range(n):
            if not valid_mask[i]:
                previous = None  # never turn a gap or flagged point into a multi-period delta
                continue
            if previous is not None and i == previous + 1:
                delta = float(value_array[i] - value_array[previous])
                if delta > 0:
                    key = _profile_key(expected_index[i], granularity)
                    comparable_deltas.setdefault(key, []).append((expected_index[i], delta))
            previous = i
        for ts in targets:
            prior = [idx for idx in range(expected_index.get_loc(ts) - 1, -1, -1)
                     if pd.notna(result.iloc[idx]) and (expected_index[idx] not in bad_timestamps or expected_index[idx] in methods)]
            if not prior:
                continue
            prev_i = prior[0]
            key = _profile_key(ts, granularity)
            history = [d for peer_ts, d in comparable_deltas.get(key, []) if peer_ts < ts]
            if len(history) < 3:
                continue
            result.iloc[expected_index.get_loc(ts)] = float(result.iloc[prev_i]) + float(np.median(history))
            methods[ts] = METHOD_INDEX_DELTA_PROFILE

    def _apply_weather_model(method_name: str):
        nonlocal model_fit_pct
        if environmental_features is None:
            return
        weather = environmental_features.reindex(expected_index)
        if method_name in {METHOD_WEATHER_TEMPERATURE, METHOD_WEATHER_COOLING}:
            if "temperature_2m" not in weather:
                return
            temperature = pd.to_numeric(weather["temperature_2m"], errors="coerce")
            if method_name == METHOD_WEATHER_COOLING:
                x = (temperature - 22.0).clip(lower=0)
            else:
                x = (18.0 - temperature).clip(lower=0)
        else:
            if "shortwave_radiation" not in weather:
                return
            x = pd.to_numeric(weather["shortwave_radiation"], errors="coerce").clip(lower=0)
        x_values = x.to_numpy(dtype=float)
        y_values = values.to_numpy(dtype=float)
        train = valid_mask & np.isfinite(x_values) & np.isfinite(y_values)
        if int(train.sum()) < 12 or float(np.std(x_values[train])) <= 1e-6:
            return
        design = np.column_stack([np.ones(int(train.sum())), x_values[train]])
        y = y_values[train]
        beta, *_ = np.linalg.lstsq(design, y, rcond=None)
        predictions = design @ beta
        residual = float(np.sum((y - predictions) ** 2))
        total = float(np.sum((y - y.mean()) ** 2))
        r_squared = 1.0 - residual / total if total > 1e-9 else 0.0
        if beta[1] <= 0 or r_squared < 0.35:
            return
        model_fit_pct = round(r_squared * 100, 1)
        for ts in targets:
            position = expected_index.get_loc(ts)
            feature = x_values[position]
            if not np.isfinite(feature):
                continue
            result.loc[ts] = max(0.0, float(beta[0] + beta[1] * feature))
            methods[ts] = method_name

    if method == METHOD_INDEX_DELTA_PROFILE:
        _apply_index_delta_profile()
    elif method in {METHOD_WEATHER_TEMPERATURE, METHOD_WEATHER_COOLING, METHOD_WEATHER_SOLAR}:
        _apply_weather_model(method)
    elif method == METHOD_PROFIL_TYPE:
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
        model_fit_pct=model_fit_pct,
    )
