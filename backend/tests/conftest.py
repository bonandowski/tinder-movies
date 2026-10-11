import httpx
import pytest

from app.tmdb import BASE_URL, TMDBClient
from tests.fake_tmdb import FakeTMDB


@pytest.fixture
def fake_tmdb() -> FakeTMDB:
    return FakeTMDB()


@pytest.fixture
def tmdb(fake_tmdb: FakeTMDB) -> TMDBClient:
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(fake_tmdb))
    return TMDBClient("a" * 32, http=http)
