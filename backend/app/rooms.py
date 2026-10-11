"""Logica delle stanze: nessun I/O e nessun asyncio, così si testa con semplici chiamate.

Regole in breve:
- i giocatori si identificano per nome (unico nella stanza); il `token` segreto serve a rientrare;
- si entra solo in lobby; a partita iniziata si può solo rientrare con il proprio token;
- la pila di film è unica e uguale per tutti; ognuno vota nel suo ordine e al suo ritmo;
- un film è un *match* quando tutti i giocatori presenti gli hanno detto sì (servono almeno
  MIN_PLAYERS giocatori); i match sono derivati dai voti, non memorizzati;
- si finisce quando tutti hanno votato tutta la pila, o quando l'host chiude;
- la pila non ripropone film già visti da qualcuno (se l'host non lo spegne) né film già proposti
  in una partita precedente della stessa stanza; i generi vietati da qualcuno non ci sono;
- una stanza "solo" ha un solo giocatore: si avvia da soli e non ci sono match.
"""

import hmac
import re
import secrets
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from app.models import Movie, RoomSettings
from app.protocol import Phase, PlayerInfo, Result, RoomState

MIN_PLAYERS = 2
MAX_PLAYERS = 10
MAX_NAME_LENGTH = 20
MAX_ROOMS = 500
ROOM_TTL = 3 * 3600  # secondi senza nessuno collegato prima di eliminare la stanza
CODE_LENGTH = 4
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # niente I, O, 0, 1: il codice si detta a voce


class RoomError(Exception):
    """Azione non consentita. Il messaggio è pensato per essere mostrato all'utente."""


class TooManyRooms(RoomError):
    """Il server ha raggiunto il numero massimo di stanze."""


@dataclass
class Player:
    name: str
    token: str = field(default_factory=lambda: secrets.token_urlsafe(16), repr=False)
    votes: dict[int, bool] = field(default_factory=dict)  # movie_id -> ha detto sì?
    connected: bool = False
    seen: set[int] = field(default_factory=set)  # id TMDB dei film già visti (da Letterboxd)
    vetoes: set[int] = field(default_factory=set)  # generi che questo giocatore non vuole


def clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", raw)).strip()
    if not name:
        raise RoomError("Scrivi il tuo nome")
    return name[:MAX_NAME_LENGTH].strip()


class Room:
    def __init__(
        self,
        code: str,
        host_name: str,
        clock: Callable[[], float] = time.monotonic,
        solo: bool = False,
    ) -> None:
        self.code = code
        self.solo = solo
        self.shown: set[int] = set()  # film già proposti in questa stanza
        self.phase = Phase.LOBBY
        self.settings = RoomSettings()
        self.movies: list[Movie] = []
        self.players: dict[str, Player] = {}  # per nome, in ordine di arrivo
        self.host = ""
        self._clock = clock
        self._announced: set[int] = set()  # match già comunicati
        self.last_activity = clock()
        self.add_player(host_name)

    # --- giocatori --------------------------------------------------------------------------

    def touch(self) -> None:
        self.last_activity = self._clock()

    def is_idle(self, ttl: float = ROOM_TTL) -> bool:
        no_one_here = not any(p.connected for p in self.players.values())
        return no_one_here and self._clock() - self.last_activity > ttl

    def add_player(self, name: str) -> Player:
        if self.phase is not Phase.LOBBY:
            raise RoomError("La partita è già iniziata")
        if self.solo and self.players:
            raise RoomError("È una partita da solo: non si può entrare")
        if len(self.players) >= MAX_PLAYERS:
            raise RoomError("La stanza è piena")
        base = clean_name(name)
        unique, n = base, 2
        while unique in self.players:
            unique, n = f"{base} {n}", n + 1
        player = Player(unique)
        self.players[unique] = player
        if not self.host:
            self.host = unique
        self.touch()
        return player

    def find_by_token(self, token: str) -> Player | None:
        for player in self.players.values():
            if hmac.compare_digest(player.token, token):
                return player
        return None

    def set_connected(self, name: str, connected: bool) -> None:
        if name in self.players:
            self.players[name].connected = connected
            self.touch()

    def remove_player(self, name: str) -> list[Movie]:
        """Toglie un giocatore. Restituisce i match nuovi (ne servono meno voti, ora)."""
        if name not in self.players:
            return []
        del self.players[name]
        if self.host == name:
            heirs = sorted(self.players.values(), key=lambda p: not p.connected)  # stabile
            self.host = heirs[0].name if heirs else ""
        self.touch()
        if self.phase is Phase.SWIPING:
            return self._advance()
        return []

    def kick(self, host: str, target: str) -> list[Movie]:
        self._require_host(host)
        if target == host:
            raise RoomError("Non puoi togliere te stesso: usa Esci")
        if target not in self.players:
            raise RoomError("Giocatore non trovato")
        return self.remove_player(target)

    # --- avvio ------------------------------------------------------------------------------

    def set_settings(self, name: str, settings: RoomSettings) -> None:
        self._require_host(name)
        if self.phase is not Phase.LOBBY:
            raise RoomError("I filtri si cambiano solo in lobby")
        self.settings = settings
        self.touch()

    def set_seen(self, name: str, ids: Iterable[int]) -> None:
        """Sostituisce i film già visti da questo giocatore.

        Dopo l'inizio non fa nulla (la pila è già decisa): così chi rientra a partita in corso e
        rimanda il suo elenco non riceve errori.
        """
        player = self._player(name)
        if self.phase is Phase.LOBBY:
            player.seen = set(ids)
            self.touch()

    def set_vetoes(self, name: str, genres: Iterable[int]) -> None:
        """Generi che questo giocatore non vuole vedere. Come `set_seen`: conta solo in lobby."""
        player = self._player(name)
        if self.phase is Phase.LOBBY:
            player.vetoes = set(genres)
            self.touch()

    def vetoed_genres(self) -> set[int]:
        return set().union(*(p.vetoes for p in self.players.values()))

    def seen_ids(self) -> set[int]:
        """Film visti da almeno uno dei giocatori (se l'host non ha scelto di mostrarli)."""
        if not self.settings.exclude_seen:
            return set()
        return set().union(*(p.seen for p in self.players.values()))

    def excluded_ids(self) -> set[int]:
        """Film da non proporre: visti da qualcuno o già proposti in questa stanza."""
        return self.seen_ids() | self.shown

    def begin_loading(self, name: str) -> RoomSettings:
        """L'host preme Inizia. Chi non è collegato viene lasciato fuori dalla partita."""
        self._require_host(name)
        if self.phase is not Phase.LOBBY:
            raise RoomError("La partita è già iniziata")
        online = [p.name for p in self.players.values() if p.connected]
        needed = 1 if self.solo else MIN_PLAYERS
        if len(online) < needed:
            raise RoomError(f"Servono almeno {needed} giocatori collegati")
        vetoed = {g for n, p in self.players.items() if n in online for g in p.vetoes}
        wanted = [g for g in self.settings.genres if g not in vetoed]
        if self.settings.genres and not wanted:
            raise RoomError("Tutti i generi scelti sono stati vietati: cambiate i generi o i veti")
        self.players = {n: p for n, p in self.players.items() if n in online}
        self.phase = Phase.LOADING
        self.touch()
        # I filtri che contano davvero: i veti di chiunque tolgono quei generi.
        return self.settings.model_copy(
            update={
                "genres": wanted,
                "exclude_genres": sorted(set(self.settings.exclude_genres) | vetoed),
            },
            deep=True,
        )

    def abort_loading(self) -> None:
        if self.phase is Phase.LOADING:
            self.phase = Phase.LOBBY

    def finish_loading(self, movies: list[Movie]) -> None:
        if self.phase is not Phase.LOADING:
            raise RoomError("Nessun caricamento in corso")
        if not movies:
            self.phase = Phase.LOBBY
            if self.excluded_ids():
                raise RoomError(
                    "Nessun film trovato: i filtri sono troppo stretti, o i film adatti li avete "
                    "già visti o già avuti in questa stanza. Allarga i filtri o mostra anche i "
                    "film già visti"
                )
            raise RoomError("Nessun film trovato con questi filtri: provane di meno restrittivi")
        self._reset_votes()
        self.movies = movies
        self.shown.update(m.id for m in movies)
        self.phase = Phase.SWIPING
        self.touch()

    # --- votazione --------------------------------------------------------------------------

    def swipe(self, name: str, movie_id: int, like: bool) -> list[Movie]:
        """Registra un voto. Restituisce i match che con questo voto sono comparsi."""
        if self.phase is not Phase.SWIPING:
            raise RoomError("Adesso non si sta votando")
        player = self._player(name)
        if all(m.id != movie_id for m in self.movies):
            raise RoomError("Film sconosciuto")
        if movie_id in player.votes:
            return []  # doppio tap o messaggio ripetuto: vale il primo voto
        player.votes[movie_id] = like
        self.touch()
        return self._advance()

    def finish(self, name: str) -> None:
        self._require_host(name)
        if self.phase is not Phase.SWIPING:
            raise RoomError("Adesso non si sta votando")
        self.phase = Phase.FINISHED
        self.touch()

    def reset(self, name: str) -> None:
        """Torna alla lobby con gli stessi giocatori e gli stessi filtri."""
        self._require_host(name)
        if self.phase not in (Phase.SWIPING, Phase.FINISHED):
            raise RoomError("C'è già la lobby")
        self.movies = []
        self._reset_votes()
        self.phase = Phase.LOBBY
        self.touch()

    # --- risultati --------------------------------------------------------------------------

    def matches(self) -> list[Movie]:
        """Film piaciuti a tutti i giocatori presenti, nell'ordine della pila."""
        if len(self.players) < MIN_PLAYERS:
            return []
        return [m for m in self.movies if all(p.votes.get(m.id) for p in self.players.values())]

    def ranking(self) -> list[Result]:
        """Film con almeno un like: più like prima, a parità vince chi è più su nella pila.

        Se non c'è nessun match, i primi sono i "meno peggio".
        """
        results = []
        for movie in self.movies:
            likers = [p.name for p in self.players.values() if p.votes.get(movie.id)]
            if likers:
                results.append(Result(movie_id=movie.id, likes=len(likers), liked_by=likers))
        return sorted(results, key=lambda r: -r.likes)  # sorted è stabile: l'ordine pila resta

    def state_for(self, name: str) -> RoomState:
        total = len(self.movies)
        me = self._player(name)
        voted_ids = set(me.votes)
        position = next((i for i, m in enumerate(self.movies) if m.id not in voted_ids), total)
        return RoomState(
            code=self.code,
            solo=self.solo,
            phase=self.phase,
            you=name,
            host=self.host,
            players=[
                PlayerInfo(
                    name=p.name,
                    is_host=p.name == self.host,
                    connected=p.connected,
                    progress=len(p.votes),
                    done=total > 0 and len(p.votes) >= total,
                    seen=len(p.seen),
                    vetoes=sorted(p.vetoes),
                )
                for p in self.players.values()
            ],
            settings=self.settings,
            total=total,
            position=position,
            matches=[m.id for m in self.matches()],
            results=self.ranking() if self.phase is Phase.FINISHED else None,
        )

    # --- interni ----------------------------------------------------------------------------

    def _player(self, name: str) -> Player:
        player = self.players.get(name)
        if player is None:
            raise RoomError("Non sei in questa stanza")
        return player

    def _require_host(self, name: str) -> None:
        self._player(name)
        if name != self.host:
            raise RoomError("Solo chi ha creato la stanza può farlo")

    def _reset_votes(self) -> None:
        for player in self.players.values():
            player.votes.clear()
        self._announced.clear()

    def _everyone_done(self) -> bool:
        return bool(self.movies) and all(
            len(p.votes) >= len(self.movies) for p in self.players.values()
        )

    def _advance(self) -> list[Movie]:
        """Dopo un voto o un'uscita: match nuovi e, se tutti hanno finito, fine partita."""
        fresh = [m for m in self.matches() if m.id not in self._announced]
        self._announced.update(m.id for m in fresh)
        if self.players and self._everyone_done():
            self.phase = Phase.FINISHED
        return fresh


class RoomManager:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._rooms: dict[str, Room] = {}

    def __len__(self) -> int:
        return len(self._rooms)

    def create(self, host_name: str, solo: bool = False) -> Room:
        self.purge_idle()
        if len(self._rooms) >= MAX_ROOMS:
            raise TooManyRooms("Ci sono troppe stanze attive, riprova tra poco")
        code = self._new_code()
        room = Room(code, host_name, self._clock, solo=solo)
        self._rooms[code] = room
        return room

    def get(self, code: str) -> Room | None:
        return self._rooms.get(code.strip().upper())

    def delete(self, code: str) -> None:
        self._rooms.pop(code, None)

    def purge_idle(self) -> int:
        idle = [code for code, room in self._rooms.items() if room.is_idle()]
        for code in idle:
            del self._rooms[code]
        return len(idle)

    def _new_code(self) -> str:
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self._rooms:
                return code
