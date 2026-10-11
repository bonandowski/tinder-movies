import logging
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import Field

from app.config import get_tmdb_api_key
from app.models import Genre, Movie, MovieFilters, Provider
from app.tmdb import TMDBClient, TMDBError

# La API key v3 viaggia in query string: evitiamo che httpx ne logghi gli URL.
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    api_key = get_tmdb_api_key()
    app.state.tmdb = TMDBClient(api_key) if api_key else None
    yield
    if app.state.tmdb is not None:
        await app.state.tmdb.aclose()


app = FastAPI(title="Tinder Movies", lifespan=lifespan)


def get_tmdb(request: Request) -> TMDBClient:
    tmdb = request.app.state.tmdb
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


class MovieQuery(MovieFilters):
    # FastAPI appiattisce un modello nei parametri query solo se è l'unico: `limit` sta qui dentro.
    limit: int = Field(30, ge=1, le=100, description="Dimensione massima della pila")


@app.get("/api/movies", response_model=list[Movie])
async def movies(tmdb: TMDB, query: Annotated[MovieQuery, Query()]):
    """Pila di film in streaming in Italia che rispettano i filtri, per popolarità.

    Filtri ripetibili: `?platforms=8&platforms=337&genres=35&year_min=2010&max_runtime=120`.
    """
    return await tmdb.movies(query, query.limit)
