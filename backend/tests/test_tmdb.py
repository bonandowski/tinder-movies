import httpx
import pytest

from app.models import MovieFilters
from app.tmdb import BASE_URL, TMDBClient, TMDBError, TTLCache, build_discover_params
from tests.fake_tmdb import FakeTMDB, make_details


def catalog(n: int):
    return [make_details(i) for i in range(1, n + 1)]


# --- parametri di /discover/movie -------------------------------------------------------------


def test_discover_params_without_filters_restrict_to_italian_flatrate():
    params = build_discover_params(MovieFilters())
    assert params["watch_region"] == "IT"
    assert params["with_watch_monetization_types"] == "flatrate"
    assert params["sort_by"] == "popularity.desc"
    for optional in (
        "with_watch_providers",
        "with_genres",
        "primary_release_date.gte",
        "with_runtime.lte",
    ):
        assert optional not in params


def test_discover_params_map_every_filter():
    filters = MovieFilters(platforms=[8, 337], genres=[35, 53], year_min=2015, max_runtime=110)
    params = build_discover_params(filters, page=3)
    assert params["with_watch_providers"] == "8|337"
    assert params["with_genres"] == "35|53"
    assert params["primary_release_date.gte"] == "2015-01-01"
    assert params["with_runtime.lte"] == 110
    assert params["page"] == 3


# --- pila di film -----------------------------------------------------------------------------


async def test_movies_returns_full_movie_data(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [
        make_details(
            7,
            title="Il Film",
            runtime=118,
            vote=7.84,
            release="2019-10-03",
            providers=((337, "Disney Plus"), (8, "Netflix")),
        )
    ]
    [movie] = await tmdb.movies(MovieFilters())

    assert movie.id == 7
    assert movie.title == "Il Film"
    assert movie.poster_url == "https://image.tmdb.org/t/p/w500/poster.jpg"
    assert movie.overview == "Trama del film 7"
    assert movie.runtime == 118
    assert movie.rating == 7.8
    assert movie.year == 2019
    # piattaforme ordinate per priorità TMDB
    assert [p.name for p in movie.providers] == ["Netflix", "Disney Plus"]
    assert movie.providers[0].logo_url == "https://image.tmdb.org/t/p/w92/logo8.jpg"


async def test_movies_keeps_popularity_order(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = catalog(25)
    movies = await tmdb.movies(MovieFilters(), limit=25)
    assert [m.id for m in movies] == list(range(1, 26))


async def test_movies_limit_fetches_only_needed_pages(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = catalog(100)
    movies = await tmdb.movies(MovieFilters(), limit=30)
    assert len(movies) == 30
    assert len(fake_tmdb.requests_to("/discover/movie")) == 2  # 30 film = 2 pagine da 20


async def test_movies_does_not_request_pages_beyond_total_pages(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(5)
    movies = await tmdb.movies(MovieFilters(), limit=100)
    assert len(movies) == 5
    assert len(fake_tmdb.requests_to("/discover/movie")) == 1


async def test_movies_with_no_results_is_empty(tmdb: TMDBClient):
    assert await tmdb.movies(MovieFilters()) == []


async def test_movies_skips_films_without_poster_or_italian_providers(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = [
        make_details(1),
        make_details(2, poster=None),
        make_details(3, providers=()),
        make_details(4),
    ]
    movies = await tmdb.movies(MovieFilters())
    assert [m.id for m in movies] == [1, 4]


async def test_movies_handles_missing_optional_data(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [make_details(1, runtime=0, release="")]
    [movie] = await tmdb.movies(MovieFilters())
    assert movie.runtime is None
    assert movie.year is None


async def test_movies_skips_a_film_whose_details_fail(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = catalog(3)
    fake_tmdb.failing_movie_ids = {2}
    movies = await tmdb.movies(MovieFilters())
    assert [m.id for m in movies] == [1, 3]


async def test_movie_details_are_cached(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = catalog(3)
    await tmdb.movies(MovieFilters())
    await tmdb.movies(MovieFilters())
    assert len(fake_tmdb.requests_to("/movie/")) == 3  # non 6


async def test_discover_request_carries_filters_and_locale(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    await tmdb.movies(MovieFilters(platforms=[8], genres=[35], year_min=2010, max_runtime=120))
    [request] = fake_tmdb.requests_to("/discover/movie")
    params = request.url.params
    assert params["language"] == "it-IT"
    assert params["with_watch_providers"] == "8"
    assert params["with_genres"] == "35"
    assert params["primary_release_date.gte"] == "2010-01-01"
    assert params["with_runtime.lte"] == "120"


# --- generi e piattaforme ---------------------------------------------------------------------


async def test_genres(tmdb: TMDBClient):
    genres = await tmdb.genres()
    assert [(g.id, g.name) for g in genres] == [(35, "Commedia"), (53, "Thriller")]


async def test_providers_are_sorted_by_italian_priority(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    providers = await tmdb.providers()
    # IT: Netflix=1, Prime Video=3 (display_priority generico), Disney Plus=5
    assert [p.name for p in providers] == ["Netflix", "Prime Video", "Disney Plus"]
    assert providers[0].logo_url == "https://image.tmdb.org/t/p/w92/netflix.jpg"
    assert providers[1].logo_url is None
    assert fake_tmdb.requests_to("/watch/providers/movie")[0].url.params["watch_region"] == "IT"


async def test_genres_and_providers_are_cached(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    await tmdb.genres()
    await tmdb.genres()
    await tmdb.providers()
    await tmdb.providers()
    assert len(fake_tmdb.requests_to("/genre/movie/list")) == 1
    assert len(fake_tmdb.requests_to("/watch/providers/movie")) == 1


# --- autenticazione ed errori -----------------------------------------------------------------


async def test_v3_api_key_goes_in_query(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    await tmdb.genres()
    [request] = fake_tmdb.requests
    assert request.url.params["api_key"] == "a" * 32
    assert "authorization" not in request.headers


async def test_v4_read_access_token_goes_in_bearer_header(fake_tmdb: FakeTMDB):
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(fake_tmdb))
    client = TMDBClient("eyJhbGciOi.payload.signature", http=http)
    await client.genres()
    [request] = fake_tmdb.requests
    assert request.headers["authorization"] == "Bearer eyJhbGciOi.payload.signature"
    assert "api_key" not in request.url.params


async def test_invalid_key_raises_readable_error(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.status_override = 401
    with pytest.raises(TMDBError, match="TMDB_API_KEY") as exc_info:
        await tmdb.genres()
    assert exc_info.value.status_code == 401


async def test_rate_limit_and_server_errors_raise(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.status_override = 429
    with pytest.raises(TMDBError) as exc_info:
        await tmdb.genres()
    assert exc_info.value.status_code == 429
    fake_tmdb.status_override = 503
    with pytest.raises(TMDBError) as exc_info:
        await tmdb.genres()
    assert exc_info.value.status_code == 503


async def test_network_failure_raises_tmdb_error():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(boom))
    with pytest.raises(TMDBError, match="non raggiungibile"):
        await TMDBClient("k" * 32, http=http).genres()


# --- cache ------------------------------------------------------------------------------------


def test_ttl_cache_expires_entries():
    now = [0.0]
    cache = TTLCache(ttl=10, clock=lambda: now[0])
    cache.set("k", "v")
    assert cache.get("k") == "v"
    now[0] = 9.9
    assert cache.get("k") == "v"
    now[0] = 10.0
    assert cache.get("k") is None
    assert cache.get("missing") is None
