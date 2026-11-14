from datetime import datetime, date
from uuid import UUID

from pydantic import BaseModel


class ImportBatchSummary(BaseModel):
    id: UUID
    name: str
    kind: str
    file_count: int
    building_count: int
    meter_count: int
    period_start: date | None
    period_end: date | None
    quality_score: float | None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class MeterQualitySummary(BaseModel):
    meter_id: UUID
    meter_code: str
    fluid_type: str
    role: str
    measurement_kind: str
    unit: str
    granularity: str
    total_expected: int
    valid_count: int
    incoherence_count: int
    missing_count: int
    quality_pct: float
    saved: bool = False  # this meter's curve has already been enregistrée (see MeterValidation)


class AnomalyOut(BaseModel):
    id: UUID
    meter_id: UUID
    meter_code: str
    type: str
    subtype: str
    period_start: datetime
    period_end: datetime
    description: str
    deviation_pct: float | None
    resolution: str
    diagnosis: str
    suggestion: str
    recommended_action: str

    class Config:
        from_attributes = True


class ResolveAnomalyIn(BaseModel):
    resolution: str  # "validee" | "corrigee"
    method: str | None = None  # which correction technique to use when resolution == "corrigee"; see CorrectionOption


class CorrectionOption(BaseModel):
    method: str
    label: str
    description: str


class CorrectionPreviewPoint(BaseModel):
    timestamp: datetime
    current_value: float | None
    proposed_value: float | None


class SeriesPoint(BaseModel):
    timestamp: datetime
    value: float | None
    quality: str


class ImportBatchDetail(BaseModel):
    summary: ImportBatchSummary
    building_name: str | None
    meters: list[MeterQualitySummary]


class SynthesisOut(BaseModel):
    quality_score: float
    valid_points: int
    incoherence_points: int
    missing_points: int
    total_points: int
    by_meter: list[MeterQualitySummary]


class ValidateResponse(BaseModel):
    status: str
    points_reconstructed: int
    points_smoothed: int
    quality_before: float | None
    quality_after: float


class ValidateMeterResponse(BaseModel):
    status: str
    meter_id: UUID
    points_reconstructed: int
    points_smoothed: int
    quality_before: float | None
    quality_after: float
    batch_complete: bool  # true once every meter of this batch has now been saved
