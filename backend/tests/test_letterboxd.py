from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.letterboxd import BASE_URL, LetterboxdClient, LetterboxdError, parse_feed
from app.main import app, get_letterboxd

FEED = (Path(__file__).parent / "fixtures" / "letterboxd_rss.xml").read_text()


class FakeLetterboxd:
    def __init__(self, status: int = 200, body: str = FEED):
        self.status = status
        self.body = body
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, text=self.body)


def client_for(fake: FakeLetterboxd) -> LetterboxdClient:
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(fake))
    return LetterboxdClient(http=http)


# --- parsing -----------------------------------------------------------------------------------


def test_parse_feed_reads_films_with_tmdb_id_rating_and_date():
    entries = parse_feed(FEED)
    assert [(e.tmdb_id, e.title, e.year) for e in entries] == [
        (693134, "Dune: Part Two", 2024),
        (949, "Heat", 1995),
    ]
    dune, heat = entries
    assert (dune.rating, dune.watched_date, dune.rewatch) == (4.5, "2026-10-10", False)
    assert (heat.rating, heat.rewatch) == (None, True)  # rivisto, senza voto


def test_parse_feed_keeps_the_latest_viewing_and_skips_lists_and_tv():
    entries = parse_feed(FEED)
    assert [e.tmdb_id for e in entries].count(693134) == 1
    assert entries[0].rating == 4.5  # la visione più recente, non quella di marzo


def test_parse_feed_does_not_depend_on_namespace_urls():
    other = FEED.replace("https://letterboxd.com", "https://example.org/lb").replace(
        "https://themoviedb.org", "urn:tmdb"
    )
    assert [e.tmdb_id for e in parse_feed(other)] == [693134, 949]


def test_parse_feed_of_an_empty_diary():
    assert parse_feed('<rss version="2.0"><channel><title>x</title></channel></rss>') == []


def test_parse_feed_refuses_something_that_is_not_xml():
    with pytest.raises(LetterboxdError, match="RSS"):
        parse_feed("<html>Just a moment...")


# --- client ------------------------------------------------------------------------------------


async def test_recent_reads_the_users_feed():
    fake = FakeLetterboxd()
    entries = await client_for(fake).recent("anna")
    assert len(entries) == 2
    assert fake.requests[0].url.path == "/anna/rss/"


async def test_recent_is_cached_per_user_ignoring_case():
    fake = FakeLetterboxd()
    letterboxd = client_for(fake)
    await letterboxd.recent("Anna")
    await letterboxd.recent("anna")
    assert len(fake.requests) == 1


@pytest.mark.parametrize("username", ["", "anna/../x", "a b", "anna?x=1", "x" * 41, "ànna"])
async def test_recent_refuses_invalid_usernames_without_calling_letterboxd(username):
    fake = FakeLetterboxd()
    with pytest.raises(LetterboxdError) as error:
        await client_for(fake).recent(username)
    assert error.value.status_code == 422
    assert fake.requests == []


@pytest.mark.parametrize(
    ("status", "code", "text"),
    [(404, 404, "non trovato"), (403, 502, "bloccato"), (429, 502, "bloccato"), (500, 502, "500")],
)
async def test_recent_errors_are_readable(status, code, text):
    with pytest.raises(LetterboxdError, match=text) as error:
        await client_for(FakeLetterboxd(status=status, body="")).recent("anna")
    assert error.value.status_code == code


async def test_recent_reports_network_errors():
    def broken(request):
        raise httpx.ConnectError("giù")

    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(broken))
    with pytest.raises(LetterboxdError, match="non raggiungibile"):
        await LetterboxdClient(http=http).recent("anna")


async def test_errors_are_not_cached():
    fake = FakeLetterboxd(status=503, body="")
    letterboxd = client_for(fake)
    with pytest.raises(LetterboxdError):
        await letterboxd.recent("anna")
    fake.status, fake.body = 200, FEED
    assert len(await letterboxd.recent("anna")) == 2


# --- endpoint ----------------------------------------------------------------------------------


@pytest.fixture
def api():
    fake = FakeLetterboxd()
    app.dependency_overrides[get_letterboxd] = lambda: client_for(fake)
    with TestClient(app) as test_client:
        yield test_client, fake
    app.dependency_overrides.clear()


def test_endpoint_returns_the_recent_films(api):
    client, _ = api
    response = client.get("/api/letterboxd/anna/recent")
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "anna"
    assert body["films"][0] == {
        "tmdb_id": 693134,
        "title": "Dune: Part Two",
        "year": 2024,
        "rating": 4.5,
        "watched_date": "2026-10-10",
        "rewatch": False,
    }


def test_endpoint_turns_errors_into_http_statuses(api):
    client, fake = api
    fake.status, fake.body = 404, ""
    response = client.get("/api/letterboxd/nessuno/recent")
    assert response.status_code == 404
    assert "non trovato" in response.json()["detail"]
    assert client.get("/api/letterboxd/a%20b/recent").status_code == 422
