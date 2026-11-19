"""A minimal, read-only database view.

Shows one simplified, flattened table of readings — meter, building,
timestamp (UTC), raw value, corrected value, the meter's reliability index
and its overall validity — instead of the app's raw internal tables.
Deliberately limited to exactly what a non-technical user needs to check,
rather than a generic table browser.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Query as SAQuery, Session

from app.database import get_db
from app.models import Base, ImportBatch, Reading, Meter, Building, MeterStatus

router = APIRouter(prefix="/api/db", tags=["database"])

# This page is meant to be "the database" as a non-technical user thinks of
# it — the readings that have actually been checked and accepted — not
# every row the app happens to hold, which includes meters still mid-review
# or whose batch was refused. Hard filter, not just a dropdown choice: it
# applies even when no "validity" filter is selected.
_QUALIFIED_STATUSES = (MeterStatus.VALIDE, MeterStatus.CORRIGE)

# Built once at import time from every model registered on Base — used
# only by the wipe endpoint below, which still clears every table
# regardless of what the simplified view displays.
_MAPPERS = sorted(Base.registry.mappers, key=lambda m: m.local_table.name)
_TABLES_BY_NAME = {m.local_table.name: m.class_ for m in _MAPPERS}

# Source files carry a naive timestamp with no timezone of their own —
# Geneva/Swiss metering exports report local time (Europe/Zurich, with its
# own DST rules), never UTC. Localizing as this zone before converting is
# an assumption, not a certainty the data itself states; flagged here so
# it's easy to find and change if a source turns out to already be UTC.
_SOURCE_TZ = ZoneInfo("Europe/Zurich")
_UTC = ZoneInfo("UTC")


def _to_utc_iso(ts: datetime) -> str:
    return ts.replace(tzinfo=_SOURCE_TZ).astimezone(_UTC).isoformat()


def _from_utc_iso(iso: str) -> datetime:
    """Inverse of _to_utc_iso: a UTC boundary from the frontend's date filter,
    converted back to the naive Europe/Zurich time Reading.timestamp is
    stored in, so the comparison lines up with what's actually in the column."""
    parsed = datetime.fromisoformat(iso)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_UTC)
    return parsed.astimezone(_SOURCE_TZ).replace(tzinfo=None)


def _canonical_reading_ids(db: Session):
    """A meter that was qualified, then had its import archived (see
    delete_batch) and later reimported, ends up with two Reading rows for
    the same instant — one kept under the archived batch (deliberately —
    it was qualified data), one from the fresh import. This page is meant
    to read like "the database" in plain terms, so it shows one row per
    meter/instant rather than the raw duplicate, preferring whichever copy
    isn't archived (and falling back to the archived one when it's the
    only copy left)."""
    ranked = (
        db.query(
            Reading.id.label("reading_id"),
            func.row_number()
            .over(
                partition_by=(Reading.meter_id, Reading.timestamp),
                order_by=(ImportBatch.archived.asc(), Reading.id.desc()),
            )
            .label("rn"),
        )
        .join(ImportBatch, ImportBatch.id == Reading.import_batch_id)
        .subquery()
    )
    return db.query(ranked.c.reading_id).filter(ranked.c.rn == 1).subquery()


def _apply_filters(
    query: SAQuery,
    *,
    db: Session,
    meter_code: str | None,
    building: str | None,
    fluid_type: str | None,
    validity: str | None,
    timestamp_from: str | None,
    timestamp_to: str | None,
) -> SAQuery:
    """Shared by /readings and /export, so a reading matches the export
    exactly when it matches the on-screen filtered table — the export is
    meant to download exactly what the filters currently show, nothing more
    or less."""
    # Always applied, independently of whatever the "validity" dropdown is
    # set to — this page only ever shows qualified data (see
    # _QUALIFIED_STATUSES above the router).
    query = query.filter(Meter.status.in_(_QUALIFIED_STATUSES))
    query = query.filter(Reading.id.in_(db.query(_canonical_reading_ids(db).c.reading_id)))
    if meter_code:
        query = query.filter(Meter.code == meter_code)
    if building:
        query = query.filter(Building.name == building)
    if fluid_type:
        query = query.filter(Meter.fluid_type == fluid_type)
    if validity:
        try:
            status = MeterStatus(validity)
        except ValueError:
            status = None  # unknown value: ignored rather than erroring on a stale filter
        if status in _QUALIFIED_STATUSES:
            query = query.filter(Meter.status == status)
    if timestamp_from:
        query = query.filter(Reading.timestamp >= _from_utc_iso(timestamp_from))
    if timestamp_to:
        query = query.filter(Reading.timestamp <= _from_utc_iso(timestamp_to))
    return query


def _row_out(reading: Reading, meter: Meter, building: Building) -> dict:
    return {
        "id": str(reading.id),
        "meter_id": str(meter.id),
        "meter_code": meter.code,
        "building": building.name,
        "fluid_type": meter.fluid_type,
        "unit": meter.unit,
        "timestamp_utc": _to_utc_iso(reading.timestamp),
        "raw_value": reading.raw_value,
        "corrected_value": reading.value,
        "reliability_index": meter.quality_score,
        "validity": meter.status.value,
    }


@router.post("/wipe")
def wipe_database(db: Session = Depends(get_db)):
    """Delete every row from every table. Irreversible — the frontend only
    calls this after an explicit, two-step confirmation from the user."""
    # Children before parents, so this works even on a backend where FK
    # ON DELETE CASCADE isn't relied upon.
    ordered = [
        "readings", "anomalies", "meter_validations", "processing_history",
        "import_batches", "meters", "buildings", "org_settings",
    ]
    remaining = [n for n in _TABLES_BY_NAME if n not in ordered]
    for name in ordered + remaining:
        model = _TABLES_BY_NAME.get(name)
        if model is not None:
            db.query(model).delete(synchronize_session=False)
    db.commit()
    return {"status": "ok"}


@router.delete("/meters/{meter_id}")
def delete_meter(meter_id: UUID, db: Session = Depends(get_db)):
    """Remove one meter entirely — its readings, anomalies and validation
    history go with it (meter_id's FKs all cascade; see database.py for why
    that now actually fires on SQLite too), and its building is removed as
    well if this was the last meter it had. Every import batch that fed
    this meter is left as-is: only the meter itself (and what hangs off it)
    is deleted, not the dossiers that happened to mention it — a batch can
    still cover other meters that are unaffected by this deletion."""
    meter = db.query(Meter).get(meter_id)
    if meter is None:
        raise HTTPException(404, "Compteur introuvable.")
    building_id = meter.building_id
    db.delete(meter)
    db.commit()
    has_other_meters = db.query(Meter.id).filter(Meter.building_id == building_id).first() is not None
    if not has_other_meters:
        building = db.query(Building).get(building_id)
        if building is not None:
            db.delete(building)
            db.commit()
    return {"status": "ok"}


@router.get("/readings")
def list_readings(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    meter_code: str | None = Query(None),
    building: str | None = Query(None),
    fluid_type: str | None = Query(None),
    validity: str | None = Query(None),
    timestamp_from: str | None = Query(None, description="Borne inférieure, ISO, en UTC."),
    timestamp_to: str | None = Query(None, description="Borne supérieure, ISO, en UTC."),
    db: Session = Depends(get_db),
):
    """One page of the simplified reading view, newest first. Always
    driven by LIMIT/OFFSET in the database — never loads the whole table
    into memory, however big it gets. Every filter is applied in the
    database query itself, before LIMIT/OFFSET, so it works correctly
    across pages rather than only filtering the current page."""
    base_query = (
        db.query(Reading, Meter, Building)
        .join(Meter, Meter.id == Reading.meter_id)
        .join(Building, Building.id == Meter.building_id)
    )
    base_query = _apply_filters(
        base_query, db=db, meter_code=meter_code, building=building, fluid_type=fluid_type,
        validity=validity, timestamp_from=timestamp_from, timestamp_to=timestamp_to,
    )

    total = base_query.count()
    rows = base_query.order_by(Reading.timestamp.desc(), Reading.id.desc()).offset(offset).limit(limit).all()

    return {
        "rows": [_row_out(r, m, b) for r, m, b in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/readings/filter-options")
def list_filter_options(db: Session = Depends(get_db)):
    """Distinct values currently in the simplified view, used to populate
    each column's filter dropdown — so the choices offered always match
    what's actually in the database, not a hardcoded list.

    Joined through Reading on purpose: a Meter/Building row can outlive
    every one of its readings (deleting a dossier removes its readings but
    may leave the meters/buildings alone if they were ever qualified — see
    delete_batch), and such a meter has nothing to show in this view.
    Listing it as a filter choice would offer a filter that always returns
    zero rows, which is what was happening. Also restricted to qualified
    meters, like the view itself (see _QUALIFIED_STATUSES)."""
    with_readings = (
        db.query(Reading.meter_id)
        .join(Meter, Meter.id == Reading.meter_id)
        .filter(Meter.status.in_(_QUALIFIED_STATUSES))
        .distinct()
        .subquery()
    )
    meters_q = (
        db.query(Meter.code, Building.name)
        .join(Building, Building.id == Meter.building_id)
        .join(with_readings, with_readings.c.meter_id == Meter.id)
        .distinct()
        .order_by(Meter.code)
    )
    buildings_q = (
        db.query(Building.name)
        .join(Meter, Meter.building_id == Building.id)
        .join(with_readings, with_readings.c.meter_id == Meter.id)
        .distinct()
        .order_by(Building.name)
    )
    fluids_q = (
        db.query(Meter.fluid_type)
        .join(with_readings, with_readings.c.meter_id == Meter.id)
        .distinct()
        .order_by(Meter.fluid_type)
    )
    return {
        "meter_codes": [m for m, _ in meters_q.all()],
        "buildings": [b for (b,) in buildings_q.all()],
        "fluid_types": [f for (f,) in fluids_q.all()],
        "validities": [s.value for s in _QUALIFIED_STATUSES],
    }


@router.get("/export")
def export_readings(
    format: str = Query("csv"),
    meter_code: str | None = Query(None),
    building: str | None = Query(None),
    fluid_type: str | None = Query(None),
    validity: str | None = Query(None),
    timestamp_from: str | None = Query(None),
    timestamp_to: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Exports the simplified reading view, filtered exactly like the
    on-screen table — by compteur, bâtiment, fluide, validité and/or
    période — rather than being tied to one import dossier. Unlike
    /imports/{batch_id}/export (which only ever covers one dossier's
    already-qualified meters), this lets someone export any slice of
    what's actually in the database today."""
    if format not in ("csv", "json"):
        raise HTTPException(400, "Format d'export invalide : 'csv' ou 'json' attendu.")

    base_query = (
        db.query(Reading, Meter, Building)
        .join(Meter, Meter.id == Reading.meter_id)
        .join(Building, Building.id == Meter.building_id)
    )
    base_query = _apply_filters(
        base_query, db=db, meter_code=meter_code, building=building, fluid_type=fluid_type,
        validity=validity, timestamp_from=timestamp_from, timestamp_to=timestamp_to,
    )
    rows_raw = base_query.order_by(Building.name, Meter.code, Reading.timestamp).all()
    if not rows_raw:
        raise HTTPException(400, "Aucun relevé ne correspond à ces filtres.")
    rows = [_row_out(r, m, b) for r, m, b in rows_raw]

    name_bits = [b for b in (meter_code, building, fluid_type) if b] or ["export"]
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", "_".join(name_bits)).strip("_") or "export"

    if format == "json":
        return Response(
            content=json.dumps(rows, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.json"'},
        )

    fieldnames = [
        "meter_code", "building", "fluid_type", "unit", "timestamp_utc",
        "raw_value", "corrected_value", "reliability_index", "validity",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, delimiter=";", extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
    )
