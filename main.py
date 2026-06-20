import argparse
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator

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

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


def load_contracts(path: str) -> list[dict]:
    text = Path(path).read_text()
    cleaned = _TRAILING_COMMA.sub(r"\1", text)
    if cleaned != text:
        logger.warning("Stripped trailing comma(s) from %s before parsing", path)
    return json.loads(cleaned)


CONTRACTS = load_contracts(JSON_PATH)

# ---------------------------------------------------------------------------
# Edits overlay (never touches JSON_PATH)
# ---------------------------------------------------------------------------

DATE_RE = re.compile(r"^\d{2}-\d{2}-\d{4}$")


class Signatory(BaseModel):
    name: str
    position: str | None = None


class ContractEdit(BaseModel):
    filename: str
    is_pricing_contract: bool
    contract_start_date: str | None = None
    contract_end_date: str | None = None
    location: str
    signatories: list[Signatory]
    pricing: list[dict[str, list[dict[str, Any]]]]

    @field_validator("contract_start_date", "contract_end_date")
    @classmethod
    def _check_date(cls, v):
        if v is not None and not DATE_RE.match(v):
            raise ValueError("date must be DD-MM-YYYY or null")
        return v


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
    allow_methods=["GET", "HEAD", "PUT"],
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/contracts")
def list_contracts():
    overlay = load_overlay()
    return [merge_contract(c, overlay) for c in CONTRACTS]


@app.get("/api/contract")
def get_contract(file: str = Query(...)):
    for c in CONTRACTS:
        if c["filename"] == file:
            return merge_contract(c, load_overlay())
    raise HTTPException(status_code=404, detail="Contract not found")


@app.put("/api/contract")
def put_contract(file: str = Query(...), body: ContractEdit = Body(...)):
    if body.filename != file:
        raise HTTPException(status_code=400, detail="filename mismatch between query and body")
    if not any(c["filename"] == file for c in CONTRACTS):
        raise HTTPException(status_code=404, detail="Contract not found")

    overlay = load_overlay()
    overlay[file] = {
        "data": body.model_dump(),
        "lastEditedAt": datetime.now(timezone.utc).isoformat(),
    }
    save_overlay(overlay)

    source = next(c for c in CONTRACTS if c["filename"] == file)
    return merge_contract(source, overlay)


@app.get("/api/contract/pdf")
def get_contract_pdf(file: str = Query(...)):
    path = resolve_pdf(file)
    if path is None:
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(path, media_type="application/pdf")


# ---------------------------------------------------------------------------
# Dev entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
