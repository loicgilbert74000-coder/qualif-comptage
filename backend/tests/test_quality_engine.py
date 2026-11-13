import numpy as np
import pandas as pd

from app.services.quality_engine import analyze_series
from app.services.reconstruction_engine import reconstruct_series
from app.services.csv_parser import parse_csv_bytes, detect_column_mapping


def test_detect_column_mapping_french_headers():
    mapping = detect_column_mapping(["mois", "id_compteur", "id_site", "fluide", "mesure", "valeur", "unite"])
    assert mapping["horodatage"] == "mois"
    assert mapping["id_compteur"] == "id_compteur"
    assert mapping["valeur"] == "valeur"


def test_parse_csv_bytes_groups_by_meter():
    content = (
        "mois;id_compteur;id_site;fluide;mesure;valeur;unite\n"
        "2021-01;S01-EL;S01;électricité;soutirage;11513;kWh\n"
        "2021-02;S01-EL;S01;électricité;soutirage;11738;kWh\n"
        "2021-01;S01-GZ;S01;gaz;consommation;965;m3\n"
    ).encode()
    result = parse_csv_bytes(content, "test.csv")
    codes = {s.meter_code for s in result.series}
    assert codes == {"S01-EL", "S01-GZ"}
    el = next(s for s in result.series if s.meter_code == "S01-EL")
    assert len(el.rows) == 2
    assert el.fluid_type == "électricité"


def _synthetic_daily_series():
    rng = pd.date_range("2024-01-01", "2024-12-31", freq="D")
    base = 500 + 50 * np.sin(np.linspace(0, 6.28, len(rng)))
    vals = base.copy()
    vals[70:75] += 800  # sustained spike
    vals[295] *= 0.2  # single drop
    rows = pd.DataFrame({"timestamp": rng, "value": vals})
    rows = rows.drop(index=range(195, 209))  # 14-day gap
    rows.loc[rows.index[10], "value"] = -50  # negative reading
    return rows.reset_index(drop=True), base


def test_quality_engine_detects_all_anomaly_types():
    rows, _ = _synthetic_daily_series()
    report = analyze_series("TEST-METER", rows, reference_window_periods=30)

    assert report.granularity == "journaliere"
    assert report.missing_count == 14
    subtypes = {a.subtype for a in report.anomalies}
    assert "pic" in subtypes
    assert "chute" in subtypes
    assert "valeur_negative" in subtypes
    assert "absence_releve" in subtypes
    assert report.quality_pct < 100


def test_quality_engine_clean_series_scores_100():
    # A realistic clean series varies day to day (a genuinely constant value
    # for many consecutive days is itself what the "palier suspect" check is
    # meant to catch, so it must NOT be used here as the "everything is fine"
    # fixture).
    rng = pd.date_range("2024-01-01", "2024-03-31", freq="D")
    values = 500 + 30 * np.sin(np.linspace(0, 12, len(rng))) + np.arange(len(rng)) % 7
    rows = pd.DataFrame({"timestamp": rng, "value": values})
    report = analyze_series("CLEAN-METER", rows)
    assert report.missing_count == 0
    assert report.incoherence_count == 0
    assert report.quality_pct == 100.0


def test_quality_engine_flags_stuck_meter():
    rng = pd.date_range("2024-01-01", "2024-01-31", freq="D")
    rows = pd.DataFrame({"timestamp": rng, "value": [500.0] * len(rng)})
    report = analyze_series("STUCK-METER", rows, flatline_min_run=4)
    assert any(a.subtype == "palier_suspect" for a in report.anomalies)


def test_reconstruction_fills_gaps_and_smooths_anomalies():
    rows, base = _synthetic_daily_series()
    report = analyze_series("TEST-METER", rows, reference_window_periods=30)

    series = rows.set_index("timestamp")["value"]
    series = series[~series.index.duplicated(keep="last")]
    aligned = series.reindex(report.expected_index)
    bad_ts = {pd.Timestamp(pf.timestamp) for pf in report.point_flags if pf.quality == "incoherence"}

    result = reconstruct_series(report.expected_index, aligned, bad_ts, report.granularity)

    assert result.values.isna().sum() == 0
    assert result.n_missing_filled == 14
    assert result.n_incoherence_smoothed == len(bad_ts)
    # the reconstructed spike day should land close to the underlying clean profile
    spike_ts = report.expected_index[72]
    assert abs(result.values[spike_ts] - base[72]) < 100
