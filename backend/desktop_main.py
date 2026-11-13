"""Entry point for the standalone desktop build (packaged into a single
.exe with PyInstaller). No Docker, no PostgreSQL to install: data is kept in
a local SQLite file under the user's profile, and this same process serves
both the API and the already-built React app, then opens it in the default
browser.

IMPORTANT: every app.* module must be imported AFTER the environment
variables below are set, because app.config reads them once, at import
time.
"""
from __future__ import annotations

import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

APP_PORT = 8743


def resource_path(relative: str) -> Path:
    """Path to a bundled resource, whether running frozen (PyInstaller
    --onefile extracts to a temp dir exposed as sys._MEIPASS) or as a plain
    script during development."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


def user_data_dir() -> Path:
    """A writable, persistent directory for the SQLite database and the
    imported files — never inside the PyInstaller temp extraction dir, which
    is wiped after the process exits."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home())
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    target = base / "QualifComptage"
    target.mkdir(parents=True, exist_ok=True)
    return target


def main() -> None:
    data_dir = user_data_dir()
    imports_dir = data_dir / "imports"
    imports_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "qualif_comptage.db"

    os.environ["QC_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["QC_STORAGE_DIR"] = str(imports_dir)
    os.environ["QC_CORS_ORIGINS"] = (
        f'["http://127.0.0.1:{APP_PORT}", "http://localhost:{APP_PORT}"]'
    )
    os.environ["QC_FRONTEND_DIR"] = str(resource_path("frontend_dist"))

    import uvicorn
    from app.main import app

    def _open_browser_when_ready() -> None:
        import urllib.request

        url = f"http://127.0.0.1:{APP_PORT}"
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{url}/api/health", timeout=0.5)
                webbrowser.open(url)
                return
            except Exception:
                time.sleep(0.5)

    threading.Thread(target=_open_browser_when_ready, daemon=True).start()

    print(f"Qualification des données de comptage — données dans : {data_dir}")
    print(f"Ouverture de l'application sur {('http://127.0.0.1:%d' % APP_PORT)} ...")
    uvicorn.run(app, host="127.0.0.1", port=APP_PORT, log_level="warning")


if __name__ == "__main__":
    main()
