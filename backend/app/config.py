import os
from pathlib import Path

from dotenv import load_dotenv

# `.env` nella root del repo. Le variabili già nell'ambiente (es. su Render) hanno la precedenza.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def get_tmdb_api_key() -> str | None:
    return os.getenv("TMDB_API_KEY") or None


def get_letterboxd_base_url() -> str:
    """Di solito letterboxd.com; si cambia solo per provare l'app con un feed finto in locale."""
    return os.getenv("LETTERBOXD_BASE_URL") or "https://letterboxd.com"
