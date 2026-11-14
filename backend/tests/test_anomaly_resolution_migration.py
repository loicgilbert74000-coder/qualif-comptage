"""Regression test for the resolution-column migration bug: SQLAlchemy's
Enum() type stores a Python Enum member by its NAME ("EN_ATTENTE"), not its
value ("en_attente"). An earlier version of the startup migration shim
backfilled the column with the lowercase VALUE instead, which made every
pre-existing anomaly row unreadable by the ORM — any endpoint listing
anomalies (GET .../anomalies, the "Traiter et reconstruire" page) raised a
500 and the frontend was left stuck on "Chargement..." forever, since it
never catches/surfaces that failure.

This test reproduces the corrupted state directly in SQLite and checks that
the repair statements in app.main.on_startup make the rows readable again."""
import uuid
from datetime import datetime

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Anomaly, AnomalyType, AnomalyResolution


def _make_session(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    return engine, Session()


def test_lowercase_backfilled_resolution_is_unreadable_before_repair(tmp_path):
    engine, session = _make_session(tmp_path)
    anomaly_id = str(uuid.uuid4())
    with engine.begin() as conn:
        # Simulate a row corrupted by the old (buggy) migration default.
        conn.execute(text(
            "INSERT INTO anomalies (id, import_batch_id, meter_id, type, subtype, "
            "period_start, period_end, description, deviation_pct, resolution) "
            "VALUES (:id, :batch, :meter, 'INCOHERENCE', 'pic', :ts, :ts, 'test', NULL, 'en_attente')"
        ), {"id": anomaly_id, "batch": str(uuid.uuid4()), "meter": str(uuid.uuid4()), "ts": datetime.utcnow()})

    try:
        session.query(Anomaly).filter(Anomaly.id == anomaly_id).one()
        raised = False
    except LookupError:
        raised = True
    assert raised, "expected the lowercase-valued row to be unreadable before the repair runs"
    session.close()


def test_repair_statements_make_rows_readable_again(tmp_path):
    engine, session = _make_session(tmp_path)
    anomaly_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO anomalies (id, import_batch_id, meter_id, type, subtype, "
            "period_start, period_end, description, deviation_pct, resolution) "
            "VALUES (:id, :batch, :meter, 'INCOHERENCE', 'pic', :ts, :ts, 'test', NULL, 'en_attente')"
        ), {"id": anomaly_id, "batch": str(uuid.uuid4()), "meter": str(uuid.uuid4()), "ts": datetime.utcnow()})

    # The same repair run at every app startup (app/main.py on_startup).
    with engine.begin() as conn:
        conn.execute(text("UPDATE anomalies SET resolution = 'EN_ATTENTE' WHERE resolution = 'en_attente'"))
        conn.execute(text("UPDATE anomalies SET resolution = 'VALIDEE' WHERE resolution = 'validee'"))
        conn.execute(text("UPDATE anomalies SET resolution = 'CORRIGEE' WHERE resolution = 'corrigee'"))

    session.expire_all()
    row = session.query(Anomaly).filter(Anomaly.id == anomaly_id).one()
    assert row.resolution == AnomalyResolution.EN_ATTENTE
    session.close()
