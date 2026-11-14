"""Lookup of real building/site names from the "Sites" reference file (the
OSTRAL "EIAK-RC-OSTRAL-Sites" catalogue: id_site -> nom_site), so that when
a counting-data import's building or meter code matches a known site id
("S04", or a meter code built on top of one such as "S04-PAC"), the
building and its meters get named after the real site instead of the raw
code.

The reference data is bundled as a small static CSV
(app/reference_data/ostral_sites.csv — not named "app/data" since that
name is reserved in .gitignore for the app's runtime SQLite storage
directory) rather than re-ingested as an import — the user explicitly
asked to drop that file as something to import on its own ("laisse
tomber"), but still wants its id_site -> nom_site mapping used to name
things correctly.
"""

from __future__ import annotations

import csv
import sys
from functools import lru_cache
from pathlib import Path


def _reference_data_dir() -> Path:
    # PyInstaller's --onefile build extracts bundled data under
    # sys._MEIPASS; desktop_main.py's own resource_path() follows the same
    # pattern for frontend_dist.
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass) / "app" / "reference_data"
    return Path(__file__).resolve().parent.parent / "reference_data"


@lru_cache(maxsize=1)
def _site_names() -> dict[str, str]:
    path = _reference_data_dir() / "ostral_sites.csv"
    mapping: dict[str, str] = {}
    if not path.exists():
        return mapping
    with path.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=";"):
            site_id = (row.get("id_site") or "").strip()
            name = (row.get("nom_site") or "").strip()
            if site_id and name:
                mapping[site_id.upper()] = name
    return mapping


def lookup_site_name(code: str | None) -> str | None:
    """Resolve a building or meter code to its real site name, if it
    matches a known id_site either exactly or as a "<id_site>-..." prefix
    (meter codes such as "S04-PAC" or "S30-FERM" reference their site this
    way in the counting-data files)."""
    if not code:
        return None
    sites = _site_names()
    if not sites:
        return None
    code_upper = code.strip().upper()
    if code_upper in sites:
        return sites[code_upper]
    prefix = code_upper.split("-", 1)[0]
    return sites.get(prefix)
