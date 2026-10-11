"""Lettura della RSS pubblica di un membro di Letterboxd (`letterboxd.com/<utente>/rss/`).

È l'unico canale leggibile da programma senza l'API ufficiale (che va chiesta a Letterboxd). Limiti:
contiene solo le ~50 voci più recenti del diario, in ordine di visione e senza paginazione; i film
votati senza passare dal diario non ci sono. Per avere tutto si parte dall'export e si accumula.
"""

import re
import xml.etree.ElementTree as ET

import httpx
from pydantic import BaseModel

from app.tmdb import TTLCache

BASE_URL = "https://letterboxd.com"
USER_AGENT = "TinderMovies/0.1 (+https://github.com/bonandowski/tinder-movies)"
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{1,40}$")
FEED_DIARY_LIMIT = 50  # voci di diario che la RSS mostra al massimo
FEED_TTL = 10 * 60  # stesso utente entro 10 minuti: niente nuova richiesta a Letterboxd
MAX_FEED_BYTES = 2 * 1024 * 1024


class LetterboxdError(Exception):
    """Errore nel leggere la RSS. Il messaggio è pensato per essere mostrato all'utente."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


class DiaryEntry(BaseModel):
    tmdb_id: int
    title: str
    year: int | None = None
    rating: float | None = None  # stelle 0.5-5, se votato
    watched_date: str | None = None  # AAAA-MM-GG
    rewatch: bool = False


class RecentFeed(BaseModel):
    films: list[DiaryEntry]
    truncated: bool  # la RSS è piena: nel diario ci sono quasi certamente film più vecchi


def _local_name(tag: str) -> str:
    """`{https://letterboxd.com}filmTitle` -> `filmTitle`: i namespace non ci interessano."""
    return tag.rsplit("}", 1)[-1]


def _number(text: str | None, kind: type) -> int | float | None:
    try:
        return kind(text) if text else None
    except ValueError:
        return None


def parse_feed(xml_text: str) -> RecentFeed:
    """Voci di film del feed, dalla più recente; senza doppioni (vale la visione più recente).

    Le voci senza id TMDB di un film (liste, serie TV) vengono saltate. `truncated` dice se le voci
    di diario sono tante quante la RSS ne mostra al massimo, cioè se il diario va più indietro.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise LetterboxdError("La risposta di Letterboxd non è una RSS leggibile", 502) from exc
    entries: list[DiaryEntry] = []
    seen: set[int] = set()
    diary_items = 0
    for item in root.iter():
        if _local_name(item.tag) != "item":
            continue
        fields = {_local_name(child.tag): (child.text or "").strip() for child in item}
        tmdb_id = _number(fields.get("movieId"), int)
        if tmdb_id is None:
            continue
        diary_items += 1
        if tmdb_id in seen:
            continue
        seen.add(tmdb_id)
        entries.append(
            DiaryEntry(
                tmdb_id=tmdb_id,
                title=fields.get("filmTitle") or fields.get("title") or "",
                year=_number(fields.get("filmYear"), int),
                rating=_number(fields.get("memberRating"), float),
                watched_date=fields.get("watchedDate") or None,
                rewatch=fields.get("rewatch", "").lower() == "yes",
            )
        )
    return RecentFeed(films=entries, truncated=diary_items >= FEED_DIARY_LIMIT)


class LetterboxdClient:
    def __init__(self, http: httpx.AsyncClient | None = None, base_url: str = BASE_URL) -> None:
        self._http = http  # creato al primo uso: preparare HTTPS costa, e spesso non serve
        self._base_url = base_url
        self._cache = TTLCache(FEED_TTL)

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=10.0,
                follow_redirects=True,  # es. maiuscole nel nome utente
                headers={"User-Agent": USER_AGENT},
            )
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()

    async def recent(self, username: str) -> RecentFeed:
        if not USERNAME_PATTERN.match(username):
            raise LetterboxdError("Nome utente Letterboxd non valido", 422)
        key = username.lower()
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        try:
            response = await self._client().get(f"/{username}/rss/")
        except httpx.HTTPError as exc:
            raise LetterboxdError("Letterboxd non raggiungibile, riprova tra poco", 502) from exc
        if response.status_code == 404:
            raise LetterboxdError(f"Utente Letterboxd «{username}» non trovato", 404)
        if response.status_code in (403, 429, 503):
            raise LetterboxdError(
                "Letterboxd ha bloccato o rallentato la richiesta, riprova più tardi", 502
            )
        if response.status_code >= 400:
            raise LetterboxdError(f"Letterboxd ha risposto con errore {response.status_code}", 502)
        if len(response.content) > MAX_FEED_BYTES:
            raise LetterboxdError("La RSS di Letterboxd è troppo grande", 502)
        feed = parse_feed(response.text)
        self._cache.set(key, feed)
        return feed
