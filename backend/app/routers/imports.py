from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ImportBatch, Meter, Building, Reading, Anomaly, ReadingQuality
from app.schemas.import_batch import (
    ImportBatchSummary,
    ImportBatchDetail,
    MeterQualitySummary,
    AnomalyOut,
    SeriesPoint,
    SynthesisOut,
    ValidateResponse,
)
from app.services import import_service

router = APIRouter(prefix="/api/imports", tags=["imports"])


def _get_batch_or_404(db: Session, batch_id: UUID) -> ImportBatch:
    batch = db.query(ImportBatch).get(batch_id)
    if batch is None:
        raise HTTPException(404, "Import introuvable")
    return batch


@router.post("", response_model=ImportBatchSummary)
async def create_import(
    files: list[UploadFile] = File(...),
    delimiter: str | None = None,
    decimal_separator: str = ",",
    db: Session = Depends(get_db),
):
    """Upload one CSV file, or several at once to be treated as a single
    'dossier' batch (matches the mock-up's two import cards)."""
    payload = [(f.filename, await f.read()) for f in files]
    try:
        batch = import_service.ingest_files(db, payload, decimal_separator=decimal_separator, delimiter=delimiter)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return ImportBatchSummary.model_validate(batch)


@router.get("", response_model=list[ImportBatchSummary])
def list_imports(db: Session = Depends(get_db)):
    batches = db.query(ImportBatch).order_by(ImportBatch.created_at.desc()).all()
    return [ImportBatchSummary.model_validate(b) for b in batches]


@router.get("/{batch_id}", response_model=ImportBatchDetail)
def get_import(batch_id: UUID, db: Session = Depends(get_db)):
    batch = _get_batch_or_404(db, batch_id)
    meter_ids = [r[0] for r in db.query(Reading.meter_id).filter(Reading.import_batch_id == batch_id).distinct()]
    meters = db.query(Meter).filter(Meter.id.in_(meter_ids)).all() if meter_ids else []
    building = db.query(Building).get(meters[0].building_id) if meters else None

    summaries = []
    for m in meters:
        readings = db.query(Reading).filter(Reading.meter_id == m.id, Reading.import_batch_id == batch_id).all()
        total = len(readings)
        valid = sum(1 for r in readings if r.quality == ReadingQuality.VALIDE)
        incoh = sum(1 for r in readings if r.quality == ReadingQuality.INCOHERENCE)
        missing = sum(1 for r in readings if r.quality == ReadingQuality.MANQUANTE)
        from app.services.quality_engine import infer_granularity
        import pandas as pd

        gran = infer_granularity(pd.Series([r.timestamp for r in readings])) if readings else "journaliere"
        summaries.append(
            MeterQualitySummary(
                meter_id=m.id,
                meter_code=m.code,
                fluid_type=m.fluid_type,
                unit=m.unit,
                granularity=gran,
                total_expected=total,
                valid_count=valid,
                incoherence_count=incoh,
                missing_count=missing,
                quality_pct=round(valid / total * 100, 1) if total else 0.0,
            )
        )

    return ImportBatchDetail(
        summary=ImportBatchSummary.model_validate(batch),
        building_name=building.name if building else None,
        meters=summaries,
    )


@router.get("/{batch_id}/meters/{meter_id}/series", response_model=list[SeriesPoint])
def get_series(batch_id: UUID, meter_id: UUID, db: Session = Depends(get_db)):
    _get_batch_or_404(db, batch_id)
    rows = (
        db.query(Reading)
        .filter(Reading.import_batch_id == batch_id, Reading.meter_id == meter_id)
        .order_by(Reading.timestamp)
        .all()
    )
    return [SeriesPoint(timestamp=r.timestamp, value=r.value, quality=r.quality.value) for r in rows]


@router.get("/{batch_id}/anomalies", response_model=list[AnomalyOut])
def get_anomalies(batch_id: UUID, db: Session = Depends(get_db)):
    _get_batch_or_404(db, batch_id)
    rows = (
        db.query(Anomaly, Meter.code)
        .join(Meter, Meter.id == Anomaly.meter_id)
        .filter(Anomaly.import_batch_id == batch_id)
        .order_by(Anomaly.period_start)
        .all()
    )
    return [
        AnomalyOut(
            id=a.id,
            meter_id=a.meter_id,
            meter_code=code,
            type=a.type.value,
            subtype=a.subtype,
            period_start=a.period_start,
            period_end=a.period_end,
            description=a.description,
            deviation_pct=a.deviation_pct,
        )
        for a, code in rows
    ]


@router.get("/{batch_id}/synthesis", response_model=SynthesisOut)
def get_synthesis(batch_id: UUID, db: Session = Depends(get_db)):
    detail = get_import(batch_id, db)
    total = sum(m.total_expected for m in detail.meters)
    valid = sum(m.valid_count for m in detail.meters)
    incoh = sum(m.incoherence_count for m in detail.meters)
    missing = sum(m.missing_count for m in detail.meters)
    return SynthesisOut(
        quality_score=detail.summary.quality_score or 0.0,
        valid_points=valid,
        incoherence_points=incoh,
        missing_points=missing,
        total_points=total,
        by_meter=detail.meters,
    )


@router.post("/{batch_id}/reanalyze", response_model=ImportBatchSummary)
def reanalyze(batch_id: UUID, db: Session = Depends(get_db)):
    batch = _get_batch_or_404(db, batch_id)
    import_service.run_quality_analysis(db, batch)
    return ImportBatchSummary.model_validate(batch)


@router.post("/{batch_id}/reject", response_model=ImportBatchSummary)
def reject(batch_id: UUID, db: Session = Depends(get_db)):
    batch = _get_batch_or_404(db, batch_id)
    batch = import_service.reject_batch(db, batch)
    return ImportBatchSummary.model_validate(batch)


@router.post("/{batch_id}/validate", response_model=ValidateResponse)
def validate(batch_id: UUID, db: Session = Depends(get_db)):
    batch = _get_batch_or_404(db, batch_id)
    result = import_service.validate_and_reconstruct(db, batch)
    return ValidateResponse(**result)
