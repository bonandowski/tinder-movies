"""Client asincrono per l'API TMDB (paese IT, lingua it-IT)."""

import asyncio
import logging
import math
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.models import Genre, Movie, MovieFilters, Provider

log = logging.getLogger(__name__)

BASE_URL = "https://api.themoviedb.org/3"
IMAGE_BASE_URL = "https://image.tmdb.org/t/p"
REGION = "IT"
LANGUAGE = "it-IT"

DISCOVER_PAGE_SIZE = 20  # fisso lato TMDB
MIN_VOTE_COUNT = 100  # scarta film con pochissimi voti (voti poco significativi)
MAX_CONCURRENCY = 10  # richieste TMDB in parallelo

CATALOG_TTL = 24 * 3600  # generi e provider cambiano di rado
DETAILS_TTL = 6 * 3600


class TMDBError(Exception):
    """Errore nel dialogo con TMDB. Il messaggio è pensato per essere mostrato all'utente."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class TTLCache:
    """Cache in memoria con scadenza. Basta per l'MVP: un solo processo, nessun DB."""

    def __init__(self, ttl: float, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl
        self._clock = clock
        self._data: dict[Any, tuple[float, Any]] = {}

    def get(self, key: Any) -> Any | None:
        item = self._data.get(key)
        if item is None:
            return None
        expires_at, value = item
        if self._clock() >= expires_at:
            del self._data[key]
            return None
        return value

    def set(self, key: Any, value: Any) -> None:
        self._data[key] = (self._clock() + self._ttl, value)


def _poster_url(path: str | None) -> str | None:
    return f"{IMAGE_BASE_URL}/w500{path}" if path else None


def _logo_url(path: str | None) -> str | None:
    return f"{IMAGE_BASE_URL}/w92{path}" if path else None


def build_discover_params(filters: MovieFilters, page: int = 1) -> dict[str, Any]:
    """Traduce i nostri filtri nei parametri di /discover/movie."""
    params: dict[str, Any] = {
        "page": page,
        "sort_by": "popularity.desc",
        "include_adult": "false",
        "vote_count.gte": MIN_VOTE_COUNT,
        # Solo film in abbonamento (flatrate) in Italia.
        "watch_region": REGION,
        "with_watch_monetization_types": "flatrate",
    }
    if filters.platforms:
        params["with_watch_providers"] = "|".join(map(str, filters.platforms))  # "|" = OR
    if filters.genres:
        params["with_genres"] = "|".join(map(str, filters.genres))  # "|" = OR
    if filters.year_min is not None:
        params["primary_release_date.gte"] = f"{filters.year_min}-01-01"
    if filters.max_runtime is not None:
        params["with_runtime.lte"] = filters.max_runtime
    return params


class TMDBClient:
    def __init__(self, api_key: str, http: httpx.AsyncClient | None = None):
        self._api_key = api_key
        # L'"API Read Access Token" (v4) è un JWT e va in header; la "API Key" (v3) in query.
        self._use_bearer = api_key.startswith("eyJ")
        self._http = http or httpx.AsyncClient(base_url=BASE_URL, timeout=10.0)
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
        self._catalog_cache = TTLCache(CATALOG_TTL)
        self._details_cache = TTLCache(DETAILS_TTL)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        params = {"language": LANGUAGE, **(params or {})}
        headers: dict[str, str] = {}
        if self._use_bearer:
            headers["Authorization"] = f"Bearer {self._api_key}"
        else:
            params["api_key"] = self._api_key
        try:
            async with self._semaphore:
                response = await self._http.get(path, params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise TMDBError("TMDB non raggiungibile, riprova tra poco") from exc
        if response.status_code == 401:
            raise TMDBError("Chiave TMDB non valida: controlla TMDB_API_KEY", 401)
        if response.status_code == 429:
            raise TMDBError("Troppe richieste a TMDB, riprova tra poco", 429)
        if response.status_code >= 400:
            raise TMDBError(
                f"TMDB ha risposto con errore {response.status_code}", response.status_code
            )
        return response.json()

    async def genres(self) -> list[Genre]:
        cached = self._catalog_cache.get("genres")
        if cached is not None:
            return cached
        data = await self._get("/genre/movie/list")
        result = [Genre(id=g["id"], name=g["name"]) for g in data["genres"]]
        self._catalog_cache.set("genres", result)
        return result

    async def providers(self) -> list[Provider]:
        """Piattaforme disponibili in Italia, dalle più rilevanti alle meno."""
        cached = self._catalog_cache.get("providers")
        if cached is not None:
            return cached
        data = await self._get("/watch/providers/movie", {"watch_region": REGION})
        items = sorted(
            data["results"],
            key=lambda p: p.get("display_priorities", {}).get(
                REGION, p.get("display_priority", 999)
            ),
        )
        result = [
            Provider(
                id=p["provider_id"], name=p["provider_name"], logo_url=_logo_url(p.get("logo_path"))
            )
            for p in items
        ]
        self._catalog_cache.set("providers", result)
        return result

    async def movies(self, filters: MovieFilters, limit: int = 30) -> list[Movie]:
        """Pila di film (ordinata per popolarità) che rispettano i filtri.

        Può restituirne meno di `limit` se i filtri sono stretti o se mancano locandina/piattaforme.
        """
        movie_ids = await self._discover_ids(filters, limit)
        details = await asyncio.gather(*(self._safe_details(movie_id) for movie_id in movie_ids))
        movies = [m for d in details if d is not None and (m := self._to_movie(d)) is not None]
        return movies[:limit]

    async def _discover_ids(self, filters: MovieFilters, limit: int) -> list[int]:
        pages_needed = math.ceil(limit / DISCOVER_PAGE_SIZE)
        first = await self._get("/discover/movie", build_discover_params(filters, page=1))
        pages = [first]
        last_page = min(pages_needed, first.get("total_pages", 1))
        if last_page > 1:
            pages += await asyncio.gather(
                *(
                    self._get("/discover/movie", build_discover_params(filters, page=n))
                    for n in range(2, last_page + 1)
                )
            )
        ids: list[int] = []
        for page in pages:
            for item in page["results"]:
                if item["id"] not in ids:
                    ids.append(item["id"])
        return ids

    async def _safe_details(self, movie_id: int) -> dict[str, Any] | None:
        """Dettagli di un film; se TMDB fallisce solo per questo film lo saltiamo."""
        try:
            return await self._details(movie_id)
        except TMDBError as exc:
            log.warning("Dettagli film %s non disponibili: %s", movie_id, exc)
            return None

    async def _details(self, movie_id: int) -> dict[str, Any]:
        cached = self._details_cache.get(movie_id)
        if cached is not None:
            return cached
        # La durata non è nel discover: serve il dettaglio (e ci mettiamo anche le piattaforme).
        data = await self._get(f"/movie/{movie_id}", {"append_to_response": "watch/providers"})
        self._details_cache.set(movie_id, data)
        return data

    @staticmethod
    def _to_movie(data: dict[str, Any]) -> Movie | None:
        """None se il film non è presentabile: senza locandina o senza piattaforme in Italia."""
        poster_url = _poster_url(data.get("poster_path"))
        flatrate = (
            data.get("watch/providers", {}).get("results", {}).get(REGION, {}).get("flatrate", [])
        )
        if poster_url is None or not flatrate:
            return None
        release_date = data.get("release_date") or ""
        return Movie(
            id=data["id"],
            title=data["title"],
            poster_url=poster_url,
            overview=data.get("overview") or "",
            runtime=data.get("runtime") or None,
            rating=round(data.get("vote_average") or 0, 1),
            year=int(release_date[:4]) if release_date[:4].isdigit() else None,
            providers=[
                Provider(
                    id=p["provider_id"],
                    name=p["provider_name"],
                    logo_url=_logo_url(p.get("logo_path")),
                )
                for p in sorted(flatrate, key=lambda p: p.get("display_priority", 999))
            ],
        )
