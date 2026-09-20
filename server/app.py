"""Serve Pentagrama and its same-origin Audiveris PDF recognition API.

Development: uvicorn server.app:app --host 127.0.0.1 --port 8000
Bundled desktop app: PENTAGRAMA_WEB_ROOT points to packaged public assets.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from server.omr import MAX_PDF_BYTES, OMRFailure, convert_pdf, executable

ROOT = Path(os.environ.get("PENTAGRAMA_WEB_ROOT") or Path(__file__).resolve().parents[1]).resolve()
app = FastAPI(title="Pentagrama OMR", docs_url=None, redoc_url=None, openapi_url=None)
_lock = asyncio.Semaphore(1)
PUBLIC_ROOT = {"index.html", "studio.html", "sync.html", "style.css", "manifest.json",
               "icon-192.png", "icon-512.png", "icon-maskable.png", "sw.js", "service-worker.js"}
PUBLIC_FOLDERS = {"js", "vendor", "ejemplos", "sonidos", "assets", "fonts"}
PUBLIC_EXT = {".html", ".css", ".js", ".json", ".mxl", ".xml", ".mid", ".midi",
              ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".mp3", ".wav", ".ogg", ".opus"}


@app.middleware("http")
async def protect_private_files(request: Request, call_next):
    path = unquote(request.url.path)
    if path.startswith('/api/'):
        return await call_next(request)
    segments = PurePosixPath(path).parts
    if path == '/':
        return await call_next(request)
    if (not segments or any(part.startswith('.') or part in ('..',) for part in segments)
            or '\\' in path):
        return Response(status_code=404)
    first = segments[1] if segments[0] == '/' else segments[0]
    allowed = ((len(segments) == 2 and first in PUBLIC_ROOT)
               or (first in PUBLIC_FOLDERS and Path(path).suffix.lower() in PUBLIC_EXT))
    if not allowed:
        return Response(status_code=404)
    return await call_next(request)


@app.get("/api/omr/health")
def health():
    return {"available": executable() is not None, "max_file_bytes": MAX_PDF_BYTES}


@app.post("/api/omr")
async def recognize(pdf: UploadFile = File(...)):
    # Some genuine sheet-music PDFs arrive without a .pdf filename suffix.
    # The worker validates the actual PDF signature, structure and limits.
    try:
        data = await pdf.read(MAX_PDF_BYTES + 1)
    finally:
        await pdf.close()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="El PDF supera el límite de 12 MB.")
    if not executable():
        raise HTTPException(status_code=503, detail="No está instalado Audiveris en este servidor.")
    try:
        async with _lock:
            result, extension = await run_in_threadpool(convert_pdf, data)
    except OMRFailure as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    kind = "application/vnd.recordare.musicxml" if extension == ".mxl" else "application/vnd.recordare.musicxml+xml"
    return Response(result, media_type=kind, headers={
        "Content-Disposition": f'attachment; filename="partitura{extension}"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    })


app.mount("/", StaticFiles(directory=ROOT, html=True), name="pentagrama")
