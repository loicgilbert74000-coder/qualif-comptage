"""A minimal, read-only database browser.

Lets a technical user glance at the raw rows behind the app (SQLite in the
desktop build, PostgreSQL in the Docker deployment) without opening a
separate DB tool. Deliberately simple and cheap: no joins, no full-table
loads, no client-side framework — one paginated SELECT per request, driven
entirely by the ORM models already registered on `Base` (so it never needs
its own list of tables to keep in sync, and never builds SQL by splicing a
table name into a string).
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Base

router = APIRouter(prefix="/api/db", tags=["database"])

# Built once at import time from every model registered on Base — picks up
# new tables automatically, never needs editing when a model is added.
_MAPPERS = sorted(Base.registry.mappers, key=lambda m: m.local_table.name)
_TABLES_BY_NAME = {m.local_table.name: m.class_ for m in _MAPPERS}


def _cell(value):
    """Make any column value JSON-safe, without guessing at its meaning."""
    if value is None or isinstance(value, (str, int, float, bool, dict, list)):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return f"<{len(value)} octet(s)>"
    return str(value)


@router.get("/tables")
def list_tables(db: Session = Depends(get_db)):
    """Table names with their row count — one COUNT(*) each, no row data,
    so this stays instant even if a table is large."""
    return [
        {"name": name, "row_count": db.query(model).count()}
        for name, model in _TABLES_BY_NAME.items()
    ]


@router.get("/tables/{table}/rows")
def table_rows(
    table: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """One page of raw rows from `table`. Capped at 200 rows per call and
    always driven by LIMIT/OFFSET in the database — never loads the whole
    table into memory, however big it gets."""
    model = _TABLES_BY_NAME.get(table)
    if model is None:
        raise HTTPException(404, "Table inconnue")

    mapper = model.__mapper__
    columns = [c.key for c in mapper.column_attrs]
    # Attribute keys (not raw column names, which can differ) of whichever
    # column_attrs sit on the primary key, so getattr(model, key) below
    # always resolves to a real mapped attribute.
    pk_cols = [c.key for c in mapper.column_attrs if c.columns[0].primary_key]

    total = db.query(model).count()
    query = db.query(model)
    if pk_cols:
        # Newest-looking rows first when the primary key sorts that way
        # (sequential ids, time-ordered UUIDs); harmless either way, it's
        # only a display order.
        query = query.order_by(*[getattr(model, c).desc() for c in pk_cols])
    rows = query.offset(offset).limit(limit).all()

    return {
        "table": table,
        "columns": columns,
        "rows": [{c: _cell(getattr(obj, c)) for c in columns} for obj in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
