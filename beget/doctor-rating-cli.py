#!/usr/bin/env python3
"""CLI bridge between the Beget Node server and the existing rating search."""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from doctor_rating import lookup_doctor_rating  # noqa: E402


def main() -> None:
    payload = json.load(sys.stdin)
    photo_local = None
    encoded = payload.get("photoLocalBase64")
    if isinstance(encoded, str) and encoded:
        photo_local = base64.b64decode(encoded, validate=True)
    result = lookup_doctor_rating(
        str(payload.get("name") or ""),
        photo=str(payload.get("photo") or "") or None,
        photo_local=photo_local,
    )
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
