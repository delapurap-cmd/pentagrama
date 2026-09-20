"""Start the complete Pentagrama editor + Audiveris locally, without cloud uploads.

This is the entry point for the macOS Intel PyInstaller package. The bundle
contains the static editor, a Python API and Audiveris.app side by side.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path


def packaged_paths() -> tuple[Path, Path]:
    if getattr(sys, "frozen", False):
        # PyInstaller --onedir layout:
        # Pentagrama-Local/{PentagramaServer/{PentagramaServer,_internal/web},Audiveris.app}
        program = Path(sys.executable).resolve()
        public = Path(sys._MEIPASS) / "web"
        binary = program.parent.parent / "Audiveris.app" / "Contents" / "MacOS" / "Audiveris"
    else:
        public = Path(__file__).resolve().parents[1]
        binary = Path(os.environ.get("AUDIVERIS_BIN", "audiveris"))
    return public, binary


def find_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> int:
    public, binary = packaged_paths()
    if not (public / "index.html").is_file():
        print("Error: no se encuentra el editor Pentagrama en el paquete.", file=sys.stderr)
        return 2
    if getattr(sys, "frozen", False) and not binary.is_file():
        print("Error: no se encuentra Audiveris.app dentro del paquete.", file=sys.stderr)
        return 3
    os.environ["PENTAGRAMA_WEB_ROOT"] = str(public)
    if getattr(sys, "frozen", False):
        os.environ["AUDIVERIS_BIN"] = str(binary)

    # Import after setting the public root: server.app mounts static assets at import time.
    import uvicorn
    from server.app import app

    port = find_port()
    url = f"http://127.0.0.1:{port}/index.html"
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)

    def open_browser() -> None:
        for _ in range(200):
            if server.started:
                print(f"Pentagrama disponible en {url}", flush=True)
                webbrowser.open(url)
                return
            if server.should_exit:
                return
            time.sleep(0.05)

    threading.Thread(target=open_browser, name="open-editor", daemon=True).start()
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
