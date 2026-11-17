"""Heuristic usage-profile detection from a meter's own curve shape, so the
app can SUGGEST a category (logement / tertiaire / scolaire / production)
instead of asking the user to pick one blind for every single meter.

Deliberately simple, explainable ratio tests — day/night contrast,
weekday/weekend contrast, a summer dip — consistent with the rest of this
engine's approach, not a trained model. Good enough to catch the usual,
clear-cut cases; ambiguous curves are left undetected (None) rather than
guessed, since a wrong suggestion is worse than no suggestion. This is
always only a suggestion: nothing here ever changes detection behaviour by
itself, only `Meter.usage_profile` (set once a human confirms it) does.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MIN_POINTS = 50  # below this, there's not enough signal to guess anything


def detect_usage_profile(df: pd.DataFrame, *, measurement_kind: str, role: str | None = None) -> str | None:
    """`df` has columns timestamp/value. For an index meter this should be
    its derived consumption series (deltas), not the raw cumulative index —
    the shape tests below only make sense on a quantity-per-period series."""
    if measurement_kind not in {"consommation", "index"}:
        return None  # delivery/stock meters: usage doesn't drive their detection

    rows = df.dropna(subset=["value"])
    if len(rows) < MIN_POINTS:
        return None

    if role in {"production", "injection"}:
        return "production"

    ts = pd.DatetimeIndex(rows["timestamp"])
    values = rows["value"].to_numpy(dtype=float)

    def _mean(mask: np.ndarray) -> float | None:
        return float(np.nanmean(values[mask])) if mask.sum() >= 10 else None

    night_mask = (ts.hour >= 22) | (ts.hour < 6)
    day_mask = (ts.hour >= 10) & (ts.hour < 16)
    night_avg, day_avg = _mean(night_mask), _mean(day_mask)

    # Production signature: near-zero at night, a positive daytime bell —
    # catches PV meters even when their role wasn't filled in on import.
    if day_avg is not None and night_avg is not None and day_avg > 0 and abs(night_avg) < max(0.05 * day_avg, 1e-6):
        return "production"

    weekday_mask, weekend_mask = ts.dayofweek < 5, ts.dayofweek >= 5
    weekday_avg, weekend_avg = _mean(weekday_mask), _mean(weekend_mask)
    weekday_weekend_ratio = 1.0
    if weekday_avg is not None and weekend_avg is not None:
        weekday_weekend_ratio = weekday_avg / weekend_avg if weekend_avg > 1e-9 else (2.0 if weekday_avg > 1e-9 else 1.0)

    day_night_ratio = 1.0
    if day_avg is not None and night_avg is not None:
        day_night_ratio = day_avg / night_avg if night_avg > 1e-9 else (2.0 if day_avg > 1e-9 else 1.0)

    summer_mask, rest_mask = ts.month.isin([7, 8]), ~ts.month.isin([7, 8])
    summer_avg, rest_avg = _mean(summer_mask), _mean(rest_mask)
    summer_dip_ratio = 1.0
    if summer_avg is not None and rest_avg is not None and rest_avg > 1e-9:
        summer_dip_ratio = summer_avg / rest_avg

    strong_weekly_pattern = weekday_weekend_ratio >= 1.4 or day_night_ratio >= 1.4
    if strong_weekly_pattern:
        # A pronounced summer dip (school holidays) separates "scolaire"
        # from an office building running close to year-round.
        return "scolaire" if summer_dip_ratio <= 0.6 else "tertiaire"
    if weekday_weekend_ratio <= 1.15 and day_night_ratio <= 1.15:
        return "logement"  # flat profile: no structural weekly/daily rhythm
    return None  # not clear-cut enough either way
