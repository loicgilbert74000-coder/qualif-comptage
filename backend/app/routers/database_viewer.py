"""A minimal, read-only database view.

Shows one simplified, flattened table of readings — meter, building,
timestamp (UTC), raw value, corrected value, the meter's reliability index
and its overall validity — instead of the app's raw internal tables.
Deliberately limited to exactly what a non-technical user needs to check,
rather than a generic table browser.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Base, Reading, Meter, Building

router = APIRouter(prefix="/api/db", tags=["database"])

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


def _row_out(reading: Reading, meter: Meter, building: Building) -> dict:
    return {
        "id": str(reading.id),
        "meter_code": meter.code,
        "building": building.name,
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


@router.get("/readings")
def list_readings(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """One page of the simplified reading view, newest first. Always
    driven by LIMIT/OFFSET in the database — never loads the whole table
    into memory, however big it gets."""
    base_query = (
        db.query(Reading, Meter, Building)
        .join(Meter, Meter.id == Reading.meter_id)
        .join(Building, Building.id == Meter.building_id)
    )
    total = base_query.count()
    rows = base_query.order_by(Reading.timestamp.desc(), Reading.id.desc()).offset(offset).limit(limit).all()

    return {
        "rows": [_row_out(r, m, b) for r, m, b in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
