import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import settings
from app.database import engine
from app.models import Base
from app.routers import imports, buildings, history, settings_router

app = FastAPI(title="Qualification des données de comptage", version="0.1.0")

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


app.include_router(imports.router)
app.include_router(buildings.router)
app.include_router(history.router)
app.include_router(settings_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
