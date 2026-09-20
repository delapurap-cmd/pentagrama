"""Same-origin Pentagrama editor and offline Audiveris recognition API.

Long PDF recognition must NEVER hold a WKWebView fetch open for minutes.
The native app submits a job and polls its state over short HTTP requests.
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from server.omr import MAX_PDF_BYTES, OMRFailure, check_pdf, convert_pdf, executable

ROOT = Path(os.environ.get("PENTAGRAMA_WEB_ROOT") or Path(__file__).resolve().parents[1]).resolve()
app = FastAPI(title="Pentagrama OMR", docs_url=None, redoc_url=None, openapi_url=None)
LOG = logging.getLogger("pentagrama.api")
_lock = asyncio.Semaphore(1)
_jobs: dict[str, dict] = {}
_tasks: set[asyncio.Task] = set()
JOB_TTL = 600
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
    return {"available": executable() is not None, "max_file_bytes": MAX_PDF_BYTES, "background_jobs": True}


async def read_pdf(pdf: UploadFile) -> bytes:
    # A PDF is identified by its bytes, not an arbitrary display filename.
    try:
        data = await pdf.read(MAX_PDF_BYTES + 1)
    finally:
        await pdf.close()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="El PDF supera el límite de 12 MB.")
    try:
        check_pdf(data)
    except OMRFailure as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if not executable():
        raise HTTPException(status_code=503, detail="No está disponible Audiveris. Reinstala Pentagrama completo.")
    return data


def xml_response(result: bytes, extension: str) -> Response:
    kind = "application/vnd.recordare.musicxml" if extension == ".mxl" else "application/vnd.recordare.musicxml+xml"
    return Response(result, media_type=kind, headers={
        "Content-Disposition": f'attachment; filename="partitura{extension}"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    })


@app.post("/api/omr")
async def recognize(pdf: UploadFile = File(...)):
    """Legacy synchronous API for non-WebKit clients; desktop uses /jobs."""
    data = await read_pdf(pdf)
    try:
        async with _lock:
            result, extension = await run_in_threadpool(convert_pdf, data)
    except OMRFailure as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return xml_response(result, extension)


def cleanup_jobs():
    now = time.monotonic()
    for identifier, job in list(_jobs.items()):
        if job["state"] in ("done", "error") and now - job["finished"] > JOB_TTL:
            del _jobs[identifier]


async def process_job(identifier: str, data: bytes):
    job = _jobs[identifier]
    try:
        job["state"] = "queued"
        async with _lock:
            job["state"] = "running"
            job["stage"] = "Reconociendo notas y ritmo con Audiveris"
            result, extension = await run_in_threadpool(convert_pdf, data)
            job["stage"] = "Comprobando MusicXML"
            job["result"] = result
            job["extension"] = extension
            job["state"] = "done"
            job["stage"] = "Partitura preparada"
    except OMRFailure as exc:
        job["state"] = "error"
        job["error"] = str(exc)
        LOG.warning("Audiveris job failed: %s", exc)
    except Exception:
        job["state"] = "error"
        job["error"] = "Falló el motor local. Consulta ~/Library/Logs/Pentagrama/pentagrama.log."
        LOG.exception("Unexpected PDF conversion error")
    finally:
        job["finished"] = time.monotonic()


def lookup(identifier: str) -> dict:
    cleanup_jobs()
    job = _jobs.get(identifier)
    if not job:
        raise HTTPException(status_code=404, detail="No existe este proceso de reconocimiento.")
    return job


@app.post("/api/omr/jobs", status_code=202)
async def start_job(pdf: UploadFile = File(...)):
    cleanup_jobs()
    active = sum(job["state"] in ("queued", "running") for job in _jobs.values())
    if active >= 2:
        raise HTTPException(status_code=429, detail="Ya hay dos partituras procesándose. Espera un momento.")
    data = await read_pdf(pdf)
    identifier = secrets.token_urlsafe(20)
    _jobs[identifier] = {
        "state": "queued", "stage": "Esperando turno de reconocimiento", "created": time.monotonic(),
        "finished": None, "result": None, "extension": None, "error": None,
    }
    task = asyncio.create_task(process_job(identifier, data))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"job_id": identifier, "status": "queued"}


@app.get("/api/omr/jobs/{identifier}")
async def job_status(identifier: str):
    job = lookup(identifier)
    return {"status": job["state"], "stage": job["stage"],
            "elapsed_seconds": int(time.monotonic() - job["created"]), "error": job["error"]}


@app.get("/api/omr/jobs/{identifier}/result")
async def job_result(identifier: str):
    job = lookup(identifier)
    if job["state"] == "error":
        raise HTTPException(status_code=422, detail=job["error"])
    if job["state"] != "done":
        raise HTTPException(status_code=409, detail="La partitura todavía se está reconociendo.")
    return xml_response(job["result"], job["extension"])


app.mount("/", StaticFiles(directory=ROOT, html=True), name="pentagrama")
