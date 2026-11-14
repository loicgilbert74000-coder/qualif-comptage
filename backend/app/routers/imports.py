import csv
import io
import json
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ImportBatch, ImportStatus, Meter, Building, Reading, Anomaly, ReadingQuality, MeterValidation
from app.schemas.import_batch import (
    ImportBatchSummary,
    ImportBatchDetail,
    MeterQualitySummary,
    AnomalyOut,
    ResolveAnomalyIn,
    SeriesPoint,
    SynthesisOut,
    ValidateResponse,
    ValidateMeterResponse,
    CorrectionOption,
    CorrectionPreviewPoint,
)
from app.services import import_service
from app.services.diagnosis_engine import diagnose

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

    saved_meter_ids = {
        row[0] for row in db.query(MeterValidation.meter_id).filter(MeterValidation.import_batch_id == batch_id)
    }

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
                role=m.role,
                measurement_kind=m.measurement_kind,
                unit=m.unit,
                granularity=gran,
                total_expected=total,
                valid_count=valid,
                incoherence_count=incoh,
                missing_count=missing,
                quality_pct=round(valid / total * 100, 1) if total else 0.0,
                saved=m.id in saved_meter_ids,
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


def _anomaly_out(a: Anomaly, meter: Meter) -> AnomalyOut:
    d = diagnose(
        subtype=a.subtype,
        anomaly_type=a.type.value,
        measurement_kind=meter.measurement_kind,
        fluid_type=meter.fluid_type,
        role=meter.role,
        deviation_pct=a.deviation_pct,
    )
    return AnomalyOut(
        id=a.id,
        meter_id=a.meter_id,
        meter_code=meter.code,
        type=a.type.value,
        subtype=a.subtype,
        period_start=a.period_start,
        period_end=a.period_end,
        description=a.description,
        deviation_pct=a.deviation_pct,
        resolution=a.resolution.value,
        diagnosis=d.diagnosis,
        suggestion=d.suggestion,
        recommended_action=d.recommended_action,
    )


@router.get("/{batch_id}/anomalies", response_model=list[AnomalyOut])
def get_anomalies(batch_id: UUID, db: Session = Depends(get_db)):
    _get_batch_or_404(db, batch_id)
    rows = (
        db.query(Anomaly, Meter)
        .join(Meter, Meter.id == Anomaly.meter_id)
        .filter(Anomaly.import_batch_id == batch_id)
        .order_by(Anomaly.period_start)
        .all()
    )
    return [_anomaly_out(a, meter) for a, meter in rows]


@router.post("/{batch_id}/anomalies/{anomaly_id}/resolve", response_model=AnomalyOut)
def resolve_anomaly(batch_id: UUID, anomaly_id: UUID, payload: ResolveAnomalyIn, db: Session = Depends(get_db)):
    batch = _get_batch_or_404(db, batch_id)
    anomaly = (
        db.query(Anomaly)
        .filter(Anomaly.id == anomaly_id, Anomaly.import_batch_id == batch_id)
        .one_or_none()
    )
    if anomaly is None:
        raise HTTPException(404, "Anomalie introuvable")
    if payload.resolution not in ("validee", "corrigee"):
        raise HTTPException(400, "Résolution invalide : 'validee' ou 'corrigee' attendu.")
    try:
        import_service.resolve_anomaly(db, batch, anomaly, payload.resolution, method=payload.method)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    meter = db.query(Meter).get(anomaly.meter_id)
    return _anomaly_out(anomaly, meter)


@router.get("/{batch_id}/anomalies/{anomaly_id}/correction-options", response_model=list[CorrectionOption])
def get_correction_options(batch_id: UUID, anomaly_id: UUID, db: Session = Depends(get_db)):
    """The reconstruction techniques worth proposing for this one anomaly,
    tailored to its meter's fluid/measurement type — several different
    correctifs instead of a single one-size-fits-all suggestion."""
    _get_batch_or_404(db, batch_id)
    anomaly = (
        db.query(Anomaly)
        .filter(Anomaly.id == anomaly_id, Anomaly.import_batch_id == batch_id)
        .one_or_none()
    )
    if anomaly is None:
        raise HTTPException(404, "Anomalie introuvable")
    return import_service.correction_options_for_anomaly(db, anomaly)


@router.get("/{batch_id}/anomalies/{anomaly_id}/correction-preview", response_model=list[CorrectionPreviewPoint])
def get_correction_preview(batch_id: UUID, anomaly_id: UUID, method: str, db: Session = Depends(get_db)):
    """What applying `method` to this anomaly's period would produce,
    without writing anything — an aperçu before the person commits to one
    of the proposed correctifs."""
    batch = _get_batch_or_404(db, batch_id)
    anomaly = (
        db.query(Anomaly)
        .filter(Anomaly.id == anomaly_id, Anomaly.import_batch_id == batch_id)
        .one_or_none()
    )
    if anomaly is None:
        raise HTTPException(404, "Anomalie introuvable")
    return import_service.preview_correction(db, batch, anomaly, method)


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
    # A refused file, or a duplicate that was never actually ingested, has
    # no readings of its own to (re)analyse — recomputing against an empty
    # series would wipe the "refusé"/"déjà traité" status and the cleared
    # quality index with a misleading 0%.
    if batch.status not in (ImportStatus.REFUSE, ImportStatus.DEJA_TRAITE):
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
    try:
        result = import_service.validate_and_reconstruct(db, batch)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return ValidateResponse(**result)


@router.post("/{batch_id}/meters/{meter_id}/validate", response_model=ValidateMeterResponse)
def validate_meter(batch_id: UUID, meter_id: UUID, db: Session = Depends(get_db)):
    """Save one meter's curve on its own — lets a multi-meter dossier be
    finalized meter by meter instead of forcing every meter to be treated
    before any of them can be saved."""
    batch = _get_batch_or_404(db, batch_id)
    try:
        result = import_service.validate_meter(db, batch, meter_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return ValidateMeterResponse(**result)


@router.get("/{batch_id}/export")
def export_batch(batch_id: UUID, format: str = "csv", db: Session = Depends(get_db)):
    """Step 3 of the wizard ("Valider et exporter"): downloads the fully
    treated batch as CSV or JSON. Only offered once every meter has been
    saved (status VALIDE) — before that there's no final, reconciled data
    to hand out yet."""
    batch = _get_batch_or_404(db, batch_id)
    if batch.status != ImportStatus.VALIDE:
        raise HTTPException(
            400,
            "Ce dossier n'est pas encore entièrement traité — enregistrez toutes les courbes avant d'exporter.",
        )
    if format not in ("csv", "json"):
        raise HTTPException(400, "Format d'export invalide : 'csv' ou 'json' attendu.")

    rows = import_service.export_rows(db, batch)
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", batch.name).strip("_") or "export"

    if format == "json":
        content = json.dumps(rows, ensure_ascii=False, indent=2)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.json"'},
        )

    fieldnames = list(rows[0].keys()) if rows else [
        "batiment",
        "code_batiment",
        "compteur",
        "code_compteur",
        "type_fluide",
        "role",
        "unite",
        "horodatage",
        "valeur",
        "valeur_brute",
        "qualite",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, delimiter=";")
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
    )


@router.delete("/{batch_id}", status_code=204)
def delete_import(batch_id: UUID, db: Session = Depends(get_db)):
    batch = _get_batch_or_404(db, batch_id)
    import_service.delete_batch(db, batch)
    return None
