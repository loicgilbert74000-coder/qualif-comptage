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

import json
import logging
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_PORT = 8743
APP_TITLE = "Qualification des données de comptage"

# A --windowed/--noconsole Windows build has no console, so sys.stdout and
# sys.stderr are None — not a stream that silently discards writes, but the
# absence of one. uvicorn (and other libraries) write their startup/access
# logs to sys.stderr by default; the very first such write raises
# AttributeError ("'NoneType' object has no attribute 'write'"), which
# kills the server thread before it ever binds the port. The window then
# opens anyway and shows "ERR_CONNECTION_REFUSED", with nothing printed
# anywhere to explain why. Must run before uvicorn/app are imported.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")


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


def _already_serving_version(url: str) -> str | None:
    """The version reported by whatever is already answering /api/health on
    our port, or None if nothing answers there.

    Something answering here is almost always a previous launch of this
    very app that the user never fully closed (e.g. it's still in the
    system tray, or a window was closed without stopping the background
    process). In that case we must NOT try to bind the port again: uvicorn
    would crash with WinError 10048 ("only one usage of each socket address
    is normally permitted") and the app would appear to fail to start, even
    though a working instance is already running. We simply point a new
    window at the existing server instead of starting a second one — unless
    that existing server is running an older build (see _warn_stale_version
    below), which is the usual reason an update "doesn't seem to apply"."""
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=0.5) as r:
            return json.loads(r.read().decode("utf-8")).get("version")
    except Exception:
        return None


def _warn_stale_version(running_version: str | None) -> None:
    """Tell the person plainly why they might not be seeing today's fixes:
    an older build of this same app is still running in the background
    (most often left over from a window that was closed without the
    process actually exiting), and this newer .exe is just reusing that
    old server rather than silently showing stale behaviour with no
    explanation."""
    from app._version import BUILD_VERSION

    if not running_version or running_version == BUILD_VERSION:
        return
    message = (
        f"Une version plus ancienne de l'application tourne déjà en arrière-plan "
        f"({running_version}), et cette fenêtre va s'y connecter au lieu de "
        f"démarrer la version {BUILD_VERSION} que vous venez de lancer.\n\n"
        f"Pour utiliser la nouvelle version : fermez cette fenêtre, ouvrez le "
        f"Gestionnaire des tâches, terminez tout processus \"QualifComptage\", "
        f"puis relancez l'application."
    )
    logging.getLogger("desktop").warning(
        "Version déjà en cours (%s) différente de celle lancée (%s) — avertissement affiché",
        running_version, BUILD_VERSION,
    )
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, message, APP_TITLE, 0x30)  # MB_ICONWARNING
            return
        except Exception:
            pass
    _safe_print(message)


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

    url = f"http://127.0.0.1:{APP_PORT}"

    _safe_print(f"Qualification des données de comptage — données dans : {data_dir}")

    running_version = _already_serving_version(url)
    if running_version is not None:
        # Another instance (or a previous launch left running in the
        # background) is already serving the app on this port: reuse it
        # instead of starting a second server, which would crash trying to
        # bind the same address. If it's running an older build, say so —
        # this is the usual reason a just-shipped fix doesn't seem to apply.
        log.info("Un serveur local répond déjà sur %s (version %s) — réutilisation (pas de second serveur démarré)", url, running_version)
        _warn_stale_version(running_version)
        server_thread = None
    else:
        import uvicorn
        from app.main import app

        def _run_server() -> None:
            try:
                uvicorn.run(app, host="127.0.0.1", port=APP_PORT, log_level="warning")
            except OSError:
                # Most likely WinError 10048 / "address already in use":
                # another process grabbed the port between our check above
                # and this bind (e.g. a second instance launched at nearly
                # the same time). Nothing to do here — whichever process
                # won the bind is now serving the app, and the window below
                # will reach it on the same URL either way.
                log.warning("Port %s déjà occupé au moment du démarrage — un autre processus sert probablement déjà l'application.", APP_PORT)
            except Exception:
                log.exception("Le serveur local a planté")

        server_thread = threading.Thread(target=_run_server, daemon=True)
        server_thread.start()

        if not _wait_until_ready(url):
            log.error("Le serveur local n'a pas démarré à temps (30s)")
            _safe_print("Erreur : le serveur local n'a pas démarré à temps. Voir app.log.")

    try:
        import webview  # pywebview: a native OS window around the local URL

        log.info("Ouverture de la fenêtre native (pywebview)")
        window = webview.create_window(APP_TITLE, url, width=1440, height=900, min_size=(1000, 700))

        # On Windows, pywebview's EdgeChromium (WebView2) backend relies on
        # pythonnet/COM under the hood, and `webview.start()` returning when
        # the window is closed is not something we can always count on: a
        # stray non-daemon thread spun up by that native layer, or a COM
        # apartment that never tears down, can keep the interpreter alive
        # indefinitely with no window left on screen — which is exactly what
        # shows up as "the app won't close, I have to kill it from Task
        # Manager". Rather than rely on a clean return from `start()`, force
        # the whole process to end the moment the window actually closes.
        # os._exit (not sys.exit) skips Python's normal shutdown sequence
        # entirely — no atexit handlers, no waiting on any thread — which is
        # exactly what we want here: by this point the user has already
        # closed the window, there is nothing left worth finishing, and any
        # leftover background thread is precisely what we're trying to stop
        # waiting on.
        def _on_closed() -> None:
            log.info("Fenêtre fermée — arrêt forcé du processus")
            os._exit(0)

        window.events.closed += _on_closed

        webview.start()
        # Reached only if `start()` itself returns (e.g. on Linux/GTK, or if
        # pywebview's own loop exits cleanly) rather than the `closed` event
        # firing first — fall through to the same forced exit below instead
        # of leaving it to Python's normal interpreter shutdown.
    except Exception:
        log.exception("Fenêtre native indisponible, repli sur le navigateur par défaut")
        _safe_print("Fenêtre native indisponible, ouverture dans le navigateur par défaut.")
        import webbrowser

        webbrowser.open(url)
        # No native window to wait on in this fallback: keep the process
        # (and therefore the local server, if this process is the one
        # running it) alive until it's killed. If another instance is
        # already serving the app, there is no local server thread to
        # wait on, and this process can exit once the browser tab is open.
        if server_thread is not None:
            server_thread.join()

    log.info("=== Fermeture ===")
    # Belt and braces: whatever path got us here, make sure the process
    # actually ends instead of lingering in the background because of a
    # non-daemon thread we don't control (native-window toolkit internals,
    # a driver thread, ...). See the comment on _on_closed above.
    os._exit(0)


if __name__ == "__main__":
    main()
