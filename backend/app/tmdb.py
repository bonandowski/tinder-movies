"""Client asincrono per l'API TMDB (paese IT, lingua it-IT)."""

import asyncio
import logging
import math
import re
import time
import unicodedata
from collections.abc import Callable, Collection
from difflib import SequenceMatcher
from typing import Any

import httpx

from app.models import FilmRef, Genre, Movie, MovieFilters, Provider

log = logging.getLogger(__name__)

BASE_URL = "https://api.themoviedb.org/3"
IMAGE_BASE_URL = "https://image.tmdb.org/t/p"
REGION = "IT"
LANGUAGE = "it-IT"

DISCOVER_PAGE_SIZE = 20  # fisso lato TMDB
MAX_DISCOVER_PAGES = 25  # tetto alle pagine lette quando si scartano molti film (500 candidati)
MIN_VOTE_COUNT = 100  # scarta film con pochissimi voti (voti poco significativi)
MAX_CONCURRENCY = 10  # richieste TMDB in parallelo

CATALOG_TTL = 24 * 3600  # generi e provider cambiano di rado
DETAILS_TTL = 6 * 3600

MATCH_TTL = 30 * 24 * 3600  # "questo titolo + anno è quel film" non cambia
MATCH_CACHE_MAX = 50_000
MATCH_LANGUAGE = "en-US"  # Letterboxd scrive i titoli in inglese o nella lingua originale
MIN_TITLE_SIMILARITY = 0.85  # sotto questa somiglianza un risultato non è "lo stesso titolo"
RATE_LIMIT_ATTEMPTS = 3
RATE_LIMIT_DELAY = 1.0  # secondi, moltiplicati per il numero del tentativo


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

    def __len__(self) -> int:
        return len(self._data)

    def clear(self) -> None:
        self._data.clear()


def normalize_title(title: str) -> str:
    """Titolo confrontabile: minuscolo, senza accenti, spazi né punteggiatura."""
    folded = unicodedata.normalize("NFKD", title.casefold())
    letters = "".join(c for c in folded if not unicodedata.combining(c))
    return re.sub(r"[\W_]+", "", letters)


def _release_year(result: dict[str, Any]) -> int | None:
    date = result.get("release_date") or ""
    return int(date[:4]) if date[:4].isdigit() else None


def pick_match(film: FilmRef, results: list[dict[str, Any]]) -> int | None:
    """Fra i risultati di una ricerca TMDB, l'id del film che è quello di Letterboxd (o None).

    Serve lo stesso titolo (anche solo quasi, per gli accenti e simili) e un anno a ±1: Letterboxd e
    TMDB non sempre contano l'uscita allo stesso modo. A parità vince il titolo identico, poi l'anno
    identico, poi il risultato più in alto (TMDB li ordina per rilevanza e popolarità).
    """
    wanted = normalize_title(film.title)
    best_key: tuple[bool, bool, float, int] | None = None
    best_id: int | None = None
    for rank, result in enumerate(results):
        year = _release_year(result)
        if film.year is not None and (year is None or abs(year - film.year) > 1):
            continue
        names = [
            n
            for n in (
                normalize_title(result.get("title") or ""),
                normalize_title(result.get("original_title") or ""),
            )
            if n
        ]
        if not wanted or not names:
            continue
        exact = wanted in names
        similarity = 1.0 if exact else max(SequenceMatcher(None, wanted, n).ratio() for n in names)
        if similarity < MIN_TITLE_SIMILARITY:
            continue
        key = (exact, film.year is not None and year == film.year, similarity, -rank)
        if best_key is None or key > best_key:
            best_key, best_id = key, result["id"]
    return best_id


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
        self._match_cache = TTLCache(MATCH_TTL)

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

    async def movies(
        self, filters: MovieFilters, limit: int = 30, exclude: Collection[int] = ()
    ) -> list[Movie]:
        """Pila di film (ordinata per popolarità) che rispettano i filtri.

        `exclude` sono id da non proporre (es. già visti): si leggono più pagine di TMDB pur di
        riempire la pila. Può restituirne meno di `limit` se i filtri sono stretti o se mancano
        locandina/piattaforme.
        """
        movie_ids = await self._discover_ids(filters, limit, set(exclude))
        details = await asyncio.gather(*(self._safe_details(movie_id) for movie_id in movie_ids))
        movies = [m for d in details if d is not None and (m := self._to_movie(d)) is not None]
        return movies[:limit]

    async def _discover_ids(
        self, filters: MovieFilters, limit: int, exclude: set[int]
    ) -> list[int]:
        ids: list[int] = []
        taken: set[int] = set()

        def collect(page: dict[str, Any]) -> None:
            for item in page["results"]:
                movie_id = item["id"]
                if movie_id not in exclude and movie_id not in taken:
                    taken.add(movie_id)
                    ids.append(movie_id)

        first = await self._get("/discover/movie", build_discover_params(filters, page=1))
        collect(first)
        last_page = min(first.get("total_pages", 1), MAX_DISCOVER_PAGES)
        next_page = 2
        while len(ids) < limit and next_page <= last_page:
            # Tante pagine in parallelo quanti sono i film che ancora mancano, a occhio.
            missing_pages = math.ceil((limit - len(ids)) / DISCOVER_PAGE_SIZE)
            batch = range(next_page, min(next_page + missing_pages, last_page + 1))
            for page in await asyncio.gather(
                *(
                    self._get("/discover/movie", build_discover_params(filters, page=n))
                    for n in batch
                )
            ):
                collect(page)
            next_page = batch.stop
        return ids

    async def match_films(self, films: list[FilmRef]) -> list[int | None]:
        """L'id TMDB di ogni film (titolo + anno), o None se non lo riconosciamo. Stesso ordine."""
        return list(await asyncio.gather(*(self._match_one(film) for film in films)))

    async def _match_one(self, film: FilmRef) -> int | None:
        key = (normalize_title(film.title), film.year)
        if not key[0]:
            return None
        cached = self._match_cache.get(key)
        if cached is not None:
            return cached[0]  # in una tupla, così anche "non riconosciuto" (None) resta in cache
        params: dict[str, Any] = {
            "query": film.title,
            "include_adult": "false",
            "language": MATCH_LANGUAGE,
        }
        if film.year is not None:
            params["year"] = film.year
        data = await self._get_retrying("/search/movie", params)
        movie_id = pick_match(film, data.get("results", []))
        if len(self._match_cache) >= MATCH_CACHE_MAX:
            self._match_cache.clear()
        self._match_cache.set(key, (movie_id,))
        return movie_id

    async def _get_retrying(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        """Come `_get`, ma se TMDB dice "troppe richieste" aspetta un attimo e riprova."""
        for attempt in range(1, RATE_LIMIT_ATTEMPTS + 1):
            try:
                return await self._get(path, params)
            except TMDBError as exc:
                if exc.status_code != 429 or attempt == RATE_LIMIT_ATTEMPTS:
                    raise
                await asyncio.sleep(RATE_LIMIT_DELAY * attempt)
        raise AssertionError("irraggiungibile")

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
