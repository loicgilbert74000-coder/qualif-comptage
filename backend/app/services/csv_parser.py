"""Generic ingestion for *any* meter type.

The platform makes no assumption about the fluid (électricité, gaz, eau,
chaleur, mazout, granulés, ...), the reporting step (horaire, journalière,
mensuelle) or the file's exact column names. It auto-detects a sensible
column mapping from common French/English header variants and lets the
caller override it (stored on the ImportBatch so re-analysis is
reproducible).

Expected logical fields, as described on the import screen:
  - horodatage   : a timestamp or period (datetime, date, or "YYYY-MM")
  - id_compteur  : the meter's identifier
  - valeur       : the raw reading, in the meter's native unit
  - unite        : optional; falls back to the meter's registered unit
  - id_batiment / fluide / mesure : optional extra columns, used to
    auto-create Building/Meter records on first encounter
"""
from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
from app.services.meter_classifier import classify_meter

# Header variants we recognise out of the box, lower-cased & accent-stripped,
# ORDERED BY PREFERENCE (first = best match) when several columns of a file
# could plausibly fill the same logical field — e.g. a file with both "date"
# (day only) and "heure_deduite" (day + hour) must pick the latter, and a
# file with both "volume_m3" and "energie_kwh" must pick deterministically
# rather than whichever happens to come first in the file.
HEADER_ALIASES: dict[str, list[str]] = {
    "horodatage": [
        "horodatage", "datetime", "timestamp", "heure_deduite", "heure",
        "periode", "date", "mois",
    ],
    "id_compteur": [
        "id_compteur", "compteur", "meter_id", "id_meter", "code_compteur",
        "grandeur", "designation", "libelle", "point_mesure", "compteur_label",
    ],
    "valeur": ["valeur", "value", "releve", "index", "volume_m3", "energie_kwh"],
    "unite": ["unite", "unit", "unite_valeur"],
    "id_batiment": ["id_batiment", "id_site", "building_id", "batiment", "site"],
    "fluide": ["fluide", "fluid", "energie", "vecteur"],
    "mesure": ["mesure", "role", "niveau"],
}

# When a file has no explicit "unité" column, the unit can often be read off
# the name of the column used as "valeur" itself (a common convention in
# exports from metering software).
COLUMN_UNIT_HINTS: dict[str, str] = {
    "volume_m3": "m3",
    "energie_kwh": "kWh",
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s.strip().lower()).strip("_")


def detect_delimiter(sample: str) -> str:
    counts = {d: sample.count(d) for d in [";", ",", "\t"]}
    return max(counts, key=counts.get) if max(counts.values()) > 0 else ";"


def detect_column_mapping(columns: list[str]) -> dict[str, str]:
    """For each logical field, pick the column matching the highest-priority
    alias — ranked by position in HEADER_ALIASES, never by the column's
    position in the file (a file can list a less specific column, such as a
    date-only field, before a more specific one, such as a full timestamp)."""
    normed = {c: _norm(c) for c in columns}
    mapping: dict[str, str] = {}
    for logical, aliases in HEADER_ALIASES.items():
        best_col, best_rank = None, None
        for col, n in normed.items():
            if n in aliases:
                rank = aliases.index(n)
                if best_rank is None or rank < best_rank:
                    best_col, best_rank = col, rank
        if best_col:
            mapping[logical] = best_col
    return mapping


def _sanitize_code(stem: str) -> str:
    code = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-")
    return code or "fichier"


@dataclass
class ParsedSeries:
    """One meter's worth of rows extracted from the raw file."""

    meter_code: str
    building_code: str | None
    fluid_type: str | None
    role: str | None
    unit: str | None
    rows: pd.DataFrame = field(repr=False)  # columns: timestamp, value


@dataclass
class ParseResult:
    series: list[ParsedSeries]
    column_mapping: dict[str, str]
    delimiter: str
    warnings: list[str]


def _parse_timestamp(raw: str) -> pd.Timestamp | None:
    raw = str(raw).strip()
    if not raw or raw.lower() in ("nan", "none"):
        return None
    # YYYY-MM month period -> first of month
    if re.fullmatch(r"\d{4}-\d{2}", raw):
        return pd.Timestamp(raw + "-01")
    # ISO dates (YYYY-MM-DD, optionally with a time) are unambiguous and must
    # NOT be parsed with dayfirst=True: depending on the pandas version, that
    # flag can silently swap day and month even on an ISO string (e.g.
    # "2025-10-01" becoming 10 January instead of 1 October) whenever the day
    # is <= 12. dayfirst is only meaningful — and needed — for the
    # genuinely ambiguous DD/MM/YYYY style (e.g. "01/10/2025").
    if re.match(r"^\d{4}-\d{2}-\d{2}([ T]|$)", raw):
        try:
            return pd.to_datetime(raw, dayfirst=False)
        except (ValueError, TypeError):
            return None
    try:
        return pd.to_datetime(raw, dayfirst=True)
    except (ValueError, TypeError):
        return None




def parse_csv_bytes(
    content: bytes,
    filename: str,
    column_mapping: dict[str, str] | None = None,
    delimiter: str | None = None,
    decimal_separator: str = ",",
) -> ParseResult:
    warnings: list[str] = []
    text = content.decode("utf-8-sig", errors="replace")
    sample = "\n".join(text.splitlines()[:5])
    delim = delimiter or detect_delimiter(sample)

    df = pd.read_csv(io.StringIO(text), sep=delim, dtype=str, keep_default_na=False)
    df.columns = [c.strip() for c in df.columns]

    mapping = dict(column_mapping) if column_mapping else detect_column_mapping(list(df.columns))

    missing = [k for k in ("horodatage", "valeur") if k not in mapping]
    if missing:
        raise ValueError(
            f"Colonnes obligatoires introuvables dans {filename} : {', '.join(missing)}. "
            "Configure le mapping de colonnes pour ce fichier."
        )

    # Many real-world exports (manual readings, single-meter logger files)
    # carry no explicit meter identifier column at all: the whole file IS one
    # meter's series, named after the file itself. Rather than reject these,
    # synthesize a constant id_compteur column from the filename.
    used_synthetic_meter = "id_compteur" not in mapping
    if used_synthetic_meter:
        synthetic_code = _sanitize_code(Path(filename).stem)
        df["__synthetic_id_compteur__"] = synthetic_code
        mapping["id_compteur"] = "__synthetic_id_compteur__"
        warnings.append(
            f"Aucune colonne d'identifiant de compteur trouvée : toutes les lignes de {filename} "
            f"ont été regroupées sous le compteur « {synthetic_code} »."
        )

    dec = "," if decimal_separator == "," else "."

    def to_float(v: str) -> float | None:
        v = v.strip()
        if v == "":
            return None
        if dec == ",":
            v = v.replace(".", "").replace(",", ".") if v.count(",") == 1 and "." in v else v.replace(",", ".")
        try:
            return float(v)
        except ValueError:
            return None

    df["_ts"] = df[mapping["horodatage"]].apply(_parse_timestamp)
    df["_value"] = df[mapping["valeur"]].apply(to_float)
    bad_ts = df["_ts"].isna().sum()
    if bad_ts:
        warnings.append(f"{bad_ts} ligne(s) avec un horodatage illisible ont été ignorées.")
    df = df[df["_ts"].notna()]

    series: list[ParsedSeries] = []
    for meter_code, g in df.groupby(df[mapping["id_compteur"]].str.strip()):
        rows = g[["_ts", "_value"]].rename(columns={"_ts": "timestamp", "_value": "value"}).sort_values("timestamp")
        building_code = None
        if "id_batiment" in mapping:
            vals = g[mapping["id_batiment"]].dropna()
            building_code = vals.iloc[0].strip() if len(vals) else None
        if not building_code and not used_synthetic_meter and "-" in meter_code:
            # fall back to convention METER = BUILDING-SUFFIX (e.g. S04-PAC -> S04).
            # Skipped when the meter code was itself synthesized from the
            # filename: any dash in it is just part of the filename, not a
            # site-code convention, and splitting it would truncate the name.
            building_code = meter_code.rsplit("-", 1)[0]
        if not building_code:
            # No building column and no dash-prefixed convention to lean on
            # (e.g. a manual-readings file identifying meters by a free-text
            # label like "Index Gaz 1"): assume one file = one site, named
            # after the file, rather than inventing one phantom building per
            # meter label.
            building_code = _sanitize_code(Path(filename).stem)

        fluid_type = None
        if "fluide" in mapping:
            vals = g[mapping["fluide"]].dropna()
            fluid_type = vals.iloc[0].strip() if len(vals) else None

        role = None
        if "mesure" in mapping:
            vals = g[mapping["mesure"]].dropna()
            role = vals.iloc[0].strip() if len(vals) else None

        unit = None
        if "unite" in mapping:
            vals = g[mapping["unite"]].dropna()
            unit = vals.iloc[0].strip() if len(vals) else None
        if not unit:
            unit = COLUMN_UNIT_HINTS.get(_norm(mapping["valeur"]))

        classification = classify_meter(
            meter_code=meter_code,
            filename=filename,
            fluid_type=fluid_type,
            role=role,
            unit=unit,
            value_column=mapping["valeur"],
        )

        series.append(
            ParsedSeries(
                meter_code=meter_code,
                building_code=building_code,
                fluid_type=classification.fluid_type or fluid_type,
                role=classification.role or role,
                unit=classification.unit or unit,
                rows=rows.reset_index(drop=True),
            )
        )

    return ParseResult(series=series, column_mapping=mapping, delimiter=delim, warnings=warnings)
