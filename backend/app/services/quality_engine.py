"""Quality engine: works on a plain (timestamp, value) series regardless of
the fluid, the unit or the reporting step. It infers the expected frequency
from the data itself, so the same code path qualifies hourly gas readings,
daily electricity readings or monthly water/mazout deliveries alike.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd

GRANULARITIES = {
    "15min": pd.Timedelta(minutes=15),
    "30min": pd.Timedelta(minutes=30),
    "horaire": pd.Timedelta(hours=1),
    "journaliere": pd.Timedelta(days=1),
    "mensuelle": pd.DateOffset(months=1),
}


@dataclass
class AnomalyRecord:
    subtype: str              # pic, chute, valeur_negative, palier_suspect, absence_releve
    kind: str                 # "incoherence" | "manquante"
    period_start: datetime
    period_end: datetime
    description: str
    deviation_pct: float | None = None


@dataclass
class PointFlag:
    timestamp: datetime
    quality: str               # valide | incoherence | manquante


@dataclass
class MeterQualityReport:
    meter_code: str
    granularity: str
    total_expected: int
    valid_count: int
    incoherence_count: int
    missing_count: int
    quality_pct: float
    anomalies: list[AnomalyRecord] = field(default_factory=list)
    point_flags: list[PointFlag] = field(default_factory=list)
    expected_index: pd.DatetimeIndex | None = None


def infer_granularity(timestamps: pd.Series) -> str:
    ordered = timestamps.dropna().drop_duplicates().sort_values()
    if len(ordered) < 2:
        return "journaliere"
    deltas = ordered.diff().dropna()
    median_delta = deltas.median()
    if median_delta <= pd.Timedelta(minutes=20):
        return "15min"
    if median_delta <= pd.Timedelta(minutes=40):
        return "30min"
    if median_delta <= pd.Timedelta(hours=2):
        return "horaire"
    if median_delta <= pd.Timedelta(days=2):
        return "journaliere"
    return "mensuelle"


def _build_expected_index(start: pd.Timestamp, end: pd.Timestamp, granularity: str) -> pd.DatetimeIndex:
    if granularity in {"15min", "30min"}:
        return pd.date_range(start, end, freq=GRANULARITIES[granularity])
    if granularity == "horaire":
        return pd.date_range(start, end, freq="h")
    if granularity == "journaliere":
        return pd.date_range(start, end, freq="D")
    if start.day == end.day and start.day > 1:
        return pd.date_range(start, end, freq=pd.DateOffset(months=1))
    if start.day == start.days_in_month and end.day == end.days_in_month:
        return pd.date_range(start, end, freq="ME")
    return pd.date_range(start.replace(day=1), end.replace(day=1), freq="MS")


def _group_consecutive(mask_index: list[pd.Timestamp], granularity: str) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Collapse a sorted list of timestamps flagged the same way into
    contiguous (start, end) bands, matching the mock-up's period ranges."""
    if not mask_index:
        return []
    step = GRANULARITIES[granularity]
    bands: list[tuple[pd.Timestamp, pd.Timestamp]] = []
    band_start = band_end = mask_index[0]
    for ts in mask_index[1:]:
        expected_next = band_end + step if granularity != "mensuelle" else (band_end + pd.DateOffset(months=1))
        if ts == expected_next:
            band_end = ts
        else:
            bands.append((band_start, band_end))
            band_start = band_end = ts
    bands.append((band_start, band_end))
    return bands


def _format_period(start: pd.Timestamp, end: pd.Timestamp, granularity: str) -> str:
    fmt = "%d.%m.%Y %H:%M" if granularity in {"15min", "30min"} else ("%d.%m.%Y" if granularity != "horaire" else "%d.%m.%Y %Hh")
    if start == end:
        return start.strftime(fmt)
    return f"{start.strftime(fmt)} - {end.strftime(fmt)}"


def _seasonal_key(ts: pd.Timestamp, granularity: str) -> tuple:
    """Match readings by season and usage slot without requiring another year."""
    if granularity == "mensuelle":
        return (ts.month,)
    if granularity == "journaliere":
        return (ts.month, ts.dayofweek)
    if granularity == "15min":
        return (ts.month, ts.dayofweek, ts.hour, ts.minute)
    if granularity == "30min":
        return (ts.month, ts.dayofweek, ts.hour, ts.minute)
    return (ts.month, ts.dayofweek, ts.hour)


def _historical_bounds(
    history: np.ndarray,
    *,
    minimum_points: int = 6,
    mad_multiplier: float = 6.0,
    extreme_ratio: float = 3.0,
) -> tuple[float, float, float] | None:
    clean = history[np.isfinite(history)]
    if clean.size < minimum_points:
        return None
    median = float(np.median(clean))
    mad = float(np.median(np.abs(clean - median)))
    robust_spread = 1.4826 * mad
    # Require a material difference as well as a robust deviation. This avoids
    # flagging ordinary noise around a very small or near-zero baseline.
    upper = max(median + mad_multiplier * robust_spread, median * extreme_ratio)
    lower = max(0.0, median - mad_multiplier * robust_spread)
    if lower == median and median > 0:
        lower = median * 0.5
    return median, lower, upper


def analyze_series(
    meter_code: str,
    rows: pd.DataFrame,  # columns: timestamp, value
    *,
    spike_deviation_pct: float = 60.0,
    drop_deviation_pct: float = 60.0,
    reference_window_periods: int = 8,
    flatline_min_run: int = 4,
    allow_negative_values: bool = False,
    measurement_kind: str = "indéterminé",
    service_start=None,
    historical_min_points: int = 6,
    robust_mad_multiplier: float = 6.0,
    historical_extreme_ratio: float = 3.0,
    zero_active_min_history: int = 4,
    seasonal_activity_min_history: int = 3,
    timestamp_tolerance_pct: float = 10.0,
) -> MeterQualityReport:
    rows = rows.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    if rows.empty:
        return MeterQualityReport(meter_code, "journaliere", 0, 0, 0, 0, 0.0)

    granularity = infer_granularity(rows["timestamp"])
    regular_index = _build_expected_index(rows["timestamp"].min(), rows["timestamp"].max(), granularity)

    series = rows.set_index("timestamp")["value"]
    series = series[~series.index.duplicated(keep="last")]
    # Keep off-grid readings in the analysis so a shifted timestamp cannot
    # silently disappear during reindexing.
    expected_index = regular_index.union(pd.DatetimeIndex(series.index)).sort_values()
    aligned = series.reindex(expected_index)

    missing_mask = aligned.isna()
    incoherent_ts: dict[pd.Timestamp, tuple[str, float | None]] = {}

    values = aligned.values.astype(float)
    n = len(values)
    seasonal_positions: dict[tuple, list[int]] = {}
    for i, ts in enumerate(expected_index):
        seasonal_positions.setdefault(_seasonal_key(ts, granularity), []).append(i)

    # Timestamp cadence: gaps that are whole multiples of the usual interval
    # are reported as missing readings; fractional/shifted steps are a clock
    # anomaly. For example, 00:00, 00:15, 00:32 is irregular, while 00:00,
    # 00:15, 00:45 indicates one missing quarter-hour.
    ordered_actual = rows.drop_duplicates("timestamp", keep="last").sort_values("timestamp")
    actual_times = pd.DatetimeIndex(ordered_actual["timestamp"])
    if len(actual_times) > 1:
        step = GRANULARITIES[granularity]
        irregular_times: list[pd.Timestamp] = []
        for previous, current in zip(actual_times[:-1], actual_times[1:]):
            delta = current - previous
            if granularity == "mensuelle":
                month_steps = (current.year - previous.year) * 12 + current.month - previous.month
                previous_month_end = previous.day == previous.days_in_month
                current_month_end = current.day == current.days_in_month
                same_schedule = current.day == previous.day or (previous_month_end and current_month_end)
                if month_steps < 1 or not same_schedule:
                    irregular_times.append(current)
            else:
                multiple = max(1, round(delta / step))
                tolerance = max(pd.Timedelta(minutes=1), step * timestamp_tolerance_pct / 100)
                if abs(delta - multiple * step) > tolerance:
                    irregular_times.append(current)
        for ts in irregular_times:
            incoherent_ts[ts] = ("horodatage_irregulier", None)

    null_times = {
        pd.Timestamp(ts)
        for ts, value in zip(rows["timestamp"], rows["value"])
        if pd.isna(value)
    }
    # Reference average built from a "donut" window for sudden short-term
    # deviations. Long-term low/high checks below use matching seasonal slots.
    half = max(reference_window_periods // 2, 2)
    core = max(2, min(5, half // 3))
    previous_index: int | None = None
    index_deltas: dict[int, float] = {}
    for i in range(n):
        v = values[i]
        if np.isnan(v):
            continue
        if v < 0 and not allow_negative_values:
            incoherent_ts[expected_index[i]] = ("valeur_negative", None)
        if measurement_kind == "index":
            if previous_index is not None:
                prev_value = values[previous_index]
                delta = float(v - prev_value)
                index_deltas[i] = delta
                service_day = pd.Timestamp(service_start).date() if service_start else None
                known_replacement = service_day is not None and expected_index[i].date() == service_day
                if delta < 0 and not known_replacement:
                    incoherent_ts[expected_index[i]] = ("index_decreasing", None)
            previous_index = i
            continue

        if measurement_kind not in {"livraison", "niveau_stock"}:
            # Local short-term spikes/drops; do not use cumulative index values.
            lo, hi = max(0, i - half), min(n, i + half + 1)
            window = np.array([values[j] for j in range(lo, hi) if abs(j - i) > core and np.isfinite(values[j])])
            if window.size >= 3:
                ref = float(np.median(window))
                if ref != 0:
                    deviation = (v - ref) / abs(ref) * 100
                    if deviation >= spike_deviation_pct and expected_index[i] not in incoherent_ts:
                        incoherent_ts[expected_index[i]] = ("pic", round(deviation, 1))
                    elif deviation <= -drop_deviation_pct and expected_index[i] not in incoherent_ts:
                        incoherent_ts[expected_index[i]] = ("chute", round(deviation, 1))

        if measurement_kind == "consommation":
            # Compare with the same season and usage slot (weekday/hour),
            # excluding this point. Sparse histories are left unclassified.
            peer_indices = seasonal_positions[_seasonal_key(expected_index[i], granularity)]
            history = np.array([values[j] for j in peer_indices if j != i and np.isfinite(values[j])])
            if v == 0:
                positive_history = history[history > 0]
                if len(positive_history) >= zero_active_min_history and float(np.median(positive_history)) > 0:
                    incoherent_ts[expected_index[i]] = ("zero_saison", None)
            else:
                bounds = _historical_bounds(
                    history,
                    minimum_points=historical_min_points,
                    mad_multiplier=robust_mad_multiplier,
                    extreme_ratio=historical_extreme_ratio,
                )
                if bounds is not None and expected_index[i] not in incoherent_ts:
                    median, lower, upper = bounds
                    if median > 0 and v > upper:
                        incoherent_ts[expected_index[i]] = ("consommation_haute", round((v / median - 1) * 100, 1))
                    elif median > 0 and v < lower:
                        incoherent_ts[expected_index[i]] = ("consommation_basse", round((v / median - 1) * 100, 1))

    if measurement_kind == "index":
        # A repeated index is suspicious only in an active seasonal slot: at
        # least three comparable historical deltas in that month/usage slot
        # must be positive. Example: four winter quarters at 102.4 after
        # comparable winter quarters normally increase the index.
        plateau_candidates: list[pd.Timestamp] = []
        for i, delta in index_deltas.items():
            if delta != 0:
                continue
            peers = seasonal_positions[_seasonal_key(expected_index[i], granularity)]
            historical_increases = [index_deltas[j] for j in peers if j != i and index_deltas.get(j, 0) > 0]
            if len(historical_increases) >= seasonal_activity_min_history:
                plateau_candidates.append(expected_index[i])
        for start, end in _group_consecutive(sorted(plateau_candidates), granularity):
            run = [ts for ts in plateau_candidates if start <= ts <= end]
            if len(run) >= flatline_min_run:
                for ts in run:
                    incoherent_ts[ts] = ("index_plateau_saison", 0.0)
    elif measurement_kind in {"consommation", "indéterminé"}:
        # Non-index counters can also get stuck at a non-zero value.
        run_val, run_start = None, None
        for i, v in enumerate(values):
            if not np.isfinite(v) or v == 0:
                run_val, run_start = None, None
                continue
            if run_val is not None and v == run_val:
                if i - run_start + 1 >= flatline_min_run and expected_index[i] not in incoherent_ts:
                    incoherent_ts[expected_index[i]] = ("palier_suspect", 0.0)
            else:
                run_val, run_start = v, i

    missing_ts = [ts for ts, is_missing in zip(expected_index, missing_mask) if is_missing and ts not in null_times]
    incoherence_ts_sorted = sorted(incoherent_ts.keys())

    anomalies: list[AnomalyRecord] = []
    subtypes = (
        "pic", "chute", "valeur_negative", "palier_suspect", "index_decreasing",
        "index_plateau_saison", "zero_saison", "consommation_basse", "consommation_haute",
        "horodatage_irregulier",
    )
    for sub in subtypes:
        pts = sorted(ts for ts, (s, _) in incoherent_ts.items() if s == sub)
        for start, end in _group_consecutive(pts, granularity):
            devs = [incoherent_ts[ts][1] for ts in incoherent_ts if start <= ts <= end and incoherent_ts[ts][0] == sub]
            dev = max(devs, key=abs) if devs and devs[0] is not None else None
            label = {
                "pic": f"Pic de consommation ({'+' if dev and dev > 0 else ''}{dev:.0f}% vs référence)" if dev is not None else "Pic de consommation",
                "chute": f"Chute anormale ({dev:.0f}% vs référence)" if dev is not None else "Chute anormale",
                "valeur_negative": "Valeur négative relevée",
                "palier_suspect": "Valeur constante sur plusieurs périodes (compteur bloqué ?)",
                "index_decreasing": "Index en baisse : vérifier une remise à zéro ou un remplacement de compteur non déclaré",
                "index_plateau_saison": "Index bloqué pendant une période active selon l’historique saisonnier",
                "zero_saison": "Consommation nulle alors que l’historique indique une période active",
                "consommation_basse": f"Consommation anormalement basse ({dev:.0f}% vs référence historique)" if dev is not None else "Consommation anormalement basse vs historique",
                "consommation_haute": f"Consommation anormalement haute (+{dev:.0f}% vs référence historique)" if dev is not None else "Consommation anormalement haute vs historique",
                "horodatage_irregulier": "Horodatage décalé par rapport à l’intervalle habituel",
            }[sub]
            anomalies.append(
                AnomalyRecord(
                    subtype=sub,
                    kind="incoherence",
                    period_start=start.to_pydatetime(),
                    period_end=end.to_pydatetime(),
                    description=label,
                    deviation_pct=dev,
                )
            )

    for start, end in _group_consecutive(sorted(null_times), granularity):
        anomalies.append(
            AnomalyRecord(
                subtype="valeur_nulle",
                kind="manquante",
                period_start=start.to_pydatetime(),
                period_end=end.to_pydatetime(),
                description="Valeur nulle dans la série source",
            )
        )

    for start, end in _group_consecutive(missing_ts, granularity):
        n_points = int((end - start) / GRANULARITIES[granularity]) + 1 if granularity != "mensuelle" else None
        unit_label = {"15min": "quart(s) d’heure", "30min": "demi-heure(s)", "horaire": "heure(s)", "journaliere": "jour(s)", "mensuelle": "mois"}[granularity]
        count_txt = f"{n_points} {unit_label}" if n_points else unit_label
        anomalies.append(
            AnomalyRecord(
                subtype="absence_releve",
                kind="manquante",
                period_start=start.to_pydatetime(),
                period_end=end.to_pydatetime(),
                description=f"Absence de relevé ({count_txt})",
            )
        )

    point_flags = []
    for ts in expected_index:
        if ts in missing_mask.index and missing_mask[ts]:
            q = "manquante"
        elif ts in incoherent_ts:
            q = "incoherence"
        else:
            q = "valide"
        point_flags.append(PointFlag(timestamp=ts.to_pydatetime(), quality=q))

    total = len(expected_index)
    missing_count = int(missing_mask.sum())
    incoherence_count = sum(1 for ts in incoherence_ts_sorted if not missing_mask.get(ts, False))
    valid_count = total - missing_count - incoherence_count
    quality_pct = round(valid_count / total * 100, 1) if total else 0.0

    return MeterQualityReport(
        meter_code=meter_code,
        granularity=granularity,
        total_expected=total,
        valid_count=valid_count,
        incoherence_count=incoherence_count,
        missing_count=missing_count,
        quality_pct=quality_pct,
        anomalies=anomalies,
        point_flags=point_flags,
        expected_index=expected_index,
    )


def batch_quality_score(reports: list[MeterQualityReport]) -> float:
    total = sum(r.total_expected for r in reports)
    if total == 0:
        return 0.0
    valid = sum(r.valid_count for r in reports)
    return round(valid / total * 100, 1)
