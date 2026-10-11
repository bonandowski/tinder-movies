import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.fake_tmdb import FakeTMDB, make_details


def test_health():
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}


def test_tmdb_endpoints_return_503_without_api_key():
    with TestClient(app) as client:
        for path in ("/api/movies", "/api/genres", "/api/providers"):
            response = client.get(path)
            assert response.status_code == 503
            assert "TMDB_API_KEY" in response.json()["detail"]


def test_movies_returns_a_pile_with_all_fields(client, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [make_details(1, title="Primo"), make_details(2, title="Secondo")]
    response = client.get("/api/movies")
    assert response.status_code == 200
    first = response.json()[0]
    assert [m["title"] for m in response.json()] == ["Primo", "Secondo"]
    assert set(first) == {
        "id",
        "title",
        "poster_url",
        "overview",
        "runtime",
        "rating",
        "year",
        "providers",
    }
    assert first["providers"] == [
        {"id": 8, "name": "Netflix", "logo_url": "https://image.tmdb.org/t/p/w92/logo8.jpg"}
    ]


def test_movies_default_limit_is_30(client, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [make_details(i) for i in range(1, 41)]
    assert len(client.get("/api/movies").json()) == 30
    assert len(client.get("/api/movies", params={"limit": 5}).json()) == 5


def test_movies_forwards_filters_to_tmdb(client, fake_tmdb: FakeTMDB):
    response = client.get(
        "/api/movies",
        params={
            "platforms": [8, 337],
            "genres": [35],
            "year_min": 2010,
            "max_runtime": 120,
        },
    )
    assert response.status_code == 200
    [request] = fake_tmdb.requests_to("/discover/movie")
    assert request.url.params["with_watch_providers"] == "8|337"
    assert request.url.params["with_genres"] == "35"
    assert request.url.params["primary_release_date.gte"] == "2010-01-01"
    assert request.url.params["with_runtime.lte"] == "120"


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"year_min": 1800},
        {"max_runtime": 10},
        {"platforms": "netflix"},
    ],
)
def test_movies_rejects_invalid_filters(client, params):
    assert client.get("/api/movies", params=params).status_code == 422


def test_tmdb_failure_becomes_502_with_readable_message(client, fake_tmdb: FakeTMDB):
    fake_tmdb.status_override = 401
    response = client.get("/api/movies")
    assert response.status_code == 502
    assert "TMDB_API_KEY" in response.json()["detail"]


def test_genres_and_providers(client):
    assert client.get("/api/genres").json() == [
        {"id": 35, "name": "Commedia"},
        {"id": 53, "name": "Thriller"},
    ]
    names = [p["name"] for p in client.get("/api/providers").json()]
    assert names == ["Netflix", "Prime Video", "Disney Plus"]
