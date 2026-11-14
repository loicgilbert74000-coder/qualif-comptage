from __future__ import annotations

import hashlib
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
    MeterValidation,
)
from app.services.csv_parser import parse_csv_bytes, ParseResult
from app.services.quality_engine import analyze_series, batch_quality_score, MeterQualityReport
from app.services.reconstruction_engine import reconstruct_series
from app.services.site_reference import lookup_site_name

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
        # Use the real site name from the OSTRAL sites catalogue when this
        # building's code matches a known id_site, instead of defaulting
        # the display name to the raw code.
        name = lookup_site_name(code) or code
        b = Building(code=code, name=name)
        db.add(b)
        db.flush()
    elif b.name == b.code:
        # Backfill a name for a building that was created before this
        # lookup existed (or from a file where no name was resolvable
        # at the time) but now matches a known site.
        resolved = lookup_site_name(code)
        if resolved:
            b.name = resolved
    return b


def _get_or_create_meter(db: Session, building: Building, parsed) -> Meter:
    m = db.query(Meter).filter(Meter.code == parsed.meter_code).one_or_none()
    if m is None:
        site_name = lookup_site_name(parsed.meter_code)
        label = f"{site_name} ({parsed.meter_code})" if site_name else parsed.meter_code
        m = Meter(
            building_id=building.id,
            code=parsed.meter_code,
            label=label,
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


def _content_hash(files: list[tuple[str, bytes]]) -> str:
    """Fingerprint of a set of uploaded files, independent of upload order
    or filename — just their actual bytes — so the exact same file (or the
    exact same folder of files) re-uploaded later can be recognised as a
    duplicate instead of being silently re-ingested a second time."""
    per_file = sorted(hashlib.sha256(content).hexdigest() for _, content in files)
    return hashlib.sha256("|".join(per_file).encode("utf-8")).hexdigest()


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
    source file says.

    If the exact same file (or set of files) has already been uploaded
    before, the data is not re-ingested a second time: a new ImportBatch
    row is still created, so the attempt stays visible in the import list,
    but with ImportStatus.DEJA_TRAITE and no readings/anomalies of its
    own."""

    kind = ImportKind.DOSSIER if len(files) > 1 else ImportKind.FICHIER
    name = display_name or (files[0][0] if len(files) == 1 else f"Dossier ({len(files)} fichiers)")
    content_hash = _content_hash(files)

    batch_dir = os.path.join(app_settings.storage_dir, str(uuid.uuid4()))
    os.makedirs(batch_dir, exist_ok=True)
    for filename, content in files:
        with open(os.path.join(batch_dir, filename), "wb") as fh:
            fh.write(content)

    duplicate_of = (
        db.query(ImportBatch)
        .filter(ImportBatch.content_hash == content_hash)
        .order_by(ImportBatch.created_at)
        .first()
    )
    if duplicate_of is not None:
        batch = ImportBatch(
            name=name,
            kind=kind,
            file_count=len(files),
            storage_path=batch_dir,
            column_mapping=column_mapping or {},
            delimiter=delimiter or ";",
            decimal_separator=decimal_separator,
            status=ImportStatus.DEJA_TRAITE,
            content_hash=content_hash,
            building_count=duplicate_of.building_count,
            meter_count=duplicate_of.meter_count,
            period_start=duplicate_of.period_start,
            period_end=duplicate_of.period_end,
            quality_score=None,  # the index isn't meaningful for a file that was never (re-)analysed
        )
        db.add(batch)
        db.flush()
        db.add(
            ProcessingHistory(
                import_batch_id=batch.id,
                action=ProcessingAction.DEJA_TRAITE,
                stats={"duplicate_of": str(duplicate_of.id), "duplicate_of_name": duplicate_of.name},
            )
        )
        db.commit()
        db.refresh(batch)
        return batch

    batch = ImportBatch(
        name=name,
        kind=kind,
        file_count=len(files),
        storage_path=batch_dir,
        column_mapping=column_mapping or {},
        delimiter=delimiter or ";",
        decimal_separator=decimal_separator,
        status=ImportStatus.EN_COURS,
        content_hash=content_hash,
    )
    db.add(batch)
    db.flush()

    all_warnings: list[str] = []
    mappings_by_file: dict[str, dict[str, str]] = {}
    buildings_seen: set[str] = set()
    meters_seen: set[str] = set()
    period_min, period_max = None, None
    # Collected across every file/meter and written in one bulk insert at
    # the end instead of one `db.add(Reading(...))` per row: for a year of
    # quarter-hourly readings that's tens of thousands of individual ORM
    # objects (each with its own session bookkeeping) per meter, which is
    # where a large import's time was actually going.
    reading_mappings: list[dict] = []

    for filename, content in files:
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

            if s.rows.empty:
                continue

            series_min = s.rows["timestamp"].min()
            series_max = s.rows["timestamp"].max()
            if period_min is None or series_min < period_min:
                period_min = series_min
            if period_max is None or series_max > period_max:
                period_max = series_max

            # Vectorized extraction (native python datetimes, float-or-NaN
            # values) instead of iterrows(), which builds a pandas Series
            # per row — by far the more expensive way to walk a DataFrame.
            timestamps = s.rows["timestamp"].dt.to_pydatetime()
            values = s.rows["value"].to_numpy()
            for ts, raw_val in zip(timestamps, values):
                # A stored NaN is a real float, not SQL NULL — convert back
                # to None here, at the DB-write boundary, for any value the
                # CSV left blank or unparseable.
                val = None if pd.isna(raw_val) else float(raw_val)
                reading_mappings.append(
                    {
                        "id": uuid.uuid4(),
                        "meter_id": meter.id,
                        "import_batch_id": batch.id,
                        "timestamp": ts,
                        "value": val,
                        "raw_value": val,
                        "unit": meter.unit,
                        "quality": ReadingQuality.VALIDE,
                    }
                )

    if reading_mappings:
        db.bulk_insert_mappings(Reading, reading_mappings)

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


def validate_meter(db: Session, batch: ImportBatch, meter_id: uuid.UUID) -> dict:
    """Save one meter's curve on its own, independently of the other
    meters that may share the same import batch ("dossier"). A folder
    import can contain many meters; forcing every single one of them to be
    reviewed before any curve could be saved made the whole dossier feel
    stuck. Each meter can now be reviewed and saved as soon as its own
    zones are treated — the batch itself is only promoted to
    ImportStatus.VALIDE once every meter it contains has been saved this
    way."""
    pending = (
        db.query(Anomaly)
        .filter(
            Anomaly.import_batch_id == batch.id,
            Anomaly.meter_id == meter_id,
            Anomaly.resolution == AnomalyResolution.EN_ATTENTE,
        )
        .count()
    )
    if pending:
        raise ValueError(
            f"{pending} zone(s) de ce compteur n'ont pas encore été validée(s) ou corrigée(s). "
            "Traitez chaque zone signalée avant d'enregistrer ce compteur."
        )

    meter = db.query(Meter).get(meter_id)
    if meter is None:
        raise ValueError("Compteur introuvable dans ce dossier.")

    readings = (
        db.query(Reading)
        .filter(Reading.meter_id == meter_id, Reading.import_batch_id == batch.id)
        .order_by(Reading.timestamp)
        .all()
    )
    if not readings:
        raise ValueError("Aucune donnée pour ce compteur dans ce dossier.")

    from app.services.quality_engine import infer_granularity, _build_expected_index, analyze_series

    cfg = get_org_settings(db)

    def _quality_pct(df: pd.DataFrame) -> float:
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
        return report.quality_pct

    df = _meter_rows_df(db, meter_id, batch.id)
    quality_before = _quality_pct(df)

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
                    unit=meter.unit,
                    quality=ReadingQuality.RECONSTRUITE,
                )
            )
    db.flush()

    refreshed = (
        db.query(Reading)
        .filter(Reading.meter_id == meter_id, Reading.import_batch_id == batch.id)
        .order_by(Reading.timestamp)
        .all()
    )
    df_after = pd.DataFrame({"timestamp": [r.timestamp for r in refreshed], "value": [r.value for r in refreshed]})
    quality_after = _quality_pct(df_after)

    existing = (
        db.query(MeterValidation)
        .filter(MeterValidation.import_batch_id == batch.id, MeterValidation.meter_id == meter_id)
        .one_or_none()
    )
    if existing is None:
        existing = MeterValidation(import_batch_id=batch.id, meter_id=meter_id)
        db.add(existing)
    existing.validated_at = datetime.utcnow()
    existing.points_reconstructed = result.n_missing_filled
    existing.points_smoothed = result.n_incoherence_smoothed
    existing.quality_before = quality_before
    existing.quality_after = quality_after

    db.add(
        ProcessingHistory(
            import_batch_id=batch.id,
            action=ProcessingAction.VALIDE_ET_TRAITE,
            reconstruction_method="profil_type + interpolation",
            stats={
                "meter_id": str(meter_id),
                "meter_code": meter.code,
                "points_reconstructed": result.n_missing_filled,
                "points_smoothed": result.n_incoherence_smoothed,
                "quality_before": quality_before,
                "quality_after": quality_after,
            },
        )
    )

    all_meter_ids = {
        row[0] for row in db.query(Reading.meter_id).filter(Reading.import_batch_id == batch.id).distinct()
    }
    validated_ids = {
        row[0]
        for row in db.query(MeterValidation.meter_id).filter(MeterValidation.import_batch_id == batch.id)
    }
    validated_ids.add(meter_id)
    batch_complete = all_meter_ids <= validated_ids
    if batch_complete:
        batch.status = ImportStatus.VALIDE

    db.commit()
    db.refresh(batch)

    return {
        "status": batch.status.value,
        "meter_id": meter_id,
        "points_reconstructed": result.n_missing_filled,
        "points_smoothed": result.n_incoherence_smoothed,
        "quality_before": quality_before,
        "quality_after": quality_after,
        "batch_complete": batch_complete,
    }


def _anomaly_series_context(db: Session, batch: ImportBatch, anomaly: Anomaly):
    """Gathers what both resolve_anomaly and preview_correction need: the
    meter, its readings for this batch, and the series aligned to its
    expected index, with the set of timestamps already flagged incohérente.
    Returns None if the meter has no readings to work from."""
    meter_id = anomaly.meter_id
    meter = db.query(Meter).get(meter_id)
    readings = (
        db.query(Reading)
        .filter(Reading.meter_id == meter_id, Reading.import_batch_id == batch.id)
        .order_by(Reading.timestamp)
        .all()
    )
    if not readings:
        return None

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

    period_mask = (expected_index >= pd.Timestamp(anomaly.period_start)) & (
        expected_index <= pd.Timestamp(anomaly.period_end)
    )
    period_ts = sorted(expected_index[period_mask])

    environmental_features = None
    if app_settings.geneva_demo_weather and meter.code.upper().startswith("DEMO-GENEVE"):
        from app.services.geneva_weather import load_geneva_demo_weather
        environmental_features = load_geneva_demo_weather(expected_index, granularity)

    return {
        "meter": meter,
        "readings": readings,
        "by_ts": {pd.Timestamp(r.timestamp): r for r in readings},
        "granularity": granularity,
        "expected_index": expected_index,
        "aligned": aligned,
        "bad_ts": bad_ts,
        "period_ts": period_ts,
        "environmental_features": environmental_features,
    }


def correction_options_for_anomaly(db: Session, anomaly: Anomaly) -> list[dict]:
    """Simulate each compatible correction, rank by the resulting series quality,
    and mark only quality-improving proposals as eligible for application.
    The score is the existing 0-100 series-quality metric, not a calibrated
    statistical probability.
    """
    meter = db.query(Meter).get(anomaly.meter_id)
    batch = db.query(ImportBatch).get(anomaly.import_batch_id)
    if meter is None or batch is None:
        return []
    ctx = _anomaly_series_context(db, batch, anomaly)
    if ctx is None:
        return []

    from app.services.reconstruction_engine import available_correction_methods
    from app.services.quality_engine import analyze_series

    cfg = get_org_settings(db)
    has_weather = ctx.get("environmental_features") is not None
    options = available_correction_methods(
        meter.measurement_kind,
        meter.role,
        fluid_type=meter.fluid_type,
        anomaly_subtype=anomaly.subtype,
        has_weather=has_weather,
    )

    def quality_score(values: pd.Series) -> float:
        frame = pd.DataFrame({"timestamp": ctx["expected_index"], "value": values.to_numpy()})
        return analyze_series(
            meter.code, frame,
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
        ).quality_pct

    original_score = quality_score(ctx["aligned"])
    ranked = []
    for order, option in enumerate(options):
        result = reconstruct_series(
            ctx["expected_index"], ctx["aligned"], ctx["bad_ts"], ctx["granularity"],
            method=option["method"], environmental_features=ctx.get("environmental_features"),
        )
        required_targets = [
            ts for ts in ctx["period_ts"]
            if ts in ctx["bad_ts"] or pd.isna(ctx["aligned"].get(ts))
        ]
        covered = bool(required_targets) and all(
            result.methods_used.get(ts) == option["method"] for ts in required_targets
        )
        simulated = ctx["aligned"].copy()
        for ts in required_targets:
            if result.methods_used.get(ts) == option["method"]:
                simulated.loc[ts] = result.values.loc[ts]
        score = quality_score(simulated)
        gain = round(score - original_score, 1)
        option.update({
            "original_confidence_pct": original_score,
            "confidence_pct": score,
            "confidence_gain_pct": gain,
            "model_fit_pct": result.model_fit_pct,
            "eligible": covered and gain > 0,
            "confidence_basis": "Indice de cohérence global de la série, recalculé avec les critères actifs; ce n’est pas une probabilité statistique.",
            "_order": order,
        })
        ranked.append(option)
    ranked.sort(key=lambda item: (
        not item["eligible"],
        -item["confidence_gain_pct"],
        -item["confidence_pct"],
        -(item["model_fit_pct"] if item["model_fit_pct"] is not None else -1.0),
        item["_order"],
    ))
    for rank, option in enumerate(ranked, 1):
        option["rank"] = rank
        option.pop("_order", None)
    return ranked


def preview_correction(db: Session, batch: ImportBatch, anomaly: Anomaly, method: str) -> list[dict]:
    """What applying `method` to this one anomaly's period WOULD produce,
    without writing anything — lets the person compare techniques before
    committing to one."""
    ctx = _anomaly_series_context(db, batch, anomaly)
    if ctx is None:
        return []

    result = reconstruct_series(
        ctx["expected_index"], ctx["aligned"], ctx["bad_ts"], ctx["granularity"], method=method,
        environmental_features=ctx.get("environmental_features"),
    )

    points = []
    for ts in ctx["period_ts"]:
        r = ctx["by_ts"].get(ts)
        current = r.value if r is not None else None
        proposed = float(result.values[ts]) if pd.notna(result.values.get(ts)) else None
        points.append(
            {
                "timestamp": ts.to_pydatetime(),
                "current_value": current,
                "proposed_value": proposed,
            }
        )
    return points


def resolve_anomaly(
    db: Session, batch: ImportBatch, anomaly: Anomaly, resolution: str,
    method: str | None = None, comment: str | None = None,
) -> dict:
    """Step 2 of the wizard ("Traiter et reconstruire"): record the
    person's decision for one flagged zone.

    - "validee": the zone is kept exactly as imported (e.g. a legitimate
      meter replacement, or a production meter's negative convention) — no
      reading is touched, only the anomaly's own resolution is recorded.
    - "corrigee": the zone is reconstructed right away, applied only to
      this anomaly's own period so zones not yet reviewed are left alone.
      `method` picks which technique to use (see
      reconstruction_engine.available_correction_methods); when omitted,
      the automatic profil-type -> interpolation cascade is used, as
      before."""
    resolution_enum = AnomalyResolution(resolution)
    comment = (comment or "").strip()
    if len(comment) > 1000:
        raise ValueError("Le commentaire ne peut pas dépasser 1 000 caractères.")
    if resolution_enum == AnomalyResolution.VALIDEE and not comment:
        raise ValueError("Un commentaire est obligatoire pour valider l’anomalie en l’état.")

    selected_option = None
    if resolution_enum == AnomalyResolution.CORRIGEE:
        options = correction_options_for_anomaly(db, anomaly)
        selected_option = next((item for item in options if item["method"] == method), None) if method else None
        if selected_option is None:
            selected_option = next((item for item in options if item["eligible"]), None)
        if selected_option is None or not selected_option["eligible"]:
            raise ValueError("Aucun correctif proposé n’améliore la fiabilité estimée de la série.")
        method = selected_option["method"]

    anomaly.resolution = resolution_enum
    stats: dict = {"anomaly_id": str(anomaly.id), "resolution": resolution}
    if comment:
        stats["comment"] = comment

    if resolution_enum == AnomalyResolution.CORRIGEE:
        stats.update({
            "series_confidence_before_pct": selected_option["original_confidence_pct"],
            "series_confidence_after_pct": selected_option["confidence_pct"],
            "series_confidence_gain_pct": selected_option["confidence_gain_pct"],
        })
        ctx = _anomaly_series_context(db, batch, anomaly)
        if ctx is not None:
            meter = ctx["meter"]
            result = reconstruct_series(
                ctx["expected_index"], ctx["aligned"], ctx["bad_ts"], ctx["granularity"], method=method,
                environmental_features=ctx.get("environmental_features"),
            )

            n_applied = 0
            for ts in ctx["period_ts"]:
                if ts not in result.methods_used:
                    continue
                r = ctx["by_ts"].get(ts)
                new_val = float(result.values[ts]) if pd.notna(result.values[ts]) else None
                if r is not None:
                    r.value = new_val
                    r.quality = ReadingQuality.RECONSTRUITE
                else:
                    db.add(
                        Reading(
                            meter_id=meter.id,
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
            stats["method"] = method or "profil_type + interpolation"

    db.add(
        ProcessingHistory(
            import_batch_id=batch.id,
            action=ProcessingAction.REANALYSE,
            reconstruction_method=(method or "profil_type + interpolation") + " (zone)"
            if resolution_enum == AnomalyResolution.CORRIGEE
            else None,
            stats=stats,
        )
    )
    db.commit()
    db.refresh(anomaly)
    return stats


def reject_batch(db: Session, batch: ImportBatch) -> ImportBatch:
    batch.status = ImportStatus.REFUSE
    # A refused file's quality/reliability index is no longer meaningful —
    # clear it so the stored record itself reflects "non valide" rather
    # than leaving a stale percentage from before the refusal.
    batch.quality_score = None
    db.add(ProcessingHistory(import_batch_id=batch.id, action=ProcessingAction.REFUSE, stats={}))
    db.commit()
    db.refresh(batch)
    return batch


def export_rows(db: Session, batch: ImportBatch) -> list[dict]:
    """Flat row-per-reading view of this dossier's QUALIFIED meters only,
    ready to hand to a CSV or JSON serializer — step 3 of the wizard
    ("Valider et exporter"). Export doesn't wait for the whole dossier to
    be finished: a meter is included the moment it has its own
    MeterValidation row, regardless of whether other meters in the same
    dossier are still pending. `valeur` is the final (possibly
    reconstructed) value; `valeur_brute` preserves what was actually in
    the source file, even where the reconstruction engine has since
    overwritten `valeur`."""
    qualified_meter_ids = [
        row[0] for row in db.query(MeterValidation.meter_id).filter(MeterValidation.import_batch_id == batch.id)
    ]
    if not qualified_meter_ids:
        return []
    rows = (
        db.query(Reading, Meter, Building)
        .join(Meter, Meter.id == Reading.meter_id)
        .join(Building, Building.id == Meter.building_id)
        .filter(Reading.import_batch_id == batch.id, Reading.meter_id.in_(qualified_meter_ids))
        .order_by(Building.name, Meter.code, Reading.timestamp)
        .all()
    )
    return [
        {
            "batiment": building.name,
            "code_batiment": building.code,
            "compteur": meter.label,
            "code_compteur": meter.code,
            "type_fluide": meter.fluid_type,
            "role": meter.role,
            "unite": meter.unit,
            "horodatage": reading.timestamp.isoformat(),
            "valeur": reading.value,
            "valeur_brute": reading.raw_value,
            "qualite": reading.quality.value,
        }
        for reading, meter, building in rows
    ]


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
