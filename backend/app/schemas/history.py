from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


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

    class Config:
        from_attributes = True


class OrgSettingsUpdate(BaseModel):
    spike_deviation_pct: float | None = None
    drop_deviation_pct: float | None = None
    reference_window_periods: int | None = None
    flatline_min_run: int | None = None
    allow_negative_values: bool | None = None
