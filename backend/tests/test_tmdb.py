import random
from datetime import date

import httpx
import pytest

from app.models import FilmRef, MovieFilters, StackKind
from app.tmdb import (
    BASE_URL,
    MAX_DISCOVER_PAGES,
    TMDBClient,
    TMDBError,
    TTLCache,
    build_discover_params,
    pick_match,
)
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


def test_discover_params_for_each_kind_of_pile():
    today = date(2026, 10, 11)
    popular = build_discover_params(MovieFilters(), today=today)
    assert (popular["sort_by"], popular["vote_count.gte"]) == ("popularity.desc", 100)
    top = build_discover_params(MovieFilters(kind=StackKind.TOP_RATED), today=today)
    assert (top["sort_by"], top["vote_count.gte"]) == ("vote_average.desc", 1000)
    recent = build_discover_params(MovieFilters(kind=StackKind.RECENT), today=today)
    assert recent["sort_by"] == "primary_release_date.desc"
    assert recent["primary_release_date.lte"] == "2026-10-11"  # niente film non ancora usciti
    gems = build_discover_params(MovieFilters(kind=StackKind.HIDDEN_GEMS), today=today)
    assert gems["vote_count.lte"] == 1500 and gems["vote_average.gte"] == 7.0
    assert gems["without_genres"] == "99,10402"  # niente documentari e concerti


def test_hidden_gems_keep_documentaries_if_someone_asked_for_them():
    gems = build_discover_params(MovieFilters(kind=StackKind.HIDDEN_GEMS, genres=[99]))
    assert gems["without_genres"] == "10402"


def test_discover_params_map_the_new_filters():
    filters = MovieFilters(
        exclude_genres=[27, 35],
        year_min=1990,
        year_max=1999,
        min_rating=7.5,
        languages=["it", "fr"],
        themes=[207317, 9672],
    )
    params = build_discover_params(filters)
    assert params["without_genres"] == "27,35"
    assert params["primary_release_date.gte"] == "1990-01-01"
    assert params["primary_release_date.lte"] == "1999-12-31"
    assert params["vote_average.gte"] == 7.5
    assert params["with_original_language"] == "it|fr"
    assert params["with_keywords"] == "207317|9672"


def test_min_rating_never_lowers_the_hidden_gems_threshold():
    gems = MovieFilters(kind=StackKind.HIDDEN_GEMS, min_rating=6)
    assert build_discover_params(gems)["vote_average.gte"] == 7.0
    assert build_discover_params(gems.model_copy(update={"min_rating": 8}))["vote_average.gte"] == 8


def test_max_rating_lets_you_pick_the_bad_ones():
    params = build_discover_params(MovieFilters(max_rating=5))
    assert params["vote_average.lte"] == 5
    assert params["vote_count.gte"] == 100  # brutti sì, ma che qualcuno li abbia visti


def test_year_ranges_become_one_span_each_inside_year_min_max():
    filters = MovieFilters(year_ranges=["1990-1999", "2010-2019", "-1979", "2020-"])
    assert filters.year_spans() == [(1990, 1999), (2010, 2019), (None, 1979), (2020, None)]
    bounded = filters.model_copy(update={"year_min": 1995, "year_max": 2015})
    assert bounded.year_spans() == [(1995, 1999), (2010, 2015)]  # gli altri restano fuori
    assert MovieFilters(year_min=2000).year_spans() == [(2000, None)]
    params = build_discover_params(filters, years=(1990, 1999))
    assert params["primary_release_date.gte"] == "1990-01-01"
    assert params["primary_release_date.lte"] == "1999-12-31"


def test_recent_pile_up_to_an_older_year_keeps_that_year():
    params = build_discover_params(
        MovieFilters(kind=StackKind.RECENT, year_max=1999), today=date(2026, 10, 11)
    )
    assert params["primary_release_date.lte"] == "1999-12-31"


@pytest.mark.parametrize(
    "bad",
    [
        {"year_min": 2010, "year_max": 1990},
        {"languages": ["ita"]},
        {"languages": ["IT"]},
        {"min_rating": 11},
        {"min_rating": 7, "max_rating": 5},
        {"year_ranges": ["1990"]},
        {"year_ranges": ["-"]},
        {"year_ranges": ["1999-1990"]},
        {"kind": "random"},
    ],
)
def test_invalid_filters_are_refused(bad):
    with pytest.raises(ValueError):
        MovieFilters(**bad)


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


def dated_catalog():
    """10 film degli anni '90 (id 1-10) e 10 degli anni 2010 (id 11-20)."""
    nineties = [make_details(i, release=f"199{i - 1}-06-01") for i in range(1, 11)]
    tens = [make_details(i, release=f"201{i - 11}-06-01") for i in range(11, 21)]
    return nineties + tens


async def test_several_year_ranges_mix_their_films(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = dated_catalog()
    movies = await tmdb.movies(MovieFilters(year_ranges=["1990-1999", "2010-2019"]), limit=6)
    assert [m.id for m in movies] == [1, 11, 2, 12, 3, 13]  # alternati, non solo il primo decennio
    assert len(fake_tmdb.requests_to("/discover/movie")) == 2


async def test_year_ranges_outside_year_min_max_find_nothing(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = dated_catalog()
    filters = MovieFilters(year_ranges=["1990-1999"], year_min=2000)
    assert await tmdb.movies(filters) == []
    assert await tmdb.count(filters) == 0
    assert fake_tmdb.requests_to("/discover/movie") == []


async def test_count_sums_the_year_ranges_and_is_cached(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = dated_catalog()
    assert await tmdb.count(MovieFilters()) == 20
    assert await tmdb.count(MovieFilters(year_ranges=["1990-1994", "2010-"])) == 15
    assert await tmdb.count(MovieFilters(year_ranges=["1990-1994", "2010-"])) == 15
    assert len(fake_tmdb.requests_to("/discover/movie")) == 3  # 1 + 2, la terza volta dalla cache


# --- generi e piattaforme ---------------------------------------------------------------------


async def test_genres(tmdb: TMDBClient):
    genres = await tmdb.genres()
    assert [(g.id, g.name) for g in genres] == [
        (35, "Commedia"),
        (53, "Thriller"),
        (16, "Animazione / cartoni"),  # nome ritoccato
    ]


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


# --- esclusione di film (già visti) ------------------------------------------------------------


async def test_excluded_movies_are_skipped_and_more_pages_are_read(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(100)
    movies = await tmdb.movies(MovieFilters(), limit=30, exclude=set(range(1, 41)))
    assert [m.id for m in movies] == list(range(41, 71))
    assert len(fake_tmdb.requests_to("/discover/movie")) == 4  # pagine 1-2, poi 3-4


async def test_nothing_is_excluded_by_default_and_requests_stay_the_same(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(100)
    movies = await tmdb.movies(MovieFilters(), limit=30)
    assert [m.id for m in movies] == list(range(1, 31))
    assert len(fake_tmdb.requests_to("/discover/movie")) == 2


async def test_excluding_everything_gives_an_empty_pile_not_an_error(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(25)
    assert await tmdb.movies(MovieFilters(), limit=10, exclude=set(range(1, 26))) == []
    assert len(fake_tmdb.requests_to("/discover/movie")) == 2  # tutte le pagine che esistono


async def test_exclusion_stops_at_the_page_cap(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = catalog(1000)  # 50 pagine
    await tmdb.movies(MovieFilters(), limit=10, exclude=set(range(1, 1001)))
    assert len(fake_tmdb.requests_to("/discover/movie")) == MAX_DISCOVER_PAGES


async def test_exclusion_does_not_fetch_details_of_excluded_movies(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(25)
    await tmdb.movies(MovieFilters(), limit=5, exclude={1, 2, 3})
    fetched = {r.url.path.rsplit("/", 1)[1] for r in fake_tmdb.requests_to("/movie/")}
    assert fetched.isdisjoint({"1", "2", "3"})


# --- riconoscimento di film (titolo + anno -> id) ----------------------------------------------


def film(title: str, year: int | None) -> FilmRef:
    return FilmRef(title=title, year=year)


async def test_match_finds_films_by_title_and_year(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [
        make_details(1, title="Dune", release="1984-12-14"),
        make_details(2, title="Dune", release="2021-09-15"),
    ]
    ids = await tmdb.match_films([film("Dune", 2021), film("Dune", 1984)])
    assert ids == [2, 1]


def test_pick_match_tolerates_one_year_of_difference_but_not_more():
    results = [{"id": 1, "title": "Parasite", "release_date": "2019-05-30"}]
    assert pick_match(film("Parasite", 2020), results) == 1  # festival vs uscita in sala
    assert pick_match(film("Parasite", 2018), results) == 1
    assert pick_match(film("Parasite", 2021), results) is None


def test_pick_match_prefers_exact_title_then_exact_year_then_rank():
    results = [
        {"id": 1, "title": "Dune: Part Two", "release_date": "2024-02-27"},
        {"id": 2, "title": "Dune", "release_date": "2021-09-15"},
        {"id": 3, "title": "Dune", "release_date": "2020-12-01"},
    ]
    assert pick_match(film("Dune", 2021), results) == 2  # titolo identico e anno identico
    assert pick_match(film("Dune", 2020), results) == 3
    assert pick_match(film("Dune", None), results) == 2  # a parità, il più in alto


def test_pick_match_ignores_results_without_a_date_when_a_year_is_known():
    assert pick_match(film("Heat", 1995), [{"id": 1, "title": "Heat"}]) is None


async def test_match_is_insensitive_to_case_accents_and_punctuation(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = [make_details(7, title="Amélie", release="2001-04-25")]
    assert await tmdb.match_films([film("amelie", 2001)]) == [7]


async def test_match_uses_the_original_title_too(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [
        make_details(
            5, title="La città incantata", original_title="Spirited Away", release="2001-07-20"
        )
    ]
    assert await tmdb.match_films([film("Spirited Away", 2001)]) == [5]


async def test_match_does_not_confuse_a_similar_but_different_title(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = [make_details(1, title="Alien: Romulus", release="2024-08-14")]
    assert await tmdb.match_films([film("Alien", 2024)]) == [None]


async def test_match_unknown_film_is_none_and_order_is_kept(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [make_details(3, title="Heat", release="1995-12-15")]
    assert await tmdb.match_films([film("Film inesistente", 2020), film("Heat", 1995)]) == [None, 3]


async def test_match_without_a_year_takes_the_first_exact_title(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = [
        make_details(1, title="Psycho", release="1960-06-16"),
        make_details(2, title="Psycho", release="1998-12-04"),
    ]
    assert await tmdb.match_films([film("Psycho", None)]) == [1]


async def test_match_ignores_titles_made_only_of_symbols(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    assert await tmdb.match_films([film("...", 2000)]) == [None]
    assert fake_tmdb.requests_to("/search") == []


async def test_match_results_are_cached_including_the_misses(tmdb: TMDBClient, fake_tmdb: FakeTMDB):
    fake_tmdb.catalog = [make_details(3, title="Heat", release="1995-12-15")]
    films = [film("Heat", 1995), film("Sconosciuto", 1999)]
    assert await tmdb.match_films(films) == [3, None]
    assert await tmdb.match_films(films) == [3, None]
    assert len(fake_tmdb.requests_to("/search/movie")) == 2


async def test_match_retries_when_tmdb_says_too_many_requests(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB, monkeypatch
):
    monkeypatch.setattr("app.tmdb.RATE_LIMIT_DELAY", 0)
    fake_tmdb.catalog = [make_details(3, title="Heat", release="1995-12-15")]
    fake_tmdb.rate_limited_searches = 2
    assert await tmdb.match_films([film("Heat", 1995)]) == [3]


async def test_match_gives_up_after_too_many_rate_limits(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB, monkeypatch
):
    monkeypatch.setattr("app.tmdb.RATE_LIMIT_DELAY", 0)
    fake_tmdb.rate_limited_searches = 99
    with pytest.raises(TMDBError) as error:
        await tmdb.match_films([film("Heat", 1995)])
    assert error.value.status_code == 429


# --- varietà: pile diverse a ogni partita ------------------------------------------------------


async def test_with_a_random_generator_the_pile_is_picked_among_more_candidates(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(200)
    piles = [
        [m.id for m in await tmdb.movies(MovieFilters(), limit=10, rng=random.Random(seed))]
        for seed in (1, 2)
    ]
    assert piles[0] != piles[1]
    for pile in piles:
        assert len(pile) == 10
        assert pile == sorted(pile)  # resta l'ordine di TMDB (qui: popolarità)
        assert max(pile) <= 30  # pescati fra i primi 3 x 10
    assert len(fake_tmdb.requests_to("/discover/movie")) == 2 * 2  # 30 candidati = 2 pagine


async def test_without_a_random_generator_the_pile_is_the_same_every_time(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(200)
    first = [m.id for m in await tmdb.movies(MovieFilters(), limit=10)]
    assert (
        first == [m.id for m in await tmdb.movies(MovieFilters(), limit=10)] == list(range(1, 11))
    )


async def test_random_pile_with_few_candidates_takes_them_all(
    tmdb: TMDBClient, fake_tmdb: FakeTMDB
):
    fake_tmdb.catalog = catalog(4)
    pile = await tmdb.movies(MovieFilters(), limit=10, rng=random.Random(0))
    assert [m.id for m in pile] == [1, 2, 3, 4]
