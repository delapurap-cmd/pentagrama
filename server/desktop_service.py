"""Private loopback service owned by the Pentagrama macOS application.

The native WKWebView app starts/stops this process. No browser or terminal is
opened. A stable loopback origin preserves the editor's localStorage.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8787


def main() -> int:
    public = (Path(sys._MEIPASS) / "web" if getattr(sys, "frozen", False)
              else Path(__file__).resolve().parents[1])
    if not (public / "index.html").is_file():
        print("Pentagrama: faltan los archivos del editor.", file=sys.stderr, flush=True)
        return 2
    os.environ["PENTAGRAMA_WEB_ROOT"] = str(public)
    binary = os.environ.get("AUDIVERIS_BIN")
    if not binary or not Path(binary).is_file():
        print("Pentagrama: no se encuentra el motor Audiveris integrado.", file=sys.stderr, flush=True)
        return 3

    import uvicorn
    from server.app import app

    config = uvicorn.Config(app, host=HOST, port=PORT,
                            log_level="warning", access_log=False)
    uvicorn.Server(config).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
