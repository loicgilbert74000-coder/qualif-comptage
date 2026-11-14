from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class HistoryEntryOut(BaseModel):
    id: UUID
    import_batch_id: UUID
    import_batch_name: str
    action: str
    performed_at: datetime
    reconstruction_method: str | None
    stats: dict

    class Config:
        from_attributes = True


class OrgSettingsOut(BaseModel):
    spike_deviation_pct: float
    drop_deviation_pct: float
    reference_window_periods: int
    flatline_min_run: int
    allow_negative_values: bool
    historical_min_points: int
    robust_mad_multiplier: float
    historical_extreme_ratio: float
    zero_active_min_history: int
    seasonal_activity_min_history: int
    timestamp_tolerance_pct: float

    class Config:
        from_attributes = True


class OrgSettingsUpdate(BaseModel):
    spike_deviation_pct: float | None = Field(default=None, gt=0, le=500)
    drop_deviation_pct: float | None = Field(default=None, gt=0, le=100)
    reference_window_periods: int | None = Field(default=None, ge=3, le=5000)
    flatline_min_run: int | None = Field(default=None, ge=2, le=10000)
    allow_negative_values: bool | None = None
    historical_min_points: int | None = Field(default=None, ge=3, le=10000)
    robust_mad_multiplier: float | None = Field(default=None, gt=0, le=20)
    historical_extreme_ratio: float | None = Field(default=None, gt=1, le=100)
    zero_active_min_history: int | None = Field(default=None, ge=2, le=10000)
    seasonal_activity_min_history: int | None = Field(default=None, ge=2, le=10000)
    timestamp_tolerance_pct: float | None = Field(default=None, gt=0, le=50)
