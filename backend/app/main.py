import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import inspect, text

from app.config import settings
from app.database import engine, SessionLocal
from app.models import Base
from app.routers import imports, buildings, history, settings_router, database_viewer, criteria_profiles
from app.services.criteria_profiles import seed_default_profiles
from app._version import BUILD_VERSION

log = logging.getLogger("app")

app = FastAPI(title="Qualification des données de comptage", version="0.1.0")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Anything that reaches here is a bug, not a user mistake (those already
    # raise HTTPException/ValueError, handled where they occur) — log the
    # full traceback so it's actually diagnosable (see desktop_main.py's
    # uvicorn log_config=None for why this previously vanished entirely in
    # the desktop build), and return a message the frontend can show instead
    # of the bare, silent "Internal Server Error" the default handler gives.
    log.exception("Erreur non gérée sur %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Une erreur inattendue s'est produite côté serveur. Voir app.log pour le détail."},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    # ``create_all`` does not add fields to an existing database. Keep older
    # Docker/SQLite installations compatible with the new measurement label.
    columns = {column["name"] for column in inspect(engine).get_columns("meters")}
    if "measurement_kind" not in columns:
        with engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE meters ADD COLUMN measurement_kind VARCHAR(24) "
                "NOT NULL DEFAULT 'indéterminé'"
            ))
    settings_columns = {column["name"] for column in inspect(engine).get_columns("org_settings")}
    settings_defaults = {
        "historical_min_points": "INTEGER NOT NULL DEFAULT 6",
        "robust_mad_multiplier": "FLOAT NOT NULL DEFAULT 6.0",
        "historical_extreme_ratio": "FLOAT NOT NULL DEFAULT 3.0",
        "zero_active_min_history": "INTEGER NOT NULL DEFAULT 4",
        "seasonal_activity_min_history": "INTEGER NOT NULL DEFAULT 3",
        "timestamp_tolerance_pct": "FLOAT NOT NULL DEFAULT 10.0",
    }
    with engine.begin() as connection:
        for name, declaration in settings_defaults.items():
            if name not in settings_columns:
                connection.execute(text(f"ALTER TABLE org_settings ADD COLUMN {name} {declaration}"))

    anomaly_columns = {column["name"] for column in inspect(engine).get_columns("anomalies")}
    if "resolution" not in anomaly_columns:
        with engine.begin() as connection:
            # SQLAlchemy's Enum() type stores a Python Enum member by its NAME
            # ("EN_ATTENTE"), not its value ("en_attente") — unlike every
            # other field in this column, the default here is written by raw
            # SQL rather than through the ORM, so it must match that name-based
            # convention or every row backfilled by it becomes unreadable by
            # the ORM (a 500 on any endpoint that lists anomalies).
            connection.execute(text(
                "ALTER TABLE anomalies ADD COLUMN resolution VARCHAR(16) "
                "NOT NULL DEFAULT 'EN_ATTENTE'"
            ))

    # One-time repair for databases that went through an earlier build of
    # this migration, which mistakenly backfilled the lowercase enum VALUE
    # ("en_attente") instead of the NAME ("EN_ATTENTE") — making those rows
    # unreadable by the ORM. Safe to run every startup: it's a no-op once
    # the data is clean, and harmless on a fresh database that never had the
    # bad default.
    with engine.begin() as connection:
        connection.execute(text("UPDATE anomalies SET resolution = 'EN_ATTENTE' WHERE resolution = 'en_attente'"))
        connection.execute(text("UPDATE anomalies SET resolution = 'VALIDEE' WHERE resolution = 'validee'"))
        connection.execute(text("UPDATE anomalies SET resolution = 'CORRIGEE' WHERE resolution = 'corrigee'"))

    batch_columns = {column["name"] for column in inspect(engine).get_columns("import_batches")}
    if "content_hash" not in batch_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE import_batches ADD COLUMN content_hash VARCHAR(64)"))

    meter_columns = {column["name"] for column in inspect(engine).get_columns("meters")}
    if "status" not in meter_columns:
        with engine.begin() as connection:
            # Same Enum()-stores-the-NAME convention as "anomalies.resolution"
            # above: the default must be "A_VALIDER", not "a_valider".
            connection.execute(text(
                "ALTER TABLE meters ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'A_VALIDER'"
            ))
    if "quality_score" not in meter_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE meters ADD COLUMN quality_score FLOAT"))
    if "usage_profile" not in meter_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE meters ADD COLUMN usage_profile VARCHAR(24)"))
    if "usage_profile_suggested" not in meter_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE meters ADD COLUMN usage_profile_suggested VARCHAR(24)"))

    # criteria_profiles is a brand-new table (create_all above already made
    # it) — seed it once from whatever org_settings already held, so a site
    # that had tuned its old global thresholds doesn't lose that tuning.
    db = SessionLocal()
    try:
        seed_default_profiles(db)
    finally:
        db.close()


app.include_router(imports.router)
app.include_router(buildings.router)
app.include_router(history.router)
app.include_router(settings_router.router)
app.include_router(database_viewer.router)
app.include_router(criteria_profiles.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": BUILD_VERSION}


# --- Standalone desktop build ------------------------------------------------
# When QC_FRONTEND_DIR is set (only by desktop_main.py, packaged with
# PyInstaller), this same FastAPI app also serves the built React app, so the
# whole thing runs as one process with no separate web server. The Docker
# deployment never sets this env var: nginx serves the frontend there instead.
_frontend_dir = os.environ.get("QC_FRONTEND_DIR")
if _frontend_dir and Path(_frontend_dir).is_dir():
    assets_dir = Path(_frontend_dir) / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        # Any route not matched by the /api/* routers above falls through to
        # here and gets the SPA's index.html, so client-side routes
        # (/traitements, /historique, ...) work on a hard refresh too.
        candidate = Path(_frontend_dir) / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(Path(_frontend_dir) / "index.html")
