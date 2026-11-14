"""Bundled Geneva reanalysis data used only for the DEMO-GENEVE meters."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd


def _weather_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "app" / "demo_data" / "geneva_weather_2025.csv"
    return Path(__file__).resolve().parents[1] / "demo_data" / "geneva_weather_2025.csv"


def load_geneva_demo_weather(expected_index: pd.DatetimeIndex, granularity: str) -> pd.DataFrame | None:
    """Align the bundled Geneva historical reanalysis with a meter series.

    The file contains hourly 2 m temperature and shortwave radiation from
    Open-Meteo's Historical Weather API for the Geneva city coordinates.
    It is never attached to non-demo meter identifiers.
    """
    path = _weather_path()
    if not path.exists():
        return None
    raw = pd.read_csv(path, skiprows=3)
    raw = raw.rename(columns={
        "time": "timestamp",
        "temperature_2m (°C)": "temperature_2m",
        "shortwave_radiation (W/m²)": "shortwave_radiation",
    })
    if not {"timestamp", "temperature_2m", "shortwave_radiation"}.issubset(raw.columns):
        return None
    raw["timestamp"] = pd.to_datetime(raw["timestamp"], errors="coerce")
    hourly = raw.dropna(subset=["timestamp"]).set_index("timestamp").sort_index()[["temperature_2m", "shortwave_radiation"]]
    if granularity == "journaliere":
        daily = pd.DataFrame({
            "temperature_2m": hourly["temperature_2m"].resample("D").mean(),
            "shortwave_radiation": hourly["shortwave_radiation"].resample("D").sum() / 1000.0,
        })
        aligned = daily.reindex(expected_index.normalize())
        aligned.index = expected_index
        return aligned
    if granularity == "mensuelle":
        monthly = pd.DataFrame({
            "temperature_2m": hourly["temperature_2m"].resample("MS").mean(),
            "shortwave_radiation": hourly["shortwave_radiation"].resample("MS").sum() / 1000.0,
        })
        aligned = monthly.reindex(expected_index.normalize())
        aligned.index = expected_index
        return aligned
    aligned = hourly.reindex(expected_index)
    return aligned.interpolate(method="time", limit_direction="both")
