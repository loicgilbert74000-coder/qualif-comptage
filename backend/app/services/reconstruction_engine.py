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
    if granularity == "horaire":
        return (ts.dayofweek, ts.hour)
    if granularity == "journaliere":
        return (ts.month, ts.dayofweek)
    return ts.month  # mensuelle


def reconstruct_series(
    expected_index: pd.DatetimeIndex,
    aligned_values: pd.Series,          # may contain NaN for missing
    bad_timestamps: set[pd.Timestamp],  # points flagged incoherent -> to smooth
    granularity: str,
    skip_timestamps: set[pd.Timestamp] | None = None,  # left untouched even if missing/incoherent
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

    for ts in targets:
        key = _profile_key(ts, granularity)
        if key in profile:
            result[ts] = profile[key]
            methods[ts] = "profil_type"

    # 2) linear interpolation as fallback for whatever the profile couldn't cover
    still_missing = result.isna() | result.index.isin([t for t in targets if t not in methods])
    interp = values.copy()
    interp[list(bad_timestamps)] = np.nan
    interp = interp.interpolate(method="linear", limit_direction="both")
    for ts in targets:
        if ts not in methods or pd.isna(result.get(ts)):
            if pd.notna(interp.get(ts)):
                result[ts] = interp[ts]
                methods[ts] = "interpolation_lineaire"

    # 3) last resort: forward/backward fill
    result = result.ffill().bfill()
    for ts in targets:
        if ts not in methods:
            methods[ts] = "report_valeur_proche"

    n_missing = sum(1 for ts in targets if pd.isna(aligned_values.get(ts)))
    n_smoothed = sum(1 for ts in targets if ts in bad_timestamps)

    return ReconstructionResult(
        values=result,
        methods_used=methods,
        n_missing_filled=n_missing,
        n_incoherence_smoothed=n_smoothed,
    )
