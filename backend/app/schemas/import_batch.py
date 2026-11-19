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
    # How many of this dossier's meters are already individually qualified
    # (saved) — lets the export pages offer a dossier as soon as it has at
    # least one, instead of waiting for the whole dossier to be finished.
    qualified_meter_count: int = 0
    # Set only on a status == "deja_traite" entry: the id (and display name)
    # of the earlier import whose content this one is an exact duplicate
    # of — lets the import screen offer "ouvrir l'import original" instead
    # of a dead end, since this entry itself was never given any readings.
    duplicate_of_id: UUID | None = None
    duplicate_of_name: str | None = None

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
    usage_profile: str | None = None            # confirmed usage category (logement/tertiaire/scolaire/production)
    usage_profile_suggested: str | None = None  # engine's own guess, pending confirmation


class UsageProfileUpdate(BaseModel):
    profile: str | None = None  # None clears it back to "indéterminé"


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
    method: str | None = None  # correction technique, selected from ranked CorrectionOption results
    comment: str | None = None  # free text, persisted in ProcessingHistory.stats without a schema migration


class CorrectionOption(BaseModel):
    method: str
    label: str
    description: str
    rank: int
    original_confidence_pct: float
    confidence_pct: float
    confidence_gain_pct: float
    model_fit_pct: float | None = None
    eligible: bool
    confidence_basis: str


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
