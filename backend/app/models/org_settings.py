from sqlalchemy import Integer, Float, Boolean

from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OrgSettings(Base):
    """Single-row table holding the organisation-wide quality-engine
    thresholds, editable from the 'Paramètres' page."""

    __tablename__ = "org_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
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
