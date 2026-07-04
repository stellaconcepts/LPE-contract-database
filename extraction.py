import io
import json
import logging
import os
from functools import lru_cache
from pathlib import Path

import fitz  # PyMuPDF
import pytesseract
from anthropic import Anthropic
from PIL import Image

from shared import ContractEdit, load_json_tolerant

logger = logging.getLogger("uvicorn.error")

SAMPLE_CONTRACTS_JSON = os.environ.get("SAMPLE_CONTRACTS_JSON", "sample_contracts.json")
SAMPLE_CONTRACTS_DIR = os.environ.get("SAMPLE_CONTRACTS_DIR", "sample_contracts")

OCR_MIN_CHARS_PER_PAGE = 50  # ponytail: heuristic — tune if false positives occur
MIN_EXTRACTED_CHARS = 100  # below this, treat as unreadable rather than letting Claude guess

_client = None


def _get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic()
    return _client


def extract_pdf_text(path: Path) -> tuple[str, int]:
    with fitz.open(path) as doc:
        text = "\n".join(page.get_text() for page in doc)
        return text, doc.page_count


def needs_ocr(text: str, page_count: int) -> bool:
    if page_count == 0:
        return True
    return len(text.strip()) / page_count < OCR_MIN_CHARS_PER_PAGE


def ocr_pdf(path: Path) -> str:
    texts = []
    with fitz.open(path) as doc:
        for page in doc:
            pix = page.get_pixmap(dpi=300)
            image = Image.open(io.BytesIO(pix.tobytes("png")))
            texts.append(pytesseract.image_to_string(image))
    return "\n".join(texts)


@lru_cache(maxsize=1)
def build_fewshot_examples() -> tuple[dict, ...]:
    """Golden-record (text -> JSON) pairs, used as prior conversation turns. Computed once."""
    golden = load_json_tolerant(SAMPLE_CONTRACTS_JSON, logger)
    sample_dir = Path(SAMPLE_CONTRACTS_DIR)
    turns: list[dict] = []
    for entry in golden:
        pdf_path = sample_dir / entry["filename"]
        if not pdf_path.exists():
            pdf_path = sample_dir / f"{entry['filename']}.pdf"
        if not pdf_path.exists():
            logger.warning("Few-shot PDF not found for %s, skipping", entry["filename"])
            continue
        text, page_count = extract_pdf_text(pdf_path)
        if needs_ocr(text, page_count):
            text = ocr_pdf(pdf_path)
        if not text.strip():
            logger.warning("No extractable text for few-shot example %s, skipping", entry["filename"])
            continue

        answer = {k: v for k, v in entry.items() if k != "filename"}
        turns.append({"role": "user", "content": text})
        turns.append({"role": "assistant", "content": json.dumps(answer)})
    return tuple(turns)


EXTRACTION_SYSTEM_PROMPT = """You extract structured data from utility/services contracts.

Respond with ONLY a single raw JSON object - no markdown code fences, no commentary before or after.

The JSON must have exactly these top-level keys:
- is_pricing_contract: boolean
- contract_start_date: string "DD-MM-YYYY" or null
- contract_end_date: string "DD-MM-YYYY" or null
- location: string (site address)
- signatories: array of {"name": string, "position": string or null} - there may be more than one
- pricing: array of blocks. Each block is an object mapping a category name (taken from the \
document, e.g. "Energy Charges" or "Hot Water") to an array of line-item objects. The category \
names and the line-item keys MUST come from the document itself - do not invent a fixed schema, \
and do not reuse category/key names from the examples unless this document actually uses them.

If a field is genuinely absent from the document, use null (or an empty array for pricing/signatories \
if truly none are present) rather than guessing.
"""


def extract_contract(text: str) -> dict:
    """Send contract text to Claude and return the parsed (not yet validated) JSON dict."""
    messages = [*build_fewshot_examples(), {"role": "user", "content": text}]
    with _get_client().messages.stream(
        model="claude-opus-4-8",
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        system=EXTRACTION_SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        response = stream.get_final_message()

    raw = next(b.text for b in response.content if b.type == "text").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)


def run(path: Path, filename: str) -> dict:
    """Full pipeline: text extraction -> OCR if needed -> Claude -> validation."""
    text, page_count = extract_pdf_text(path)
    ocr_used = needs_ocr(text, page_count)
    if ocr_used:
        text = ocr_pdf(path)

    if len(text.strip()) < MIN_EXTRACTED_CHARS:
        raise ValueError("Extracted text is too short to reliably extract a contract from")

    data = extract_contract(text)
    validated = ContractEdit(filename=filename, **data)
    return {"contract": validated.model_dump(), "ocr_used": ocr_used}


if __name__ == "__main__":
    import sys

    pdf_path = Path(sys.argv[1])
    result = run(pdf_path, pdf_path.name)
    print(json.dumps(result, indent=2))
