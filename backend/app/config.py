import os
from pathlib import Path

from dotenv import load_dotenv

# `.env` nella root del repo. Le variabili già nell'ambiente (es. su Render) hanno la precedenza.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def get_tmdb_api_key() -> str | None:
    return os.getenv("TMDB_API_KEY") or None
