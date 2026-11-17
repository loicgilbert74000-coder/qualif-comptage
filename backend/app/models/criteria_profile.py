from sqlalchemy import Boolean, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CriteriaProfile(Base):
    """One named set of anomaly-detection thresholds for a given
    (type de compteur × usage) combination, instead of a single
    organisation-wide set. Replaces the old single-row OrgSettings as the
    thing the quality engine actually reads from — OrgSettings itself is
    kept only as the historical source used once, to seed these profiles
    without losing whatever an organisation had already tuned globally.

    usage_profile is "indéterminé" for a meter whose usage hasn't been
    confirmed yet (or for a measurement_kind, like "livraison", where the
    usage split doesn't apply) — every (kind, "indéterminé") row is the
    fallback used until/unless a more specific profile exists."""

    __tablename__ = "criteria_profiles"
    __table_args__ = (UniqueConstraint("measurement_kind", "usage_profile", name="uq_criteria_profile_kind_usage"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    measurement_kind: Mapped[str] = mapped_column(String(24))  # index | consommation | livraison | indéterminé
    usage_profile: Mapped[str] = mapped_column(String(24))     # logement | tertiaire | scolaire | production | indéterminé
    label: Mapped[str] = mapped_column(String(120))

    spike_deviation_pct: Mapped[float] = mapped_column(Float, default=60.0)
    drop_deviation_pct: Mapped[float] = mapped_column(Float, default=60.0)
    reference_window_periods: Mapped[int] = mapped_column(Integer, default=30)
    flatline_min_run: Mapped[int] = mapped_column(Integer, default=4)
    allow_negative_values: Mapped[bool] = mapped_column(Boolean, default=False)
    historical_min_points: Mapped[int] = mapped_column(Integer, default=6)
    robust_mad_multiplier: Mapped[float] = mapped_column(Float, default=6.0)
    historical_extreme_ratio: Mapped[float] = mapped_column(Float, default=3.0)
    zero_active_min_history: Mapped[int] = mapped_column(Integer, default=4)
    seasonal_activity_min_history: Mapped[int] = mapped_column(Integer, default=3)
    timestamp_tolerance_pct: Mapped[float] = mapped_column(Float, default=10.0)
