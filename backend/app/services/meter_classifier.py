"""Domain-aware classification for meter exports.

CSV headers often identify only a value and a unit (for example
``energie_kwh``). This module combines explicit fluid/role fields with meter
codes and the source filename to recover the energy carrier and its use.
Unknown values stay explicit instead of being guessed from a unit alone.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


def _norm(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


@dataclass(frozen=True)
class MeterClassification:
    fluid_type: str | None
    role: str | None
    unit: str | None


def classify_meter(
    *,
    meter_code: str,
    filename: str = "",
    fluid_type: str | None = None,
    role: str | None = None,
    unit: str | None = None,
    value_column: str | None = None,
) -> MeterClassification:
    """Return canonical fluid, usage role and unit for a parsed meter.

    Explicit columns take precedence; stable meter-code suffixes and source
    names fill missing metadata. The rules cover both the Rive-Claire files
    and the common French labels used for other meter types.
    """
    code = _norm(meter_code)
    source = _norm(filename)
    raw_fluid = _norm(fluid_type)
    raw_role = _norm(role)
    raw_unit = (unit or "").strip() or None
    value_name = _norm(value_column)
    clues = " ".join((raw_fluid, raw_role, code, source, value_name))
    tokens = set(clues.split())
    code_tokens = set(code.split())

    # More specific subtypes must be resolved before the generic water/heat.
    is_ecs = bool(tokens & {"ecs", "sanitaire"}) or "eau chaude" in clues
    has_submeter_marker = bool(tokens & {"sous", "souscompteur", "sc", "ss", "submeter"})
    is_hot_submeter = any(term in clues for term in ("sous compteur chaud", "sous compteur chauffage", "sous compteur ecs")) or (
        has_submeter_marker and bool(tokens & {"chaud", "chaude", "chauffage"})
    )
    is_cold_submeter = "sous compteur froid" in clues or (has_submeter_marker and "froid" in tokens)
    is_fad = "fad" in code_tokens or "fad" in raw_fluid.split()
    is_cad = "cad" in code_tokens or "cad" in raw_fluid.split()
    is_pv = "pv" in code_tokens or "photovoltaique" in clues or "photovoltaïque" in clues
    is_injection = "inj" in code_tokens or "injection" in clues
    is_pac = "pac" in code_tokens or "pompe a chaleur" in clues
    is_delivery = bool(tokens & {"livraison", "livraisons", "livre", "livree", "livrees"})

    if is_ecs:
        canonical_fluid = "ECS"
    elif is_hot_submeter:
        canonical_fluid = "chaleur"
    elif is_cold_submeter or is_fad:
        canonical_fluid = "froid"
    elif is_cad or "chaleur" in raw_fluid or "heat" in tokens or is_pac:
        canonical_fluid = "chaleur"
    elif any(t in tokens for t in ("granule", "granules", "pellet", "pellets")):
        canonical_fluid = "granulés"
    elif any(t in tokens for t in ("bois", "wood", "buches", "bucher")):
        canonical_fluid = "bois"
    elif any(t in tokens for t in ("fuel", "fioul", "mazout", "gasoil")):
        canonical_fluid = "fuel"
    elif "gaz" in tokens or "gas" in tokens or "gz" in code_tokens:
        canonical_fluid = "gaz"
    elif "eau" in raw_fluid or "water" in tokens or "eau" in code_tokens:
        canonical_fluid = "eau froide"
    elif any(t in tokens for t in ("electricite", "electrique", "electric", "elec", "pv")):
        canonical_fluid = "électricité"
    elif "energie kwh" in value_name and ("elec" in source or "courbes elec" in source):
        canonical_fluid = "électricité"
    elif "energie kwh" in value_name and "pv" in source:
        canonical_fluid = "électricité"
    elif raw_fluid:
        # Preserve an unrecognised source label rather than throwing it away.
        canonical_fluid = (fluid_type or "").strip()
    else:
        canonical_fluid = None

    if is_ecs and (is_hot_submeter or has_submeter_marker or "sous compteur ecs" in clues):
        canonical_role = "sous-compteur ECS"
    elif is_hot_submeter:
        canonical_role = "sous-compteur chaud"
    elif is_cold_submeter:
        canonical_role = "sous-compteur froid"
    elif is_injection:
        canonical_role = "injection"
    elif is_pv or is_pac or "production" in raw_role or "producteur" in raw_role:
        canonical_role = "production"
    elif is_delivery:
        canonical_role = "livraison"
    elif is_cad:
        canonical_role = "CAD - consommation"
    elif is_fad:
        canonical_role = "FAD - consommation"
    elif raw_role:
        canonical_role = (role or "").strip()
    elif canonical_fluid:
        canonical_role = "consommation"
    else:
        canonical_role = None

    inferred_unit = raw_unit
    if not inferred_unit:
        if value_name in {"energie kwh", "energie", "kwh"}:
            inferred_unit = "kWh"
        elif value_name in {"volume m3", "volume m 3"}:
            inferred_unit = "m³"

    return MeterClassification(canonical_fluid, canonical_role, inferred_unit)
