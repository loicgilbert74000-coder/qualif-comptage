from __future__ import annotations

import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path

import pandas as pd
from sqlalchemy.orm import Session

from app.config import settings as app_settings
from app.models import (
    Building,
    Meter,
    ImportBatch,
    ImportKind,
    ImportStatus,
    Reading,
    ReadingQuality,
    Anomaly,
    AnomalyType,
    AnomalyResolution,
    ProcessingHistory,
    ProcessingAction,
    OrgSettings,
)
from app.services.csv_parser import parse_csv_bytes, ParseResult
from app.services.quality_engine import analyze_series, batch_quality_score, MeterQualityReport
from app.services.reconstruction_engine import reconstruct_series

QUALITY_OK_THRESHOLD = 90.0  # >= this -> "à valider", below -> "à corriger"


def get_org_settings(db: Session) -> OrgSettings:
    row = db.query(OrgSettings).get(1)
    if row is None:
        row = OrgSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _get_or_create_building(db: Session, code: str) -> Building:
    b = db.query(Building).filter(Building.code == code).one_or_none()
    if b is None:
        b = Building(code=code, name=code)
        db.add(b)
        db.flush()
    return b


def _get_or_create_meter(db: Session, building: Building, parsed) -> Meter:
    m = db.query(Meter).filter(Meter.code == parsed.meter_code).one_or_none()
    if m is None:
        m = Meter(
            building_id=building.id,
            code=parsed.meter_code,
            label=parsed.meter_code,
            fluid_type=parsed.fluid_type or "inconnu",
            unit=parsed.unit or "unité",
            role=parsed.role or "général",
            measurement_kind=parsed.measurement_kind,
        )
        db.add(m)
        db.flush()
    else:
        # Imports may provide better metadata than the first file seen for a
        # meter (for example an explicit fluid column after an ID-only file).
        m.fluid_type = parsed.fluid_type or m.fluid_type
        m.unit = parsed.unit or m.unit
        m.role = parsed.role or m.role
        if parsed.measurement_kind != "indéterminé":
            m.measurement_kind = parsed.measurement_kind
    return m


def ingest_files(
    db: Session,
    files: list[tuple[str, bytes]],
    *,
    display_name: str | None = None,
    column_mapping: dict | None = None,
    delimiter: str | None = None,
    decimal_separator: str = ",",
) -> ImportBatch:
    """Parse one or several CSV files and persist them as a single
    ImportBatch, auto-creating any Building/Meter encountered for the first
    time. Any meter type is accepted — the fluid/unit/role are whatever the
    source file says."""

    kind = ImportKind.DOSSIER if len(files) > 1 else ImportKind.FICHIER
    name = display_name or (files[0][0] if len(files) == 1 else f"Dossier ({len(files)} fichiers)")

    batch_dir = os.path.join(app_settings.storage_dir, str(uuid.uuid4()))
    os.makedirs(batch_dir, exist_ok=True)

    batch = ImportBatch(
        name=name,
        kind=kind,
        file_count=len(files),
        storage_path=batch_dir,
        column_mapping=column_mapping or {},
        delimiter=delimiter or ";",
        decimal_separator=decimal_separator,
        status=ImportStatus.EN_COURS,
    )
    db.add(batch)
    db.flush()

    all_warnings: list[str] = []
    mappings_by_file: dict[str, dict[str, str]] = {}
    buildings_seen: set[str] = set()
    meters_seen: set[str] = set()
    period_min, period_max = None, None

    for filename, content in files:
        with open(os.path.join(batch_dir, filename), "wb") as fh:
            fh.write(content)

        result: ParseResult = parse_csv_bytes(
            content, filename, column_mapping=column_mapping, delimiter=delimiter, decimal_separator=decimal_separator
        )
        mappings_by_file[filename] = result.column_mapping
        all_warnings.extend(result.warnings)

        for s in result.series:
            building = _get_or_create_building(db, s.building_code or s.meter_code)
            meter = _get_or_create_meter(db, building, s)
            buildings_seen.add(building.code)
            meters_seen.add(meter.code)

            for _, row in s.rows.iterrows():
                ts = row["timestamp"]
                if period_min is None or ts < period_min:
                    period_min = ts
                if period_max is None or ts > period_max:
                    period_max = ts
                db.add(
                    Reading(
                        meter_id=meter.id,
                        import_batch_id=batch.id,
                        timestamp=ts.to_pydatetime(),
                        value=row["value"],
                        raw_value=row["value"],
                        unit=meter.unit,
                        quality=ReadingQuality.VALIDE,
                    )
                )

    if column_mapping:
        batch.column_mapping = column_mapping
    elif len(mappings_by_file) == 1:
        batch.column_mapping = next(iter(mappings_by_file.values()))
    else:
        # A folder may mix daily, hourly and quarter-hourly exports with
        # different date/value headers; retain the detected mapping per file.
        batch.column_mapping = {"files": mappings_by_file}
    batch.building_count = len(buildings_seen)
    batch.meter_count = len(meters_seen)
    batch.period_start = period_min.date() if period_min is not None else None
    batch.period_end = period_max.date() if period_max is not None else None
    db.commit()
    db.refresh(batch)

    run_quality_analysis(db, batch)
    return batch


def _meter_rows_df(db: Session, meter_id, batch_id) -> pd.DataFrame:
    rows = (
        db.query(Reading)
        .filter(Reading.meter_id == meter_id, Reading.import_batch_id == batch_id)
        .order_by(Reading.timestamp)
        .all()
    )
    return pd.DataFrame({"timestamp": [r.timestamp for r in rows], "value": [r.raw_value for r in rows]})


def run_quality_analysis(db: Session, batch: ImportBatch) -> list[MeterQualityReport]:
    """(Re)computes anomalies and the quality score for every meter in the
    batch. Safe to call again later ("Réanalyser")."""
    cfg = get_org_settings(db)

    db.query(Anomaly).filter(Anomaly.import_batch_id == batch.id).delete()

    meter_ids = [
        row[0]
        for row in db.query(Reading.meter_id).filter(Reading.import_batch_id == batch.id).distinct().all()
    ]

    reports: list[MeterQualityReport] = []
    for meter_id in meter_ids:
        meter = db.query(Meter).get(meter_id)
        df = _meter_rows_df(db, meter_id, batch.id)
        report = analyze_series(
            meter.code,
            df,
            spike_deviation_pct=cfg.spike_deviation_pct,
            drop_deviation_pct=cfg.drop_deviation_pct,
            reference_window_periods=cfg.reference_window_periods,
            flatline_min_run=cfg.flatline_min_run,
            allow_negative_values=cfg.allow_negative_values,
            measurement_kind=meter.measurement_kind,
            service_start=meter.service_start,
            historical_min_points=cfg.historical_min_points,
            robust_mad_multiplier=cfg.robust_mad_multiplier,
            historical_extreme_ratio=cfg.historical_extreme_ratio,
            zero_active_min_history=cfg.zero_active_min_history,
            seasonal_activity_min_history=cfg.seasonal_activity_min_history,
            timestamp_tolerance_pct=cfg.timestamp_tolerance_pct,
        )
        reports.append(report)

        flag_by_ts = {pf.timestamp: pf.quality for pf in report.point_flags}
        existing = {
            r.timestamp: r
            for r in db.query(Reading).filter(Reading.meter_id == meter_id, Reading.import_batch_id == batch.id)
        }
        for ts, quality in flag_by_ts.items():
            r = existing.get(ts)
            if r is not None:
                r.quality = ReadingQuality(quality)

        for a in report.anomalies:
            db.add(
                Anomaly(
                    import_batch_id=batch.id,
                    meter_id=meter_id,
                    type=AnomalyType(a.kind),
                    subtype=a.subtype,
                    period_start=a.period_start,
                    period_end=a.period_end,
                    description=a.description,
                    deviation_pct=a.deviation_pct,
                )
            )

    batch.quality_score = batch_quality_score(reports)
    batch.status = ImportStatus.A_VALIDER if (batch.quality_score or 0) >= QUALITY_OK_THRESHOLD else ImportStatus.A_CORRIGER
    batch.analyzed_at = datetime.utcnow()
    db.add(
        ProcessingHistory(
            import_batch_id=batch.id,
            action=ProcessingAction.ANALYSE,
            reconstruction_method=None,
            stats={"quality_score": batch.quality_score},
        )
    )
    db.commit()
    db.refresh(batch)
    return reports


def validate_and_reconstruct(db: Session, batch: ImportBatch) -> dict:
    """Step 3 of the wizard: fill gaps and smooth inconsistencies by
    simulation, then mark the batch as validated.

    Each anomaly must first have been reviewed on the "Traiter et
    reconstruire" page: zones marked "validée" (kept as-is) are left
    untouched here, zones marked "corrigée" were already reconstructed when
    reviewed (reconstructing them again here is harmless/idempotent)."""
    pending = (
        db.query(Anomaly)
        .filter(Anomaly.import_batch_id == batch.id, Anomaly.resolution == AnomalyResolution.EN_ATTENTE)
        .count()
    )
    if pending:
        raise ValueError(
            f"{pending} zone(s) n'ont pas encore été validée(s) ou corrigée(s). "
            "Traitez chaque zone signalée avant d'enregistrer."
        )

    quality_before = batch.quality_score
    meter_ids = [
        row[0]
        for row in db.query(Reading.meter_id).filter(Reading.import_batch_id == batch.id).distinct().all()
    ]

    total_filled, total_smoothed = 0, 0
    for meter_id in meter_ids:
        readings = (
            db.query(Reading)
            .filter(Reading.meter_id == meter_id, Reading.import_batch_id == batch.id)
            .order_by(Reading.timestamp)
            .all()
        )
        if not readings:
            continue
        df = pd.DataFrame({"timestamp": [r.timestamp for r in readings], "value": [r.raw_value for r in readings]})
        from app.services.quality_engine import infer_granularity, _build_expected_index

        granularity = infer_granularity(pd.Series(df["timestamp"]))
        expected_index = _build_expected_index(df["timestamp"].min(), df["timestamp"].max(), granularity)
        expected_index = expected_index.union(pd.DatetimeIndex(df["timestamp"])).sort_values()
        series = df.set_index("timestamp")["value"]
        series = series[~series.index.duplicated(keep="last")]
        aligned = series.reindex(expected_index)

        bad_ts = {
            r.timestamp
            for r in readings
            if r.quality == ReadingQuality.INCOHERENCE and pd.Timestamp(r.timestamp) in expected_index
        }
        bad_ts = {pd.Timestamp(t) for t in bad_ts}

        # Zones the person explicitly validated "as-is" must stay untouched,
        # even though they're still flagged incoherente/manquante.
        validated_anomalies = (
            db.query(Anomaly)
            .filter(
                Anomaly.import_batch_id == batch.id,
                Anomaly.meter_id == meter_id,
                Anomaly.resolution == AnomalyResolution.VALIDEE,
            )
            .all()
        )
        skip_ts: set[pd.Timestamp] = set()
        for a in validated_anomalies:
            mask = (expected_index >= pd.Timestamp(a.period_start)) & (expected_index <= pd.Timestamp(a.period_end))
            skip_ts |= set(expected_index[mask])
        bad_ts -= skip_ts

        result = reconstruct_series(expected_index, aligned, bad_ts, granularity, skip_timestamps=skip_ts)
        total_filled += result.n_missing_filled
        total_smoothed += result.n_incoherence_smoothed

        by_ts = {pd.Timestamp(r.timestamp): r for r in readings}
        for ts in result.methods_used:
            r = by_ts.get(ts)
            new_val = float(result.values[ts]) if pd.notna(result.values[ts]) else None
            if r is not None:
                r.value = new_val
                r.quality = ReadingQuality.RECONSTRUITE
            else:
                db.add(
                    Reading(
                        meter_id=meter_id,
                        import_batch_id=batch.id,
                        timestamp=ts.to_pydatetime(),
                        value=new_val,
                        raw_value=None,
                        unit=db.query(Meter).get(meter_id).unit,
                        quality=ReadingQuality.RECONSTRUITE,
                    )
                )

    batch.status = ImportStatus.VALIDE
    db.commit()

    reports = run_quality_analysis(db, batch)  # recompute score on the treated series (missing/incoherence should now be 0)
    batch.status = ImportStatus.VALIDE  # keep validated even if re-analysis would otherwise flag it
    db.add(
        ProcessingHistory(
            import_batch_id=batch.id,
            action=ProcessingAction.VALIDE_ET_TRAITE,
            reconstruction_method="profil_type + interpolation",
            stats={
                "points_reconstructed": total_filled,
                "points_smoothed": total_smoothed,
                "quality_before": quality_before,
                "quality_after": batch.quality_score,
            },
        )
    )
    db.commit()
    db.refresh(batch)

    return {
        "status": batch.status.value,
        "points_reconstructed": total_filled,
        "points_smoothed": total_smoothed,
        "quality_before": quality_before,
        "quality_after": batch.quality_score,
    }


def resolve_anomaly(db: Session, batch: ImportBatch, anomaly: Anomaly, resolution: str) -> dict:
    """Step 2 of the wizard ("Traiter et reconstruire"): record the
    person's decision for one flagged zone.

    - "validee": the zone is kept exactly as imported (e.g. a legitimate
      meter replacement, or a production meter's negative convention) — no
      reading is touched, only the anomaly's own resolution is recorded.
    - "corrigee": the zone is reconstructed right away, using the same
      profil-type/interpolation simulation as the final step, but applied
      only to this anomaly's own period so zones not yet reviewed are left
      alone."""
    resolution_enum = AnomalyResolution(resolution)
    anomaly.resolution = resolution_enum
    stats: dict = {"anomaly_id": str(anomaly.id), "resolution": resolution}

    if resolution_enum == AnomalyResolution.CORRIGEE:
        meter_id = anomaly.meter_id
        meter = db.query(Meter).get(meter_id)
        readings = (
            db.query(Reading)
            .filter(Reading.meter_id == meter_id, Reading.import_batch_id == batch.id)
            .order_by(Reading.timestamp)
            .all()
        )
        if readings:
            from app.services.quality_engine import infer_granularity, _build_expected_index

            df = pd.DataFrame({"timestamp": [r.timestamp for r in readings], "value": [r.raw_value for r in readings]})
            granularity = infer_granularity(pd.Series(df["timestamp"]))
            expected_index = _build_expected_index(df["timestamp"].min(), df["timestamp"].max(), granularity)
            series = df.set_index("timestamp")["value"]
            series = series[~series.index.duplicated(keep="last")]
            aligned = series.reindex(expected_index)

            bad_ts = {
                pd.Timestamp(r.timestamp)
                for r in readings
                if r.quality == ReadingQuality.INCOHERENCE and pd.Timestamp(r.timestamp) in expected_index
            }

            result = reconstruct_series(expected_index, aligned, bad_ts, granularity)

            period_mask = (expected_index >= pd.Timestamp(anomaly.period_start)) & (
                expected_index <= pd.Timestamp(anomaly.period_end)
            )
            period_ts = set(expected_index[period_mask])
            by_ts = {pd.Timestamp(r.timestamp): r for r in readings}
            n_applied = 0
            for ts in period_ts:
                if ts not in result.methods_used:
                    continue
                r = by_ts.get(ts)
                new_val = float(result.values[ts]) if pd.notna(result.values[ts]) else None
                if r is not None:
                    r.value = new_val
                    r.quality = ReadingQuality.RECONSTRUITE
                else:
                    db.add(
                        Reading(
                            meter_id=meter_id,
                            import_batch_id=batch.id,
                            timestamp=ts.to_pydatetime(),
                            value=new_val,
                            raw_value=None,
                            unit=meter.unit,
                            quality=ReadingQuality.RECONSTRUITE,
                        )
                    )
                n_applied += 1
            stats["points_reconstructed"] = n_applied

    db.add(
        ProcessingHistory(
            import_batch_id=batch.id,
            action=ProcessingAction.REANALYSE,
            reconstruction_method="profil_type + interpolation (zone)" if resolution_enum == AnomalyResolution.CORRIGEE else None,
            stats=stats,
        )
    )
    db.commit()
    db.refresh(anomaly)
    return stats


def reject_batch(db: Session, batch: ImportBatch) -> ImportBatch:
    batch.status = ImportStatus.REFUSE
    db.add(ProcessingHistory(import_batch_id=batch.id, action=ProcessingAction.REFUSE, stats={}))
    db.commit()
    db.refresh(batch)
    return batch


def delete_batch(db: Session, batch: ImportBatch) -> None:
    """Remove an import entry entirely (used from the "trop de fichiers"
    clean-up in the import panel). Its readings, anomalies and history rows
    are removed with it (cascade="all, delete-orphan" on ImportBatch), but
    the meters/buildings it created are left alone since another import may
    still reference them. The raw file(s) kept on disk are deleted too."""
    storage_path = Path(batch.storage_path) if batch.storage_path else None
    db.delete(batch)
    db.commit()
    if storage_path and storage_path.exists():
        try:
            if storage_path.is_dir():
                shutil.rmtree(storage_path, ignore_errors=True)
            else:
                storage_path.unlink()
        except OSError:
            pass
