import pytest

from app.models import Movie, StackSettings
from app.protocol import Phase
from app.rooms import (
    MAX_NAME_LENGTH,
    MAX_PLAYERS,
    MAX_ROOMS,
    MIN_PLAYERS,
    ROOM_TTL,
    Room,
    RoomError,
    RoomManager,
    TooManyRooms,
)


def movie(movie_id: int) -> Movie:
    return Movie(
        id=movie_id,
        title=f"Film {movie_id}",
        poster_url="https://image.tmdb.org/t/p/w500/p.jpg",
        overview="",
        rating=7.0,
        providers=[],
    )


def started_room(names=("Anna", "Luca"), movie_ids=(1, 2, 3)) -> Room:
    """Stanza già in votazione: il primo nome è l'host, tutti collegati."""
    room = Room("ABCD", names[0])
    for name in names[1:]:
        room.add_player(name)
    for player in room.players.values():
        player.connected = True
    room.begin_loading(names[0])
    room.finish_loading([movie(i) for i in movie_ids])
    return room


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


# --- giocatori ---------------------------------------------------------------------------------


def test_creator_is_host_and_starts_in_lobby():
    room = Room("ABCD", "Anna")
    assert room.host == "Anna"
    assert room.phase is Phase.LOBBY
    assert list(room.players) == ["Anna"]


def test_names_are_cleaned_and_made_unique():
    room = Room("ABCD", "  Anna   Maria \n")
    assert "Anna Maria" in room.players
    assert room.add_player("Anna Maria").name == "Anna Maria 2"
    assert room.add_player("Anna Maria").name == "Anna Maria 3"
    long_name = room.add_player("x" * 100).name
    assert len(long_name) == MAX_NAME_LENGTH


@pytest.mark.parametrize("bad", ["", "   ", "\n\t"])
def test_blank_name_is_refused(bad):
    with pytest.raises(RoomError, match="nome"):
        Room("ABCD", bad)


def test_room_has_a_player_limit():
    room = Room("ABCD", "p0")
    for i in range(1, MAX_PLAYERS):
        room.add_player(f"p{i}")
    with pytest.raises(RoomError, match="piena"):
        room.add_player("uno di troppo")


def test_nobody_new_can_join_once_started_but_token_still_works():
    room = started_room()
    with pytest.raises(RoomError, match="già iniziata"):
        room.add_player("Marta")
    luca = room.players["Luca"]
    assert room.find_by_token(luca.token) is luca
    assert room.find_by_token("sbagliato") is None


# --- avvio -------------------------------------------------------------------------------------


def test_only_host_changes_settings_and_only_in_lobby():
    room = Room("ABCD", "Anna")
    room.add_player("Luca")
    settings = StackSettings(genres=[35], limit=10)
    with pytest.raises(RoomError, match="Solo chi ha creato"):
        room.set_settings("Luca", settings)
    room.set_settings("Anna", settings)
    assert room.settings.genres == [35]

    started = started_room()
    with pytest.raises(RoomError, match="solo in lobby"):
        started.set_settings("Anna", settings)


def test_start_needs_enough_connected_players():
    room = Room("ABCD", "Anna")
    room.add_player("Luca")
    room.players["Anna"].connected = True  # Luca è nella lista ma non collegato
    with pytest.raises(RoomError, match=str(MIN_PLAYERS)):
        room.begin_loading("Anna")
    assert room.phase is Phase.LOBBY


def test_start_leaves_disconnected_players_out():
    room = Room("ABCD", "Anna")
    for name in ("Luca", "Marta"):
        room.add_player(name)
    room.players["Anna"].connected = room.players["Luca"].connected = True
    room.begin_loading("Anna")
    assert list(room.players) == ["Anna", "Luca"]
    assert room.phase is Phase.LOADING


def test_only_host_can_start():
    room = Room("ABCD", "Anna")
    room.add_player("Luca")
    for player in room.players.values():
        player.connected = True
    with pytest.raises(RoomError, match="Solo chi ha creato"):
        room.begin_loading("Luca")


def test_empty_stack_sends_everyone_back_to_the_lobby():
    room = Room("ABCD", "Anna")
    room.add_player("Luca")
    for player in room.players.values():
        player.connected = True
    room.begin_loading("Anna")
    with pytest.raises(RoomError, match="Nessun film"):
        room.finish_loading([])
    assert room.phase is Phase.LOBBY


def test_abort_loading_returns_to_lobby():
    room = Room("ABCD", "Anna")
    room.add_player("Luca")
    for player in room.players.values():
        player.connected = True
    room.begin_loading("Anna")
    room.abort_loading()
    assert room.phase is Phase.LOBBY


# --- voti e match ------------------------------------------------------------------------------


def test_match_appears_when_the_last_player_agrees():
    room = started_room()
    assert room.swipe("Anna", 1, True) == []
    [match] = room.swipe("Luca", 1, True)
    assert match.id == 1
    assert [m.id for m in room.matches()] == [1]


def test_no_match_if_somebody_says_no():
    room = started_room()
    room.swipe("Anna", 1, True)
    assert room.swipe("Luca", 1, False) == []
    assert room.matches() == []


def test_match_needs_every_player_not_just_two():
    room = started_room(("Anna", "Luca", "Marta"))
    room.swipe("Anna", 1, True)
    assert room.swipe("Luca", 1, True) == []
    assert [m.id for m in room.swipe("Marta", 1, True)] == [1]


def test_a_match_is_announced_only_once():
    room = started_room()
    room.swipe("Anna", 1, True)
    room.swipe("Luca", 1, True)
    assert room.swipe("Anna", 1, False) == []  # voto doppio ignorato: il primo vale
    assert [m.id for m in room.matches()] == [1]


def test_players_vote_in_their_own_order_and_pace():
    room = started_room()
    room.swipe("Anna", 3, True)
    room.swipe("Anna", 1, True)
    room.swipe("Luca", 1, True)
    [match] = room.swipe("Luca", 3, True)
    assert match.id == 3
    assert [m.id for m in room.matches()] == [1, 3]  # ordine di pila


def test_swipe_errors():
    room = started_room()
    with pytest.raises(RoomError, match="sconosciuto"):
        room.swipe("Anna", 99, True)
    with pytest.raises(RoomError, match="Non sei"):
        room.swipe("Fantasma", 1, True)
    lobby = Room("ABCD", "Anna")
    with pytest.raises(RoomError, match="non si sta votando"):
        lobby.swipe("Anna", 1, True)


def test_game_finishes_when_everyone_has_voted_everything():
    room = started_room(movie_ids=(1, 2))
    for movie_id in (1, 2):
        room.swipe("Anna", movie_id, True)
    assert room.phase is Phase.SWIPING  # Luca non ha ancora votato
    room.swipe("Luca", 1, False)
    room.swipe("Luca", 2, True)
    assert room.phase is Phase.FINISHED


def test_a_single_player_finishing_does_not_end_the_game():
    room = started_room()
    for movie_id in (1, 2, 3):
        room.swipe("Anna", movie_id, True)
    assert room.phase is Phase.SWIPING
    state = room.state_for("Anna")
    assert state.position == 3
    assert [(p.name, p.done) for p in state.players] == [("Anna", True), ("Luca", False)]


def test_host_can_close_voting_early():
    room = started_room()
    with pytest.raises(RoomError, match="Solo chi ha creato"):
        room.finish("Luca")
    room.finish("Anna")
    assert room.phase is Phase.FINISHED


# --- classifica ("meno peggio") ----------------------------------------------------------------


def test_ranking_orders_by_likes_then_by_stack_order_and_skips_zero():
    room = started_room(("Anna", "Luca", "Marta"), movie_ids=(1, 2, 3, 4))
    votes = {
        "Anna": {1: True, 2: True, 3: True, 4: False},
        "Luca": {1: False, 2: True, 3: False, 4: False},
        "Marta": {1: True, 2: False, 3: False, 4: False},
    }
    for name, player_votes in votes.items():
        for movie_id, like in player_votes.items():
            room.swipe(name, movie_id, like)
    assert room.phase is Phase.FINISHED
    assert room.matches() == []
    ranking = room.ranking()
    assert [(r.movie_id, r.likes) for r in ranking] == [(1, 2), (2, 2), (3, 1)]
    assert ranking[0].liked_by == ["Anna", "Marta"]
    assert room.state_for("Luca").results == ranking


def test_results_are_hidden_until_the_end():
    room = started_room()
    room.swipe("Anna", 1, True)
    assert room.state_for("Anna").results is None


def test_matches_come_first_in_the_ranking():
    room = started_room(movie_ids=(1, 2))
    room.swipe("Anna", 1, True)
    room.swipe("Anna", 2, True)
    room.swipe("Luca", 1, False)
    room.swipe("Luca", 2, True)
    assert [(r.movie_id, r.likes) for r in room.ranking()] == [(2, 2), (1, 1)]
    assert room.state_for("Anna").matches == [2]


# --- uscite ------------------------------------------------------------------------------------


def test_host_leaving_passes_the_room_to_a_connected_player():
    room = started_room(("Anna", "Luca", "Marta"))
    room.players["Luca"].connected = False
    room.remove_player("Anna")
    assert room.host == "Marta"


def test_leaving_can_create_new_matches():
    room = started_room(("Anna", "Luca", "Marta"))
    room.swipe("Anna", 1, True)
    room.swipe("Luca", 1, True)
    room.swipe("Marta", 1, False)
    assert room.matches() == []
    [match] = room.remove_player("Marta")
    assert match.id == 1


def test_leaving_can_finish_the_game():
    room = started_room(("Anna", "Luca", "Marta"), movie_ids=(1,))
    room.swipe("Anna", 1, True)
    room.swipe("Luca", 1, True)
    assert room.phase is Phase.SWIPING
    room.remove_player("Marta")
    assert room.phase is Phase.FINISHED


def test_no_matches_with_a_single_player_left():
    room = started_room()
    room.swipe("Anna", 1, True)
    room.swipe("Luca", 1, True)
    room.remove_player("Luca")
    assert room.matches() == []


def test_kick_rules():
    room = started_room(("Anna", "Luca", "Marta"))
    with pytest.raises(RoomError, match="Solo chi ha creato"):
        room.kick("Luca", "Marta")
    with pytest.raises(RoomError, match="te stesso"):
        room.kick("Anna", "Anna")
    with pytest.raises(RoomError, match="non trovato"):
        room.kick("Anna", "Fantasma")
    room.kick("Anna", "Marta")
    assert list(room.players) == ["Anna", "Luca"]


def test_reset_goes_back_to_lobby_with_same_players_and_settings():
    room = started_room()
    room.swipe("Anna", 1, True)
    room.settings = StackSettings(genres=[35])
    room.reset("Anna")
    assert room.phase is Phase.LOBBY
    assert room.movies == []
    assert all(not p.votes for p in room.players.values())
    assert room.settings.genres == [35]
    assert list(room.players) == ["Anna", "Luca"]


def test_after_reset_a_new_game_can_find_the_same_match_again():
    room = started_room()
    room.swipe("Anna", 1, True)
    room.swipe("Luca", 1, True)
    room.reset("Anna")
    room.begin_loading("Anna")
    room.finish_loading([movie(1), movie(2)])
    room.swipe("Anna", 1, True)
    assert [m.id for m in room.swipe("Luca", 1, True)] == [1]


# --- manager -----------------------------------------------------------------------------------


def test_codes_are_short_unambiguous_and_unique():
    manager = RoomManager()
    codes = {manager.create("Anna").code for _ in range(200)}
    assert len(codes) == 200
    for code in codes:
        assert len(code) == 4
        assert not set(code) & set("IO01")


def test_lookup_ignores_case_and_spaces():
    manager = RoomManager()
    room = manager.create("Anna")
    assert manager.get(f" {room.code.lower()} ") is room
    assert manager.get("ZZZZ") is None


def test_idle_rooms_are_purged_but_not_ones_with_people_in_them():
    clock = Clock()
    manager = RoomManager(clock)
    abandoned = manager.create("Anna")
    occupied = manager.create("Luca")
    occupied.players["Luca"].connected = True
    clock.now += ROOM_TTL + 1
    assert manager.purge_idle() == 1
    assert manager.get(abandoned.code) is None
    assert manager.get(occupied.code) is occupied


def test_room_limit():
    manager = RoomManager()
    for _ in range(MAX_ROOMS):
        manager.create("Anna")
    with pytest.raises(TooManyRooms):
        manager.create("Anna")
