"""Entry point for the standalone desktop build (packaged into a single
.exe with PyInstaller). No Docker, no PostgreSQL to install: data is kept in
a local SQLite file under the user's profile. The API server runs in a
background thread; the main thread opens a native application window (via
pywebview) pointing at it, so the app looks and behaves like a real desktop
program rather than a browser tab. If a native window can't be created on
this machine (e.g. the required WebView2 runtime is missing on an older
Windows, or pywebview isn't bundled for this platform), it falls back to
opening the default browser instead of failing silently.

IMPORTANT: every app.* module must be imported AFTER the environment
variables below are set, because app.config reads them once, at import
time.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_PORT = 8743
APP_TITLE = "Qualification des données de comptage"


def resource_path(relative: str) -> Path:
    """Path to a bundled resource, whether running frozen (PyInstaller
    --onefile extracts to a temp dir exposed as sys._MEIPASS) or as a plain
    script during development."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


def user_data_dir() -> Path:
    """A writable, persistent directory for the SQLite database, the
    imported files and the log — never inside the PyInstaller temp
    extraction dir, which is wiped after the process exits."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home())
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    target = base / "QualifComptage"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _safe_print(*args) -> None:
    # In a --windowed Windows build there is no console and sys.stdout can
    # be None; a bare print() would then raise and silently kill the thread.
    try:
        print(*args)
    except Exception:
        pass


def _wait_until_ready(url: str, timeout_s: float = 30.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{url}/api/health", timeout=0.5)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def main() -> None:
    data_dir = user_data_dir()
    imports_dir = data_dir / "imports"
    imports_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "qualif_comptage.db"

    logging.basicConfig(
        filename=str(data_dir / "app.log"),
        filemode="a",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    log = logging.getLogger("desktop")
    log.info("=== Démarrage ===")

    os.environ["QC_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    os.environ["QC_STORAGE_DIR"] = str(imports_dir)
    os.environ["QC_CORS_ORIGINS"] = (
        f'["http://127.0.0.1:{APP_PORT}", "http://localhost:{APP_PORT}"]'
    )
    os.environ["QC_FRONTEND_DIR"] = str(resource_path("frontend_dist"))

    import uvicorn
    from app.main import app

    url = f"http://127.0.0.1:{APP_PORT}"

    def _run_server() -> None:
        try:
            uvicorn.run(app, host="127.0.0.1", port=APP_PORT, log_level="warning")
        except Exception:
            log.exception("Le serveur local a planté")

    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    _safe_print(f"Qualification des données de comptage — données dans : {data_dir}")
    if not _wait_until_ready(url):
        log.error("Le serveur local n'a pas démarré à temps (30s)")
        _safe_print("Erreur : le serveur local n'a pas démarré à temps. Voir app.log.")

    try:
        import webview  # pywebview: a native OS window around the local URL

        log.info("Ouverture de la fenêtre native (pywebview)")
        webview.create_window(APP_TITLE, url, width=1440, height=900, min_size=(1000, 700))
        webview.start()
    except Exception:
        log.exception("Fenêtre native indisponible, repli sur le navigateur par défaut")
        _safe_print("Fenêtre native indisponible, ouverture dans le navigateur par défaut.")
        import webbrowser

        webbrowser.open(url)
        # No native window to wait on in this fallback: keep the process
        # (and therefore the local server) alive until it's killed.
        server_thread.join()

    log.info("=== Fermeture ===")


if __name__ == "__main__":
    main()
