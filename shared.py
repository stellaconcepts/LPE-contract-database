import json
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, field_validator

DATE_RE = re.compile(r"^\d{2}-\d{2}-\d{4}$")
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


class Signatory(BaseModel):
    name: str | None = None
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


def load_json_tolerant(path: str | Path, logger=None) -> Any:
    text = Path(path).read_text()
    cleaned = _TRAILING_COMMA.sub(r"\1", text)
    if cleaned != text and logger:
        logger.warning("Stripped trailing comma(s) from %s before parsing", path)
    return json.loads(cleaned)
