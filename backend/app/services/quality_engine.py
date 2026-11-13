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
    if len(timestamps) < 2:
        return "journaliere"
    deltas = timestamps.sort_values().diff().dropna()
    median_delta = deltas.median()
    if median_delta <= pd.Timedelta(hours=2):
        return "horaire"
    if median_delta <= pd.Timedelta(days=2):
        return "journaliere"
    return "mensuelle"


def _build_expected_index(start: pd.Timestamp, end: pd.Timestamp, granularity: str) -> pd.DatetimeIndex:
    if granularity == "horaire":
        return pd.date_range(start, end, freq="h")
    if granularity == "journaliere":
        return pd.date_range(start, end, freq="D")
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
    fmt = "%d.%m.%Y" if granularity != "horaire" else "%d.%m.%Y %Hh"
    if start == end:
        return start.strftime(fmt)
    return f"{start.strftime(fmt)} - {end.strftime(fmt)}"


def analyze_series(
    meter_code: str,
    rows: pd.DataFrame,  # columns: timestamp, value
    *,
    spike_deviation_pct: float = 60.0,
    drop_deviation_pct: float = 60.0,
    reference_window_periods: int = 8,
    flatline_min_run: int = 4,
    allow_negative_values: bool = False,
) -> MeterQualityReport:
    rows = rows.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    if rows.empty:
        return MeterQualityReport(meter_code, "journaliere", 0, 0, 0, 0, 0.0)

    granularity = infer_granularity(rows["timestamp"])
    expected_index = _build_expected_index(rows["timestamp"].min(), rows["timestamp"].max(), granularity)

    series = rows.set_index("timestamp")["value"]
    series = series[~series.index.duplicated(keep="last")]
    aligned = series.reindex(expected_index)

    missing_mask = aligned.isna()
    incoherent_ts: dict[pd.Timestamp, tuple[str, float | None]] = {}

    values = aligned.values.astype(float)
    n = len(values)
    # Reference average built from a "donut" window: points reasonably close
    # in time, but far enough from i that a short sustained anomaly (a spike
    # lasting several consecutive periods) doesn't get absorbed into its own
    # reference. The core exclusion zone grows a bit with the window size so
    # longer windows can still catch short multi-period anomalies.
    half = max(reference_window_periods // 2, 2)
    core = max(2, min(5, half // 3))
    for i in range(n):
        v = values[i]
        if np.isnan(v):
            continue
        lo, hi = max(0, i - half), min(n, i + half + 1)
        window = np.array(
            [values[j] for j in range(lo, hi) if abs(j - i) > core and not np.isnan(values[j])]
        )
        if v < 0 and not allow_negative_values:
            incoherent_ts[expected_index[i]] = ("valeur_negative", None)
            continue
        if window.size < 3:
            continue
        ref = float(np.median(window))
        if ref == 0:
            continue
        deviation = (v - ref) / ref * 100
        if deviation >= spike_deviation_pct:
            incoherent_ts[expected_index[i]] = ("pic", round(deviation, 1))
        elif deviation <= -drop_deviation_pct:
            incoherent_ts[expected_index[i]] = ("chute", round(deviation, 1))

    # flatline / stuck meter detection
    run_val, run_start = None, None
    for i in range(n):
        v = values[i]
        if np.isnan(v) or v == 0:
            run_val, run_start = None, None
            continue
        if run_val is not None and v == run_val:
            if i - run_start + 1 >= flatline_min_run and expected_index[i] not in incoherent_ts:
                incoherent_ts[expected_index[i]] = ("palier_suspect", 0.0)
        else:
            run_val, run_start = v, i

    missing_ts = [ts for ts, is_missing in zip(expected_index, missing_mask) if is_missing]
    incoherence_ts_sorted = sorted(incoherent_ts.keys())

    anomalies: list[AnomalyRecord] = []
    for sub in ("pic", "chute", "valeur_negative", "palier_suspect"):
        pts = sorted(ts for ts, (s, _) in incoherent_ts.items() if s == sub)
        for start, end in _group_consecutive(pts, granularity):
            devs = [incoherent_ts[ts][1] for ts in incoherent_ts if start <= ts <= end and incoherent_ts[ts][0] == sub]
            dev = max(devs, key=abs) if devs and devs[0] is not None else None
            label = {
                "pic": f"Pic de consommation ({'+' if dev and dev > 0 else ''}{dev:.0f}% vs référence)" if dev is not None else "Pic de consommation",
                "chute": f"Chute anormale ({dev:.0f}% vs référence)" if dev is not None else "Chute anormale",
                "valeur_negative": "Valeur négative relevée",
                "palier_suspect": "Valeur constante sur plusieurs périodes (compteur bloqué ?)",
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

    for start, end in _group_consecutive(missing_ts, granularity):
        n_points = int((end - start) / GRANULARITIES[granularity]) + 1 if granularity != "mensuelle" else None
        unit_label = {"horaire": "heure(s)", "journaliere": "jour(s)", "mensuelle": "mois"}[granularity]
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
        if ts in incoherent_ts:
            q = "incoherence"
        elif ts in missing_mask.index and missing_mask[ts]:
            q = "manquante"
        else:
            q = "valide"
        point_flags.append(PointFlag(timestamp=ts.to_pydatetime(), quality=q))

    total = len(expected_index)
    missing_count = len(missing_ts)
    incoherence_count = len(incoherence_ts_sorted)
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
