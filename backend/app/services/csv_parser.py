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

import pandas as pd

# header variants we recognise out of the box, lower-cased & accent-stripped
HEADER_ALIASES: dict[str, list[str]] = {
    "horodatage": ["horodatage", "date", "mois", "heure_deduite", "datetime", "timestamp", "periode"],
    "id_compteur": ["id_compteur", "compteur", "meter_id", "id_meter", "code_compteur"],
    "valeur": ["valeur", "value", "releve", "index", "volume_m3", "energie_kwh"],
    "unite": ["unite", "unit", "unite_valeur"],
    "id_batiment": ["id_batiment", "id_site", "building_id", "batiment", "site"],
    "fluide": ["fluide", "fluid", "energie", "vecteur"],
    "mesure": ["mesure", "role", "niveau"],
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s.strip().lower()).strip("_")


def detect_delimiter(sample: str) -> str:
    counts = {d: sample.count(d) for d in [";", ",", "\t"]}
    return max(counts, key=counts.get) if max(counts.values()) > 0 else ";"


def detect_column_mapping(columns: list[str]) -> dict[str, str]:
    normed = {c: _norm(c) for c in columns}
    mapping: dict[str, str] = {}
    for logical, aliases in HEADER_ALIASES.items():
        for col, n in normed.items():
            if n in aliases:
                mapping[logical] = col
                break
    return mapping


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
    try:
        return pd.to_datetime(raw, dayfirst=True)
    except (ValueError, TypeError):
        return None


def infer_meter_code(row: pd.Series, mapping: dict[str, str]) -> str:
    if "id_compteur" in mapping:
        return str(row[mapping["id_compteur"]]).strip()
    raise ValueError("id_compteur introuvable : impossible d'identifier le compteur de cette ligne")


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

    mapping = column_mapping or detect_column_mapping(list(df.columns))
    missing = [k for k in ("horodatage", "id_compteur", "valeur") if k not in mapping]
    if missing:
        raise ValueError(
            f"Colonnes obligatoires introuvables dans {filename} : {', '.join(missing)}. "
            "Configure le mapping de colonnes pour ce fichier."
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
        if not building_code:
            # fall back to convention METER = BUILDING-SUFFIX (e.g. S04-PAC -> S04)
            building_code = meter_code.rsplit("-", 1)[0] if "-" in meter_code else meter_code

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

        series.append(
            ParsedSeries(
                meter_code=meter_code,
                building_code=building_code,
                fluid_type=fluid_type,
                role=role,
                unit=unit,
                rows=rows.reset_index(drop=True),
            )
        )

    return ParseResult(series=series, column_mapping=mapping, delimiter=delim, warnings=warnings)
