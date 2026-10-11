import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.requests import HTTPConnection
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import get_letterboxd_base_url, get_tmdb_api_key
from app.letterboxd import DiaryEntry, LetterboxdClient, LetterboxdError
from app.models import MAX_MATCH_BATCH, FilmRef, Genre, Movie, Provider, StackSettings
from app.protocol import Phase
from app.realtime import Hub
from app.rooms import MAX_NAME_LENGTH, MAX_PLAYERS, RoomError, RoomManager, TooManyRooms
from app.tmdb import TMDBClient, TMDBError

# La API key v3 viaggia in query string: evitiamo che httpx ne logghi gli URL.
logging.getLogger("httpx").setLevel(logging.WARNING)


PURGE_INTERVAL = 300  # secondi tra una pulizia delle stanze abbandonate e l'altra


async def purge_rooms_forever(rooms: RoomManager) -> None:
    while True:
        await asyncio.sleep(PURGE_INTERVAL)
        rooms.purge_idle()


@asynccontextmanager
async def lifespan(app: FastAPI):
    api_key = get_tmdb_api_key()
    app.state.tmdb = TMDBClient(api_key) if api_key else None
    app.state.letterboxd = LetterboxdClient(base_url=get_letterboxd_base_url())
    app.state.rooms = RoomManager()
    app.state.hub = Hub(app.state.rooms)
    purger = asyncio.create_task(purge_rooms_forever(app.state.rooms))
    yield
    purger.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await purger
    if app.state.tmdb is not None:
        await app.state.tmdb.aclose()
    await app.state.letterboxd.aclose()


app = FastAPI(title="Tinder Movies", lifespan=lifespan)


def get_optional_tmdb(conn: HTTPConnection) -> TMDBClient | None:
    return conn.app.state.tmdb


def get_tmdb(tmdb: Annotated[TMDBClient | None, Depends(get_optional_tmdb)]) -> TMDBClient:
    if tmdb is None:
        raise HTTPException(503, "TMDB_API_KEY non configurata: vedi README")
    return tmdb


TMDB = Annotated[TMDBClient, Depends(get_tmdb)]


@app.exception_handler(TMDBError)
async def tmdb_error_handler(request: Request, exc: TMDBError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=502)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/genres", response_model=list[Genre])
async def genres(tmdb: TMDB):
    """Generi cinematografici (id + nome in italiano), da usare nel filtro `genres`."""
    return await tmdb.genres()


@app.get("/api/providers", response_model=list[Provider])
async def providers(tmdb: TMDB):
    """Piattaforme di streaming disponibili in Italia, da usare nel filtro `platforms`."""
    return await tmdb.providers()


@app.get("/api/movies", response_model=list[Movie])
async def movies(tmdb: TMDB, query: Annotated[StackSettings, Query()]):
    """Pila di film in streaming in Italia che rispettano i filtri, per popolarità.

    Filtri ripetibili: `?platforms=8&platforms=337&genres=35&year_min=2010&max_runtime=120`.
    """
    return await tmdb.movies(query, query.limit)


class MatchRequest(BaseModel):
    films: list[FilmRef] = Field(max_length=MAX_MATCH_BATCH)


class MatchResult(BaseModel):
    ids: list[int | None] = Field(
        description="Id TMDB di ogni film, nello stesso ordine; null = no"
    )


@app.post("/api/films/match", response_model=MatchResult)
async def match_films(body: MatchRequest, tmdb: TMDB):
    """Riconosce film scritti come titolo + anno (es. l'export di Letterboxd) e dà l'id TMDB."""
    return MatchResult(ids=await tmdb.match_films(body.films))


def get_letterboxd(conn: HTTPConnection) -> LetterboxdClient:
    return conn.app.state.letterboxd


class RecentFilms(BaseModel):
    username: str
    films: list[DiaryEntry]
    truncated: bool = Field(description="La RSS è piena: nel diario ci sono film più vecchi")


@app.get("/api/letterboxd/{username}/recent", response_model=RecentFilms)
async def letterboxd_recent(
    username: str, letterboxd: Annotated[LetterboxdClient, Depends(get_letterboxd)]
):
    """Ultimi film del diario pubblico di un utente Letterboxd (~50, dalla RSS), con id TMDB."""
    try:
        feed = await letterboxd.recent(username)
    except LetterboxdError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    return RecentFilms(username=username, films=feed.films, truncated=feed.truncated)


class NewRoom(BaseModel):
    name: str = Field(max_length=200, description=f"Il tuo nome (max {MAX_NAME_LENGTH} caratteri)")


class CreatedRoom(BaseModel):
    code: str
    name: str
    token: str = Field(description="Da mandare nel `join` del WebSocket per entrare come host")


class RoomInfo(BaseModel):
    code: str
    phase: Phase
    players: int
    joinable: bool = Field(description="Si può ancora entrare con un nome nuovo")


@app.post("/api/rooms", response_model=CreatedRoom, status_code=201)
async def create_room(body: NewRoom, request: Request):
    """Crea una stanza. Poi collegati a `/ws/{code}` e manda `join` con `name` e `token`."""
    try:
        room = request.app.state.rooms.create(body.name)
    except TooManyRooms as exc:
        raise HTTPException(503, str(exc)) from exc
    except RoomError as exc:
        raise HTTPException(422, str(exc)) from exc
    host = room.players[room.host]
    return CreatedRoom(code=room.code, name=host.name, token=host.token)


@app.get("/api/rooms/{code}", response_model=RoomInfo)
async def room_info(code: str, request: Request):
    """Esiste questa stanza e ci si può entrare? Utile per controllare il codice prima del nome."""
    room = request.app.state.rooms.get(code)
    if room is None:
        raise HTTPException(404, "Stanza non trovata")
    return RoomInfo(
        code=room.code,
        phase=room.phase,
        players=len(room.players),
        joinable=room.phase is Phase.LOBBY and len(room.players) < MAX_PLAYERS,
    )


@app.websocket("/ws/{code}")
async def room_socket(
    websocket: WebSocket,
    code: str,
    tmdb: Annotated[TMDBClient | None, Depends(get_optional_tmdb)],
):
    """Tempo reale di una stanza. Messaggi: vedi `app/protocol.py` e il README."""
    await websocket.app.state.hub.serve(websocket, code, tmdb)


def mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve il frontend compilato (`frontend/dist`) dallo stesso servizio. Senza build: niente.

    Va chiamata dopo aver definito le rotte API: la rotta "tutto il resto" deve essere l'ultima.
    """
    dist = dist.resolve()
    index = dist / "index.html"
    if not index.is_file():
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        if path.split("/", 1)[0] in ("api", "ws"):
            raise HTTPException(404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        # Qualsiasi altro percorso (es. /r/ABCD) è una pagina del frontend: decide lui.
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


mount_frontend(
    app,
    Path(os.getenv("FRONTEND_DIST") or Path(__file__).resolve().parents[2] / "frontend" / "dist"),
)
