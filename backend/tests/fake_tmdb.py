"""Un finto TMDB (da usare con httpx.MockTransport) per testare senza rete né chiave."""

import math
from typing import Any

import httpx

from app.tmdb import DISCOVER_PAGE_SIZE, normalize_title


def make_details(
    movie_id: int,
    *,
    title: str | None = None,
    original_title: str | None = None,
    poster: str | None = "/poster.jpg",
    runtime: int | None = 100,
    vote: float = 7.84,
    release: str = "2020-05-01",
    providers: tuple[tuple[int, str], ...] = ((8, "Netflix"),),
) -> dict[str, Any]:
    return {
        "id": movie_id,
        "title": title or f"Film {movie_id}",
        "original_title": original_title or title or f"Film {movie_id}",
        "poster_path": poster,
        "overview": f"Trama del film {movie_id}",
        "runtime": runtime,
        "vote_average": vote,
        "release_date": release,
        "watch/providers": {
            "results": {
                "IT": {
                    "flatrate": [
                        {
                            "provider_id": pid,
                            "provider_name": name,
                            "logo_path": f"/logo{pid}.jpg",
                            "display_priority": pid,
                        }
                        for pid, name in providers
                    ]
                }
            }
        },
    }


class FakeTMDB:
    """Risponde come TMDB. `catalog` è l'elenco di film (in ordine di popolarità)."""

    def __init__(self, catalog: list[dict[str, Any]] | None = None):
        self.catalog = catalog if catalog is not None else []
        self.requests: list[httpx.Request] = []
        self.failing_movie_ids: set[int] = set()
        self.status_override: int | None = None
        self.rate_limited_searches = 0  # le prime N ricerche rispondono 429

    def requests_to(self, prefix: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path.startswith(f"/3{prefix}")]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status_override is not None:
            return httpx.Response(self.status_override, json={"status_message": "x"})
        path = request.url.path.removeprefix("/3")
        params = request.url.params

        if path == "/discover/movie":
            page = int(params["page"])
            found = [
                m
                for m in self.catalog
                if m["release_date"] >= params.get("primary_release_date.gte", "")
                and m["release_date"] <= params.get("primary_release_date.lte", "9999")
            ]
            start = (page - 1) * DISCOVER_PAGE_SIZE
            chunk = found[start : start + DISCOVER_PAGE_SIZE]
            return httpx.Response(
                200,
                json={
                    "page": page,
                    "total_results": len(found),
                    "total_pages": max(1, math.ceil(len(found) / DISCOVER_PAGE_SIZE)),
                    "results": [{"id": m["id"], "title": m["title"]} for m in chunk],
                },
            )
        if path == "/search/movie":
            if self.rate_limited_searches > 0:
                self.rate_limited_searches -= 1
                return httpx.Response(429, json={})
            wanted = normalize_title(params["query"])
            year = params.get("year")
            found = [
                m
                for m in self.catalog
                if wanted in normalize_title(m["title"])
                or wanted in normalize_title(m["original_title"])
            ]
            if year:
                found = [m for m in found if m["release_date"].startswith(year)]
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": m["id"],
                            "title": m["title"],
                            "original_title": m["original_title"],
                            "release_date": m["release_date"],
                        }
                        for m in found
                    ]
                },
            )
        if path.startswith("/movie/"):
            movie_id = int(path.rsplit("/", 1)[1])
            if movie_id in self.failing_movie_ids:
                return httpx.Response(500, json={})
            by_id = {m["id"]: m for m in self.catalog}
            return httpx.Response(200, json=by_id[movie_id])
        if path == "/genre/movie/list":
            return httpx.Response(
                200,
                json={
                    "genres": [
                        {"id": 35, "name": "Commedia"},
                        {"id": 53, "name": "Thriller"},
                        {"id": 16, "name": "Animazione"},
                    ]
                },
            )
        if path == "/watch/providers/movie":
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "provider_id": 337,
                            "provider_name": "Disney Plus",
                            "logo_path": "/disney.jpg",
                            "display_priorities": {"IT": 5, "US": 1},
                        },
                        {
                            "provider_id": 8,
                            "provider_name": "Netflix",
                            "logo_path": "/netflix.jpg",
                            "display_priorities": {"IT": 1},
                        },
                        {"provider_id": 119, "provider_name": "Prime Video", "display_priority": 3},
                    ]
                },
            )
        return httpx.Response(404, json={})
