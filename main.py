import argparse
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import extraction
from shared import ContractEdit, load_json_tolerant

logger = logging.getLogger("uvicorn.error")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--json", dest="json_path", default=None)
parser.add_argument("--pdf-dir", dest="pdf_dir", default=None)
parser.add_argument("--edits-json", dest="edits_path", default=None)
_args, _ = parser.parse_known_args()

JSON_PATH = _args.json_path or os.environ.get("CONTRACTS_JSON", "sample_contracts.json")
PDF_DIR = _args.pdf_dir or os.environ.get("PDF_DIR", "./All_Parts_ocr")
EDITS_PATH = _args.edits_path or os.environ.get("EDITS_JSON", "edits.json")
UPLOADED_JSON = os.environ.get("UPLOADED_JSON", "uploaded_contracts.json")
UPLOADED_DIR = os.environ.get("UPLOADED_DIR", "uploaded_contracts")

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_contracts(path: str) -> list[dict]:
    return load_json_tolerant(path, logger)


CONTRACTS = load_contracts(JSON_PATH)

# ---------------------------------------------------------------------------
# Uploaded contracts (appended at runtime via /api/uploads, never touches JSON_PATH)
# ---------------------------------------------------------------------------


def load_uploaded_contracts(path: str) -> list[dict]:
    if not Path(path).exists():
        return []
    return load_json_tolerant(path, logger)


UPLOADED_CONTRACTS: list[dict] = load_uploaded_contracts(UPLOADED_JSON)
_uploads_lock = threading.Lock()


def save_uploaded_contracts() -> None:
    path = Path(UPLOADED_JSON)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(UPLOADED_CONTRACTS, indent=2))
    tmp.replace(path)


def all_contracts() -> list[dict]:
    return CONTRACTS + UPLOADED_CONTRACTS


# ---------------------------------------------------------------------------
# Edits overlay (never touches JSON_PATH)
# ---------------------------------------------------------------------------


def load_overlay() -> dict:
    path = Path(EDITS_PATH)
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_overlay(overlay: dict) -> None:
    path = Path(EDITS_PATH)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(overlay, indent=2))
    tmp.replace(path)


def merge_contract(source: dict, overlay: dict) -> dict:
    entry = overlay.get(source["filename"])
    if entry:
        return {**entry["data"], "has_edit": True, "last_edited_at": entry["lastEditedAt"]}
    return {**source, "has_edit": False, "last_edited_at": None}


def build_pdf_index(pdf_dir: str) -> dict[str, Path]:
    index: dict[str, Path] = {}
    for root, dirnames, filenames in os.walk(pdf_dir):
        dirnames.sort()
        for name in sorted(filenames):
            if not name.lower().endswith(".pdf"):
                continue
            path = Path(root) / name
            if name in index:
                logger.warning("Ambiguous PDF basename %r: keeping %s, ignoring %s", name, index[name], path)
                continue
            index[name] = path
    return index


PDF_INDEX = build_pdf_index(PDF_DIR)
PDF_INDEX_CI = {name.lower(): path for name, path in PDF_INDEX.items()}
logger.info("Indexed %d PDFs under %s", len(PDF_INDEX), PDF_DIR)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "HEAD", "PUT", "POST", "DELETE"],
    allow_headers=["*"],
)


def resolve_pdf(file: str) -> Path | None:
    for candidate in (file, f"{file}.pdf"):
        if candidate in PDF_INDEX:
            return PDF_INDEX[candidate]
    for candidate in (file.lower(), f"{file}.pdf".lower()):
        if candidate in PDF_INDEX_CI:
            return PDF_INDEX_CI[candidate]
    return None


def filename_taken(filename: str) -> bool:
    # Note: PDF_DIR (All_Parts_ocr) is a large general document archive, not a registry
    # of contracts in the app — a name collision there doesn't mean this contract exists.
    if (Path(UPLOADED_DIR) / filename).exists():
        return True
    return any(c["filename"] == filename for c in all_contracts())


def list_upload_files() -> list[str]:
    upload_dir = Path(UPLOADED_DIR)
    if not upload_dir.exists():
        return []
    return sorted(p.name for p in upload_dir.iterdir() if p.is_file() and p.suffix.lower() == ".pdf")


def delete_upload(filename: str) -> None:
    """Remove an uploaded PDF and any trace of it (contract entry, edit, PDF index)."""
    with _uploads_lock:
        before = len(UPLOADED_CONTRACTS)
        UPLOADED_CONTRACTS[:] = [c for c in UPLOADED_CONTRACTS if c["filename"] != filename]
        if len(UPLOADED_CONTRACTS) != before:
            save_uploaded_contracts()

        path = Path(UPLOADED_DIR) / filename
        if path.exists():
            path.unlink()
        if PDF_INDEX.get(filename) == path:
            del PDF_INDEX[filename]
        PDF_INDEX_CI.pop(filename.lower(), None)

    with _jobs_lock:
        JOB_ID_BY_FILENAME.pop(filename, None)

    overlay = load_overlay()
    if filename in overlay:
        del overlay[filename]
        save_overlay(overlay)


# ---------------------------------------------------------------------------
# Upload jobs (in-memory; a server restart loses in-flight jobs)
# ---------------------------------------------------------------------------

JOBS: dict[str, dict] = {}
JOB_ID_BY_FILENAME: dict[str, str] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **updates) -> None:
    with _jobs_lock:
        JOBS[job_id].update(updates)


def run_extraction_job(job_id: str, path: Path, filename: str) -> None:
    try:
        text = extraction.ocr_pdf(path)

        if len(text.strip()) < extraction.MIN_EXTRACTED_CHARS:
            raise ValueError(
                "Could not extract enough readable text from this PDF "
                "(it may be blank, encrypted, or a poor-quality scan)"
            )

        _set_job(job_id, step="extracting")
        data = extraction.extract_contract(text)
        validated = ContractEdit(filename=filename, **data)
        contract = validated.model_dump()

        with _uploads_lock:
            if not path.exists():
                # The upload was deleted (or replaced) while this job was still running.
                logger.info("Discarding extraction result for %s: upload no longer exists", filename)
                _set_job(job_id, status="error", error="Upload was deleted before extraction finished")
                return
            # ponytail: last-writer-wins de-dup — guards against a stale job finishing
            # after a delete+retry raced it; a per-filename lock would close this properly
            # but duplicate concurrent uploads of the same filename are rare in a single-user tool.
            UPLOADED_CONTRACTS[:] = [c for c in UPLOADED_CONTRACTS if c["filename"] != filename]
            UPLOADED_CONTRACTS.append(contract)
            save_uploaded_contracts()
            PDF_INDEX[filename] = path
            PDF_INDEX_CI[filename.lower()] = path

        _set_job(
            job_id,
            status="done",
            step="done",
            contract=merge_contract(contract, load_overlay()),
        )
    except Exception as exc:
        logger.exception("Extraction failed for %s", filename)
        _set_job(job_id, status="error", error=str(exc))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/contracts")
def list_contracts():
    overlay = load_overlay()
    return [merge_contract(c, overlay) for c in all_contracts()]


@app.get("/api/contract")
def get_contract(file: str = Query(...)):
    for c in all_contracts():
        if c["filename"] == file:
            return merge_contract(c, load_overlay())
    raise HTTPException(status_code=404, detail="Contract not found")


@app.put("/api/contract")
def put_contract(file: str = Query(...), body: ContractEdit = Body(...)):
    if body.filename != file:
        raise HTTPException(status_code=400, detail="filename mismatch between query and body")
    if not any(c["filename"] == file for c in all_contracts()):
        raise HTTPException(status_code=404, detail="Contract not found")

    overlay = load_overlay()
    overlay[file] = {
        "data": body.model_dump(),
        "lastEditedAt": datetime.now(timezone.utc).isoformat(),
    }
    save_overlay(overlay)

    source = next(c for c in all_contracts() if c["filename"] == file)
    return merge_contract(source, overlay)


@app.get("/api/contract/pdf")
def get_contract_pdf(file: str = Query(...)):
    path = resolve_pdf(file)
    if path is None:
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(path, media_type="application/pdf")


@app.post("/api/uploads")
async def create_upload(file: UploadFile = File(...)):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    if filename_taken(filename):
        raise HTTPException(status_code=409, detail=f"A contract named {filename!r} already exists")

    upload_dir = Path(UPLOADED_DIR)
    upload_dir.mkdir(exist_ok=True)
    dest = upload_dir / filename
    dest.write_bytes(await file.read())

    job_id = uuid.uuid4().hex
    with _jobs_lock:
        JOBS[job_id] = {
            "status": "running",
            "step": "ocr",
            "error": None,
            "contract": None,
        }
        JOB_ID_BY_FILENAME[filename] = job_id

    threading.Thread(target=run_extraction_job, args=(job_id, dest, filename), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/uploads/{job_id}")
def get_upload(job_id: str):
    with _jobs_lock:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return dict(job)


@app.get("/api/uploads")
def list_uploads():
    contract_filenames = {c["filename"] for c in UPLOADED_CONTRACTS}
    with _jobs_lock:
        job_id_by_filename = dict(JOB_ID_BY_FILENAME)
        jobs_snapshot = dict(JOBS)

    result = []
    for name in list_upload_files():
        if name in contract_filenames:
            status = "uploaded"
        else:
            job = jobs_snapshot.get(job_id_by_filename.get(name, ""))
            status = "processing" if job and job["status"] == "running" else "failed"
        result.append({"filename": name, "status": status})
    return result


@app.delete("/api/uploads/{filename}")
def remove_upload(filename: str):
    filename = Path(filename).name
    if filename not in list_upload_files():
        raise HTTPException(status_code=404, detail="Upload not found")
    delete_upload(filename)
    return {"deleted": filename}


# ---------------------------------------------------------------------------
# Dev entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
