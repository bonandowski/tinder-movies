"""Flusso completo di una stanza via REST + WebSocket, con il finto TMDB."""

from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.protocol import MAX_SEEN
from app.realtime import (
    CLOSE_BAD_REQUEST,
    CLOSE_KICKED,
    CLOSE_NOT_FOUND,
    CLOSE_REFUSED,
    CLOSE_REPLACED,
)
from tests.fake_tmdb import FakeTMDB, make_details


def receive(ws, type_: str, limit: int = 12) -> dict:
    """Legge messaggi finché ne arriva uno del tipo cercato (gli altri vengono scartati)."""
    for _ in range(limit):
        message = ws.receive_json()
        if message["type"] == type_:
            return message
    raise AssertionError(f"nessun messaggio {type_!r} nei primi {limit}")


def receive_state(ws, until=lambda state: True, limit: int = 12) -> dict:
    for _ in range(limit):
        state = receive(ws, "state", limit)
        if until(state):
            return state
    raise AssertionError("lo stato atteso non è arrivato")


def create_room(client: TestClient, name: str = "Anna") -> dict:
    response = client.post("/api/rooms", json={"name": name})
    assert response.status_code == 201
    return response.json()


def connect(client: TestClient, stack: ExitStack, code: str, **join):
    ws = stack.enter_context(client.websocket_connect(f"/ws/{code}"))
    ws.send_json({"type": "join", **join})
    return ws


@pytest.fixture
def stack():
    with ExitStack() as exit_stack:
        yield exit_stack


@pytest.fixture
def tokens() -> dict[str, str]:
    """Token segreti dei giocatori di `game`, per i test che rientrano."""
    return {}


@pytest.fixture
def game(client, fake_tmdb: FakeTMDB, stack: ExitStack, tokens: dict[str, str]):
    """Anna (host) e Luca in lobby, già collegati."""
    fake_tmdb.catalog = [make_details(i) for i in (1, 2, 3)]
    room = create_room(client)
    anna = connect(client, stack, room["code"], name="Anna", token=room["token"])
    tokens["Anna"] = receive(anna, "welcome")["token"]
    luca = connect(client, stack, room["code"], name="Luca")
    tokens["Luca"] = receive(luca, "welcome")["token"]
    receive_state(anna, lambda s: len(s["players"]) == 2)
    return room["code"], anna, luca


def start(anna, luca) -> list[int]:
    anna.send_json({"type": "start"})
    stack_msg = receive(luca, "stack")
    receive_state(luca, lambda s: s["phase"] == "swiping")
    receive_state(anna, lambda s: s["phase"] == "swiping")
    return [m["id"] for m in stack_msg["movies"]]


# --- REST --------------------------------------------------------------------------------------


def test_create_room_returns_code_and_secret_token(client):
    room = create_room(client, "  Anna ")
    assert len(room["code"]) == 4 and room["name"] == "Anna" and room["token"]


def test_create_room_rejects_blank_name(client):
    assert client.post("/api/rooms", json={"name": "  "}).status_code == 422
    assert client.post("/api/rooms", json={}).status_code == 422


def test_room_info(client):
    room = create_room(client)
    info = client.get(f"/api/rooms/{room['code'].lower()}").json()
    assert info == {
        "code": room["code"],
        "solo": False,
        "phase": "lobby",
        "players": 1,
        "joinable": True,
    }
    assert client.get("/api/rooms/ZZZZ").status_code == 404


# --- lobby -------------------------------------------------------------------------------------


def test_players_see_each_other_in_the_lobby(game):
    _, anna, luca = game
    state = receive_state(luca, lambda s: len(s["players"]) == 2)
    assert state["you"] == "Luca" and state["host"] == "Anna" and state["phase"] == "lobby"
    assert [(p["name"], p["is_host"], p["connected"]) for p in state["players"]] == [
        ("Anna", True, True),
        ("Luca", False, True),
    ]


def test_host_changes_settings_and_everybody_sees_them(game):
    _, anna, luca = game
    settings = {
        "kind": "hidden_gems",
        "genres": [35],
        "platforms": [8],
        "year_min": 1990,
        "year_max": 1999,
        "max_runtime": 120,
        "min_rating": 7.5,
        "languages": ["it", "fr"],
        "themes": [207317],
        "limit": 10,
        "exclude_seen": False,
    }
    anna.send_json({"type": "set_settings", "settings": settings})
    state = receive_state(luca, lambda s: s["settings"]["limit"] == 10)
    assert {key: state["settings"][key] for key in settings} == settings


def test_invalid_settings_are_refused_and_nothing_changes(game):
    _, anna, _ = game
    anna.send_json({"type": "set_settings", "settings": {"year_min": 2010, "year_max": 1990}})
    assert receive(anna, "error")["fatal"] is False
    anna.send_json({"type": "set_settings", "settings": {"languages": ["italiano"]}})
    assert receive(anna, "error")["fatal"] is False
    anna.send_json({"type": "ping"})
    assert receive(anna, "pong")


def test_guest_cannot_change_settings(game):
    _, _, luca = game
    luca.send_json({"type": "set_settings", "settings": {"limit": 5}})
    assert "Solo chi ha creato" in receive(luca, "error")["message"]


def test_unknown_room_is_refused(client):
    with client.websocket_connect("/ws/ZZZZ") as ws:
        error = ws.receive_json()
        assert error["type"] == "error" and error["fatal"]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == CLOSE_NOT_FOUND


def test_first_message_must_be_a_valid_join(client):
    room = create_room(client)
    with client.websocket_connect(f"/ws/{room['code']}") as ws:
        ws.send_json({"type": "start"})
        assert ws.receive_json()["fatal"]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == CLOSE_BAD_REQUEST


def test_join_with_blank_name_is_refused(client):
    room = create_room(client)
    with client.websocket_connect(f"/ws/{room['code']}") as ws:
        ws.send_json({"type": "join", "name": " "})
        assert "nome" in ws.receive_json()["message"]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == CLOSE_REFUSED


def test_garbage_after_join_is_reported_but_connection_survives(game):
    _, anna, _ = game
    anna.send_text("non è json")
    assert receive(anna, "error")["fatal"] is False
    anna.send_json({"type": "ping"})
    assert receive(anna, "pong")


# --- partita -----------------------------------------------------------------------------------


def test_start_sends_the_same_stack_to_everybody(game):
    _, anna, luca = game
    anna.send_json({"type": "start"})
    assert receive_state(luca, lambda s: s["phase"] == "loading")
    stack_for_luca = receive(luca, "stack")
    stack_for_anna = receive(anna, "stack")
    assert stack_for_luca == stack_for_anna
    assert [m["id"] for m in stack_for_luca["movies"]] == [1, 2, 3]
    state = receive_state(luca, lambda s: s["phase"] == "swiping")
    assert state["total"] == 3 and state["position"] == 0 and state["matches"] == []


def test_guest_cannot_start(game):
    _, _, luca = game
    luca.send_json({"type": "start"})
    assert "Solo chi ha creato" in receive(luca, "error")["message"]


def test_start_alone_is_refused(client, stack, fake_tmdb):
    fake_tmdb.catalog = [make_details(1)]
    room = create_room(client)
    anna = connect(client, stack, room["code"], name="Anna", token=room["token"])
    receive(anna, "welcome")
    anna.send_json({"type": "start"})
    assert "almeno 2" in receive(anna, "error")["message"]


def test_nobody_can_join_after_the_start_but_the_link_in_info_says_so(game, client, stack):
    code, anna, luca = game
    start(anna, luca)
    assert client.get(f"/api/rooms/{code}").json()["joinable"] is False
    late = stack.enter_context(client.websocket_connect(f"/ws/{code}"))
    late.send_json({"type": "join", "name": "Marta"})
    assert "già iniziata" in late.receive_json()["message"]


def test_match_is_announced_to_everybody_when_all_like_a_movie(game):
    _, anna, luca = game
    start(anna, luca)
    anna.send_json({"type": "swipe", "movie_id": 2, "like": True})
    luca.send_json({"type": "swipe", "movie_id": 2, "like": True})
    # prima arriva lo stato aggiornato, poi l'avviso di match
    state = receive_state(luca, lambda s: s["matches"] == [2])
    assert state["position"] == 0  # Luca ha votato il 2 ma non l'1: il prossimo da votare è l'1
    assert receive(luca, "match")["movie_id"] == 2
    assert receive(anna, "match")["movie_id"] == 2


def test_no_match_if_one_says_no(game):
    _, anna, luca = game
    start(anna, luca)
    anna.send_json({"type": "swipe", "movie_id": 1, "like": True})
    luca.send_json({"type": "swipe", "movie_id": 1, "like": False})
    state = receive_state(luca, lambda s: s["players"][1]["progress"] == 1)
    assert state["matches"] == []


def test_game_ends_with_ranking_when_everybody_is_done(game):
    _, anna, luca = game
    start(anna, luca)
    for movie_id, anna_likes, luca_likes in [(1, True, False), (2, True, True), (3, False, False)]:
        anna.send_json({"type": "swipe", "movie_id": movie_id, "like": anna_likes})
        luca.send_json({"type": "swipe", "movie_id": movie_id, "like": luca_likes})
    final = receive_state(anna, lambda s: s["phase"] == "finished")
    assert final["matches"] == [2]
    assert [(r["movie_id"], r["likes"]) for r in final["results"]] == [(2, 2), (1, 1)]
    assert final["results"][1]["liked_by"] == ["Anna"]


def test_host_can_end_early_and_go_back_to_the_lobby(game):
    _, anna, luca = game
    start(anna, luca)
    anna.send_json({"type": "swipe", "movie_id": 1, "like": True})
    anna.send_json({"type": "finish"})
    state = receive_state(luca, lambda s: s["phase"] == "finished")
    assert [r["movie_id"] for r in state["results"]] == [1]
    anna.send_json({"type": "reset"})
    lobby = receive_state(luca, lambda s: s["phase"] == "lobby")
    assert lobby["total"] == 0 and lobby["results"] is None


# --- errori di caricamento ---------------------------------------------------------------------


def test_no_movies_found_keeps_everybody_in_the_lobby(game, fake_tmdb):
    _, anna, luca = game
    fake_tmdb.catalog = []
    anna.send_json({"type": "start"})
    assert "Nessun film" in receive(anna, "error")["message"]
    assert receive_state(luca, lambda s: s["phase"] == "lobby")


def test_tmdb_failure_is_reported_to_the_host_and_the_lobby_is_restored(game, fake_tmdb):
    _, anna, luca = game
    fake_tmdb.status_override = 401
    anna.send_json({"type": "start"})
    assert "TMDB_API_KEY" in receive(anna, "error")["message"]
    assert receive_state(luca, lambda s: s["phase"] == "lobby")
    fake_tmdb.status_override = None  # si può riprovare
    anna.send_json({"type": "start"})
    assert receive(luca, "stack")


def test_start_without_tmdb_key_says_so():
    # senza override il server usa il vero client, che qui non c'è (TMDB_API_KEY vuota)
    with TestClient(app) as client:
        room = create_room(client)
        with client.websocket_connect(f"/ws/{room['code']}") as ws:
            ws.send_json({"type": "join", "name": "Anna", "token": room["token"]})
            receive(ws, "welcome")
            ws.send_json({"type": "start"})
            assert "TMDB_API_KEY" in receive(ws, "error")["message"]


# --- riconnessione, uscite, espulsioni ---------------------------------------------------------


def test_player_can_come_back_mid_game_and_resume(game, tokens, client, stack):
    code, anna, luca = game
    start(anna, luca)
    anna.send_json({"type": "swipe", "movie_id": 1, "like": True})
    anna.send_json({"type": "swipe", "movie_id": 2, "like": False})
    receive_state(anna, lambda s: s["position"] == 2)
    anna.close()
    offline = receive_state(luca, lambda s: not s["players"][0]["connected"])
    assert offline["players"][0]["progress"] == 2

    back = connect(client, stack, code, token=tokens["Anna"])
    welcome = receive(back, "welcome")
    assert welcome["name"] == "Anna"
    assert [m["id"] for m in receive(back, "stack")["movies"]] == [1, 2, 3]
    state = receive_state(back)
    assert state["phase"] == "swiping" and state["position"] == 2 and state["you"] == "Anna"


def test_wrong_token_does_not_let_you_in_mid_game(game, client, stack):
    code, anna, luca = game
    start(anna, luca)
    intruder = connect(client, stack, code, name="Anna", token="indovinato")
    assert "già iniziata" in intruder.receive_json()["message"]


def test_opening_a_second_tab_replaces_the_first(game, tokens, client, stack):
    code, anna, luca = game
    second = connect(client, stack, code, token=tokens["Anna"])
    receive(second, "welcome")
    with pytest.raises(WebSocketDisconnect) as closed:
        for _ in range(10):
            anna.receive_json()
    assert closed.value.code == CLOSE_REPLACED
    state = receive_state(luca, lambda s: len(s["players"]) == 2)
    assert state["players"][0]["connected"] is True  # Anna non risulta uscita


def test_leaving_removes_the_player_and_passes_the_host(game):
    _, anna, luca = game
    anna.send_json({"type": "leave"})
    state = receive_state(luca, lambda s: len(s["players"]) == 1)
    assert state["host"] == "Luca"


def test_host_kicks_a_player(game):
    _, anna, luca = game
    anna.send_json({"type": "kick", "name": "Luca"})
    error = receive(luca, "error")
    assert error["fatal"] and "rimosso" in error["message"]
    with pytest.raises(WebSocketDisconnect) as closed:
        luca.receive_json()
    assert closed.value.code == CLOSE_KICKED
    assert len(receive_state(anna, lambda s: len(s["players"]) == 1)["players"]) == 1


def test_guest_cannot_kick_and_the_target_stays_connected(game):
    _, anna, luca = game
    luca.send_json({"type": "kick", "name": "Anna"})
    assert "Solo chi ha creato" in receive(luca, "error")["message"]
    anna.send_json({"type": "set_settings", "settings": {"limit": 7}})
    assert receive_state(anna, lambda s: s["settings"]["limit"] == 7)  # Anna riceve ancora


def test_empty_room_is_deleted_when_the_last_player_leaves(client, stack):
    room = create_room(client)
    anna = connect(client, stack, room["code"], name="Anna", token=room["token"])
    receive(anna, "welcome")
    anna.send_json({"type": "leave"})
    with pytest.raises(WebSocketDisconnect):
        for _ in range(5):
            anna.receive_json()
    assert client.get(f"/api/rooms/{room['code']}").status_code == 404


# --- film già visti ----------------------------------------------------------------------------


def test_players_declare_seen_films_and_everybody_sees_only_the_count(game):
    _, anna, luca = game
    anna.send_json({"type": "set_seen", "ids": [1, 2]})
    state = receive_state(luca, lambda s: s["players"][0]["seen"] == 2)
    assert [p["seen"] for p in state["players"]] == [2, 0]
    assert "ids" not in str(state)


def test_the_pile_skips_films_seen_by_anybody(game, fake_tmdb):
    _, anna, luca = game
    fake_tmdb.catalog = [make_details(i) for i in range(1, 8)]
    anna.send_json({"type": "set_seen", "ids": [1, 2]})
    luca.send_json({"type": "set_seen", "ids": [2, 3]})
    receive_state(luca, lambda s: s["players"][0]["seen"] == 2 and s["players"][1]["seen"] == 2)
    assert start(anna, luca) == [4, 5, 6, 7]


def test_host_can_show_seen_films_too(game, fake_tmdb):
    _, anna, luca = game
    anna.send_json({"type": "set_settings", "settings": {"exclude_seen": False}})
    anna.send_json({"type": "set_seen", "ids": [1, 2]})
    receive_state(
        luca, lambda s: s["players"][0]["seen"] == 2 and not s["settings"]["exclude_seen"]
    )
    assert start(anna, luca) == [1, 2, 3]


def test_all_films_seen_explains_why_the_pile_is_empty(game):
    _, anna, luca = game
    luca.send_json({"type": "set_seen", "ids": [1, 2, 3]})
    receive_state(anna, lambda s: s["players"][1]["seen"] == 3)
    anna.send_json({"type": "start"})
    assert "già visti" in receive(anna, "error")["message"]
    assert receive_state(luca, lambda s: s["phase"] == "lobby")


def test_a_big_list_of_seen_films_fits_in_one_message(game):
    _, anna, luca = game
    anna.send_json({"type": "set_seen", "ids": list(range(1000, 6000))})
    assert receive_state(luca, lambda s: s["players"][0]["seen"] == 5000)


def test_a_huge_list_is_rejected_without_breaking_the_connection(game):
    _, anna, _ = game
    anna.send_json({"type": "set_seen", "ids": list(range(1, MAX_SEEN + 2))})
    assert receive(anna, "error")["fatal"] is False
    anna.send_json({"type": "ping"})
    assert receive(anna, "pong")


def test_rejoining_mid_game_and_resending_seen_films_is_harmless(game, tokens, client, stack):
    code, anna, luca = game
    start(anna, luca)
    back = connect(client, stack, code, token=tokens["Luca"])
    receive(back, "welcome")
    back.send_json({"type": "set_seen", "ids": [1, 2]})
    state = receive_state(back)
    assert state["phase"] == "swiping" and state["players"][1]["seen"] == 0


# --- veti, film già proposti, partita da solo ---------------------------------------------------


def test_vetoes_are_shared_and_remove_genres_from_the_tmdb_query(game, fake_tmdb):
    _, anna, luca = game
    luca.send_json({"type": "set_vetoes", "genres": [27, 37]})
    state = receive_state(anna, lambda s: s["players"][1]["vetoes"] == [27, 37])
    assert state["players"][0]["vetoes"] == []
    start(anna, luca)
    [query] = fake_tmdb.requests_to("/discover/movie")
    assert query.url.params["without_genres"] == "27,37"


def test_new_game_in_the_same_room_does_not_repeat_films(game, fake_tmdb):
    _, anna, luca = game
    fake_tmdb.catalog = [make_details(i) for i in range(1, 6)]
    anna.send_json({"type": "set_settings", "settings": {"limit": 2}})
    receive_state(luca, lambda s: s["settings"]["limit"] == 2)
    first = start(anna, luca)
    anna.send_json({"type": "reset"})
    receive_state(luca, lambda s: s["phase"] == "lobby")
    second = start(anna, luca)
    assert len(first) == len(second) == 2
    assert not set(first) & set(second)


def test_solo_game_from_creation_to_the_list_of_liked_films(client, fake_tmdb, stack):
    fake_tmdb.catalog = [make_details(i) for i in (1, 2, 3)]
    response = client.post("/api/rooms", json={"name": "Anna", "solo": True})
    room = response.json()
    info = client.get(f"/api/rooms/{room['code']}").json()
    assert info["solo"] is True and info["joinable"] is False
    anna = connect(client, stack, room["code"], name="Anna", token=room["token"])
    receive(anna, "welcome")
    assert receive_state(anna)["solo"] is True
    anna.send_json({"type": "start"})
    movies = [m["id"] for m in receive(anna, "stack")["movies"]]
    for movie_id in movies:
        anna.send_json({"type": "swipe", "movie_id": movie_id, "like": movie_id != 2})
    final = receive_state(anna, lambda s: s["phase"] == "finished")
    assert final["matches"] == []
    assert [r["movie_id"] for r in final["results"]] == [1, 3]


def test_nobody_can_join_a_solo_game(client, stack):
    room = client.post("/api/rooms", json={"name": "Anna", "solo": True}).json()
    other = connect(client, stack, room["code"], name="Luca")
    error = other.receive_json()
    assert error["fatal"] and "da solo" in error["message"]
