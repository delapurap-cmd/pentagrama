"""Start the complete Pentagrama editor + Audiveris locally, without cloud uploads.

The fixed loopback address is essential: browser localStorage is origin-scoped,
so a random port on each launch would hide all previously saved scores.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

LOCAL_PORT = 8787


def packaged_paths() -> tuple[Path, Path]:
    if getattr(sys, "frozen", False):
        program = Path(sys.executable).resolve()
        public = Path(sys._MEIPASS) / "web"
        binary = program.parent.parent / "Audiveris.app" / "Contents" / "MacOS" / "Audiveris"
    else:
        public = Path(__file__).resolve().parents[1]
        binary = Path(os.environ.get("AUDIVERIS_BIN", "audiveris"))
    return public, binary


def check_port_available() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", LOCAL_PORT))
        except OSError:
            return False
        return True


def main() -> int:
    public, binary = packaged_paths()
    if not (public / "index.html").is_file():
        print("Error: no se encuentra el editor Pentagrama en el paquete.", file=sys.stderr)
        return 2
    if getattr(sys, "frozen", False) and not binary.is_file():
        print("Error: no se encuentra Audiveris.app dentro del paquete.", file=sys.stderr)
        return 3
    if not check_port_available():
        print("El puerto local 8787 está ocupado. Cierra la otra instancia de Pentagrama y vuelve a abrirlo.", file=sys.stderr)
        return 4
    os.environ["PENTAGRAMA_WEB_ROOT"] = str(public)
    if getattr(sys, "frozen", False):
        os.environ["AUDIVERIS_BIN"] = str(binary)

    import uvicorn
    from server.app import app

    url = f"http://127.0.0.1:{LOCAL_PORT}/index.html"
    config = uvicorn.Config(app, host="127.0.0.1", port=LOCAL_PORT, log_level="warning", access_log=False)
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
