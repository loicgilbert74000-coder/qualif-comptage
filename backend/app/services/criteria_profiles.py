"""Criteria profiles: one named set of anomaly-detection thresholds per
(type de compteur × usage) combination — replacing the single
organisation-wide set of thresholds that used to apply to every meter
regardless of whether it served a dwelling, an office building, a school,
or a PV installation.

Only the combinations that actually make sense are seeded: "production"
only applies to courbe-de-charge meters (an index or a delivery meter has
no such thing), and a delivery meter's own detection (duplicates,
chronology, unit mix-ups — see ParametresPage on the frontend) doesn't
depend on the building's usage at all, so it only ever gets the
"indéterminé" fallback.

Seeded once, from whatever the organisation's old single OrgSettings row
already held — so a site that had already tuned its global thresholds
doesn't lose that tuning, it's just specialised from there rather than
overwritten with fresh guesses.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import CriteriaProfile, OrgSettings

# Mirrors OrgSettings' own column defaults. SQLAlchemy's mapped_column(...,
# default=X) is only applied when a row is actually inserted — a bare
# OrgSettings() built in memory without going through a flush has every one
# of these as None — so a literal copy is used here instead, for the one
# case where org_settings has no row yet (a brand-new database, which is
# the common case for a fresh desktop install: nothing ever created that
# row before this seeding step runs).
_HARDCODED_BASE: dict = {
    "spike_deviation_pct": 60.0,
    "drop_deviation_pct": 60.0,
    "reference_window_periods": 30,
    "flatline_min_run": 4,
    "allow_negative_values": False,
    "historical_min_points": 6,
    "robust_mad_multiplier": 6.0,
    "historical_extreme_ratio": 3.0,
    "zero_active_min_history": 4,
    "seasonal_activity_min_history": 3,
    "timestamp_tolerance_pct": 10.0,
}

FIELDS = [
    "spike_deviation_pct", "drop_deviation_pct", "reference_window_periods",
    "flatline_min_run", "allow_negative_values", "historical_min_points",
    "robust_mad_multiplier", "historical_extreme_ratio",
    "zero_active_min_history", "seasonal_activity_min_history",
    "timestamp_tolerance_pct",
]

KIND_LABELS: dict[str, str] = {
    "indéterminé": "Tout type de compteur",
    "index": "Compteur à index cumulé",
    "consommation": "Compteur de courbe de charge",
    "livraison": "Compteur par livraison",
}

USAGE_LABELS: dict[str, str] = {
    "indéterminé": "Profil par défaut",
    "logement": "Logement",
    "tertiaire": "Tertiaire / administratif",
    "scolaire": "Scolaire",
    "production": "Production (PV, cogénération…)",
}

# Every (measurement_kind, usage_profile) combination to seed, and the
# overrides it applies on top of the organisation's base thresholds.
# An empty dict means "use the base values as-is".
PROFILE_OVERRIDES: dict[tuple[str, str], dict] = {
    ("indéterminé", "indéterminé"): {},
    ("index", "indéterminé"): {},
    ("index", "logement"): {
        # A home's index rarely moves for days at a time (away, low usage) —
        # that's normal, not a stuck meter.
        "flatline_min_run": 6,
    },
    ("index", "tertiaire"): {
        # An occupied office/admin building should tick most working days —
        # a shorter unchanged run is already worth a look.
        "flatline_min_run": 3,
    },
    ("index", "scolaire"): {
        # Same logic as tertiaire during term time, but needs a longer
        # comparable history before trusting a seasonal slot — school
        # closures (summer, Christmas...) are long and entirely legitimate.
        "flatline_min_run": 3,
        "historical_min_points": 8,
        "seasonal_activity_min_history": 4,
    },
    ("consommation", "indéterminé"): {},
    ("consommation", "logement"): {
        # A household's load curve has real, legitimate peaks (cooking,
        # showers) — a lower spike sensitivity avoids flagging normal life.
        "spike_deviation_pct": 70,
        "flatline_min_run": 6,
    },
    ("consommation", "tertiaire"): {
        # Office buildings have a strong, structural day/night and
        # weekday/weekend rhythm — a shorter reference window tracks that
        # rhythm instead of mistaking it for an anomaly, and a short flat
        # run during opening hours is worth flagging (closed for the day?).
        "spike_deviation_pct": 80,
        "drop_deviation_pct": 70,
        "reference_window_periods": 20,
        "flatline_min_run": 3,
    },
    ("consommation", "scolaire"): {
        # Same daily/weekly rhythm as tertiaire, but with longer legitimate
        # closures (school holidays) to tolerate before judging a slot.
        "spike_deviation_pct": 80,
        "drop_deviation_pct": 70,
        "reference_window_periods": 20,
        "flatline_min_run": 3,
        "historical_min_points": 8,
    },
    ("consommation", "production"): {
        # PV/cogeneration: legitimate sign convention can be negative
        # (injection), night-time near-zero is the norm (not a flatline to
        # flag), and clear/cloudy-day swings are naturally large.
        "allow_negative_values": True,
        "spike_deviation_pct": 90,
        "drop_deviation_pct": 70,
        "reference_window_periods": 15,
        "flatline_min_run": 6,
        "robust_mad_multiplier": 8,
        "historical_extreme_ratio": 4,
    },
    ("livraison", "indéterminé"): {},
}


def _label_for(kind: str, usage: str) -> str:
    return f"{KIND_LABELS.get(kind, kind)} — {USAGE_LABELS.get(usage, usage)}"


def seed_default_profiles(db: Session) -> None:
    """Idempotent: a no-op once the table has been seeded. Safe to call on
    every startup, same as the rest of this app's lightweight migrations."""
    if db.query(CriteriaProfile).count() > 0:
        return
    base_row = db.query(OrgSettings).get(1)
    base = {f: getattr(base_row, f) for f in FIELDS} if base_row is not None else dict(_HARDCODED_BASE)
    for (kind, usage), overrides in PROFILE_OVERRIDES.items():
        values = {**base, **overrides}
        db.add(CriteriaProfile(measurement_kind=kind, usage_profile=usage, label=_label_for(kind, usage), **values))
    db.commit()


def get_criteria_profile(db: Session, measurement_kind: str | None, usage_profile: str | None) -> CriteriaProfile:
    """Resolves the most specific profile available for a meter, falling
    back to (kind, indéterminé) then to the universal default — so a meter
    whose usage hasn't been confirmed yet, or whose kind/usage combination
    was never seeded, still gets a sensible set of thresholds."""
    kind = measurement_kind if measurement_kind in KIND_LABELS else "indéterminé"
    usage = usage_profile if usage_profile in USAGE_LABELS else "indéterminé"

    # Usage-specific overrides (logement/tertiaire/scolaire/production) are
    # only ever seeded under the "consommation" kind — most real-world
    # exports carry no explicit "type de mesure" column though, so a
    # load-curve meter's own kind very often stays "indéterminé". Without
    # this, a meter whose usage a human HAS confirmed (e.g. "production"
    # for a PV/injection meter) would silently fall back to the generic,
    # far more sensitive "indéterminé" thresholds just because its kind was
    # never explicitly classified — defeating the point of confirming a
    # usage at all.
    if kind == "indéterminé" and usage != "indéterminé":
        kind = "consommation"

    profile = db.query(CriteriaProfile).filter_by(measurement_kind=kind, usage_profile=usage).first()
    if profile is None and usage != "indéterminé":
        profile = db.query(CriteriaProfile).filter_by(measurement_kind=kind, usage_profile="indéterminé").first()
    if profile is None:
        profile = db.query(CriteriaProfile).filter_by(measurement_kind="indéterminé", usage_profile="indéterminé").first()
    if profile is None:
        # Table was empty (fresh database, startup seeding hasn't run yet in
        # this process) — seed it now rather than crash on a missing profile.
        seed_default_profiles(db)
        return get_criteria_profile(db, measurement_kind, usage_profile)
    return profile
