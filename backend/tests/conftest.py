import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app, get_optional_tmdb
from app.tmdb import BASE_URL, TMDBClient
from tests.fake_tmdb import FakeTMDB


@pytest.fixture(autouse=True)
def no_real_tmdb_key(monkeypatch):
    """Nei test non si usa mai la chiave vera, anche se c'è un .env."""
    monkeypatch.setenv("TMDB_API_KEY", "")


@pytest.fixture
def fake_tmdb() -> FakeTMDB:
    return FakeTMDB()


@pytest.fixture
def tmdb(fake_tmdb: FakeTMDB) -> TMDBClient:
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(fake_tmdb))
    return TMDBClient("a" * 32, http=http)


@pytest.fixture
def client(tmdb: TMDBClient):
    """App con il finto TMDB al posto di quello vero (vale sia per HTTP sia per WebSocket)."""
    app.dependency_overrides[get_optional_tmdb] = lambda: tmdb
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
