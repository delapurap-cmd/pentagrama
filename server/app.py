"""Serve Pentagrama and its optional local Audiveris recognition endpoint.

Run at the repository root: uvicorn server.app:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from server.omr import MAX_PDF_BYTES, OMRFailure, convert_pdf, executable

ROOT = Path(__file__).resolve().parents[1]
app = FastAPI(title="Pentagrama OMR", docs_url=None, redoc_url=None, openapi_url=None)
_lock = asyncio.Semaphore(1)  # OMR is CPU/memory-intensive.


@app.get("/api/omr/health")
def health():
    return {"available": executable() is not None, "max_file_bytes": MAX_PDF_BYTES}


@app.post("/api/omr")
async def recognize(pdf: UploadFile = File(...)):
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Selecciona un archivo .pdf.")
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


# The API is registered before the static mount; / and /index.html are identical.
app.mount("/", StaticFiles(directory=ROOT, html=True), name="pentagrama")
