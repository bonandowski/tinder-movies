"""Trasporto WebSocket: collega i messaggi dei client alla logica di `Room`.

Tutta la logica sta in `rooms.py`. Qui si ascolta, si chiama la stanza e si avvisano i giocatori.
Gli handler girano su un solo event loop: tra un `await` e l'altro lo stato non cambia sotto i
piedi, quindi i messaggi di una risposta vengono costruiti tutti prima di inviarne uno.
"""

import asyncio
import contextlib
import logging
from collections.abc import Callable

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError

from app.models import Movie
from app.protocol import (
    Error,
    Finish,
    Join,
    Kick,
    Leave,
    MatchFound,
    Ping,
    Pong,
    Reset,
    SetSettings,
    Stack,
    Start,
    Swipe,
    Welcome,
    client_message_adapter,
)
from app.rooms import Room, RoomError, RoomManager
from app.tmdb import TMDBClient, TMDBError

log = logging.getLogger(__name__)

JOIN_TIMEOUT = 10.0  # secondi per mandare il messaggio di join dopo la connessione
MAX_MESSAGE_SIZE = 4096

# Codici di chiusura (4000-4999 sono riservati alle applicazioni).
CLOSE_BAD_REQUEST = 4400
CLOSE_NOT_FOUND = 4404
CLOSE_REFUSED = 4403
CLOSE_REPLACED = 4409  # lo stesso giocatore si è collegato da un'altra scheda
CLOSE_KICKED = 4410


async def _send(ws: WebSocket, message: BaseModel) -> None:
    """Invia un messaggio; se il socket è già chiuso non è un problema (lo gestisce il loop)."""
    with contextlib.suppress(Exception):
        await ws.send_text(message.model_dump_json())


class Hub:
    def __init__(self, rooms: RoomManager) -> None:
        self.rooms = rooms
        self._sockets: dict[str, dict[str, WebSocket]] = {}  # codice -> nome -> socket

    async def serve(self, ws: WebSocket, code: str, tmdb: TMDBClient | None) -> None:
        await ws.accept()
        room = self.rooms.get(code)
        if room is None:
            await self._refuse(ws, "Stanza non trovata", CLOSE_NOT_FOUND)
            return
        try:
            name = await self._join(ws, room)
        except RoomError as exc:
            await self._refuse(ws, str(exc), CLOSE_REFUSED)
            return
        except (WebSocketDisconnect, TimeoutError, ValueError, ValidationError):
            await self._refuse(ws, "Primo messaggio non valido", CLOSE_BAD_REQUEST)
            return

        left = False
        try:
            while True:
                text = await ws.receive_text()
                if len(text) > MAX_MESSAGE_SIZE:
                    await _send(ws, Error(message="Messaggio troppo grande"))
                    continue
                try:
                    message = client_message_adapter.validate_json(text)
                except ValidationError:
                    await _send(ws, Error(message="Messaggio non valido"))
                    continue
                if isinstance(message, Leave):
                    left = True
                    break
                try:
                    await self._handle(room, name, ws, message, tmdb)
                except RoomError as exc:
                    await _send(ws, Error(message=str(exc)))
                except WebSocketDisconnect:
                    raise
                except Exception:
                    log.exception("Errore imprevisto nella stanza %s", room.code)
                    await _send(ws, Error(message="Errore imprevisto, riprova"))
        except WebSocketDisconnect:
            pass
        finally:
            await self._detach(room, name, ws, left)

    # --- connessione ------------------------------------------------------------------------

    async def _join(self, ws: WebSocket, room: Room) -> str:
        text = await asyncio.wait_for(ws.receive_text(), JOIN_TIMEOUT)
        if len(text) > MAX_MESSAGE_SIZE:
            raise ValueError("messaggio troppo grande")
        message = client_message_adapter.validate_json(text)
        if not isinstance(message, Join):
            raise ValueError("il primo messaggio deve essere join")

        player = room.find_by_token(message.token) if message.token else None
        if player is None:
            player = room.add_player(message.name)  # solo in lobby, altrimenti RoomError
        name = player.name

        sockets = self._sockets.setdefault(room.code, {})
        previous = sockets.get(name)
        sockets[name] = ws
        room.set_connected(name, True)
        if previous is not None:
            await self._close_quietly(previous, CLOSE_REPLACED, "Collegato da un'altra scheda")

        await _send(ws, Welcome(code=room.code, name=name, token=player.token))
        if room.movies:  # rientro a partita in corso: serve la pila
            await _send(ws, self._stack(room))
        await self._broadcast_state(room)
        return name

    async def _detach(self, room: Room, name: str, ws: WebSocket, left: bool) -> None:
        sockets = self._sockets.get(room.code, {})
        if sockets.get(name) is ws:
            del sockets[name]
            if left:
                new_matches = room.remove_player(name)
            else:
                room.set_connected(name, False)
                new_matches = []
            if room.players:
                await self._after_change(room, new_matches)
            else:  # l'ultimo se n'è andato
                self.rooms.delete(room.code)
                self._sockets.pop(room.code, None)
        # altrimenti un'altra scheda ha preso il posto: il giocatore è ancora lì
        with contextlib.suppress(Exception):
            await ws.close()

    async def _refuse(self, ws: WebSocket, message: str, close_code: int) -> None:
        await _send(ws, Error(message=message, fatal=True))
        await self._close_quietly(ws, close_code, message)

    @staticmethod
    async def _close_quietly(ws: WebSocket, code: int, reason: str) -> None:
        with contextlib.suppress(Exception):
            await ws.close(code=code, reason=reason)

    # --- azioni -----------------------------------------------------------------------------

    async def _handle(
        self, room: Room, name: str, ws: WebSocket, message: BaseModel, tmdb: TMDBClient | None
    ) -> None:
        match message:
            case SetSettings():
                room.set_settings(name, message.settings)
                await self._broadcast_state(room)
            case Start():
                await self._start(room, name, tmdb)
            case Swipe():
                new_matches = room.swipe(name, message.movie_id, message.like)
                await self._after_change(room, new_matches)
            case Finish():
                room.finish(name)
                await self._broadcast_state(room)
            case Reset():
                room.reset(name)
                await self._broadcast_state(room)
            case Kick():
                new_matches = room.kick(name, message.name)
                socket = self._sockets.get(room.code, {}).pop(message.name, None)
                if socket is not None:
                    await _send(socket, Error(message="Sei stato rimosso dalla stanza", fatal=True))
                    await self._close_quietly(socket, CLOSE_KICKED, "Rimosso")
                await self._after_change(room, new_matches)
            case Ping():
                await _send(ws, Pong())

    async def _start(self, room: Room, name: str, tmdb: TMDBClient | None) -> None:
        if tmdb is None:
            raise RoomError("Il server non ha la chiave TMDB (TMDB_API_KEY): vedi README")
        settings = room.begin_loading(name)
        await self._broadcast_state(room)  # i client mostrano "carico i film…"
        try:
            movies = await tmdb.movies(settings, settings.limit)
            room.finish_loading(movies)
        except Exception as exc:
            room.abort_loading()  # nessun effetto se finish_loading è già tornato in lobby
            await self._broadcast_state(room)
            if isinstance(exc, RoomError | TMDBError):
                raise RoomError(str(exc)) from exc
            log.exception("Errore imprevisto nel caricamento film della stanza %s", room.code)
            raise RoomError("Errore imprevisto nel caricare i film, riprova") from exc
        await self._broadcast(room, lambda _: self._stack(room))
        await self._broadcast_state(room)

    # --- invio ------------------------------------------------------------------------------

    @staticmethod
    def _stack(room: Room) -> Stack:
        return Stack(movies=room.movies)

    async def _after_change(self, room: Room, new_matches: list[Movie]) -> None:
        await self._broadcast_state(room)
        for movie in new_matches:
            await self._broadcast(room, lambda _, m=movie: MatchFound(movie_id=m.id))

    async def _broadcast_state(self, room: Room) -> None:
        await self._broadcast(room, room.state_for)

    async def _broadcast(self, room: Room, make_message: Callable[[str], BaseModel]) -> None:
        """Manda a ogni giocatore collegato il messaggio costruito per lui da `make_message`."""
        sockets = self._sockets.get(room.code, {})
        outgoing = [
            (ws, make_message(name)) for name, ws in sockets.items() if name in room.players
        ]
        await asyncio.gather(*(_send(ws, message) for ws, message in outgoing))
