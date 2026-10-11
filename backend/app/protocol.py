"""Messaggi scambiati via WebSocket tra client e server (JSON, campo `type` come discriminante)."""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.models import Movie, StackSettings


class Phase(StrEnum):
    LOBBY = "lobby"  # si entra e si scelgono i filtri
    LOADING = "loading"  # l'host ha premuto Inizia, stiamo chiedendo i film a TMDB
    SWIPING = "swiping"  # si vota
    FINISHED = "finished"  # tutti hanno finito (o l'host ha chiuso): risultati


# --- Client -> server -------------------------------------------------------------------------


class Join(BaseModel):
    """Primo messaggio. Con `token` si rientra come lo stesso giocatore (es. dopo un refresh)."""

    type: Literal["join"] = "join"
    name: str = ""
    token: str | None = None


class SetSettings(BaseModel):
    type: Literal["set_settings"] = "set_settings"
    settings: StackSettings


class Start(BaseModel):
    type: Literal["start"] = "start"


class Swipe(BaseModel):
    type: Literal["swipe"] = "swipe"
    movie_id: int
    like: bool


class Finish(BaseModel):
    """Solo host: chiude subito la votazione e mostra i risultati."""

    type: Literal["finish"] = "finish"


class Reset(BaseModel):
    """Solo host: torna alla lobby (nuova pila, nuovi filtri)."""

    type: Literal["reset"] = "reset"


class Kick(BaseModel):
    """Solo host: toglie un giocatore dalla stanza."""

    type: Literal["kick"] = "kick"
    name: str


class Leave(BaseModel):
    type: Literal["leave"] = "leave"


class Ping(BaseModel):
    type: Literal["ping"] = "ping"


ClientMessage = Annotated[
    Join | SetSettings | Start | Swipe | Finish | Reset | Kick | Leave | Ping,
    Field(discriminator="type"),
]
client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


# --- Server -> client -------------------------------------------------------------------------


class Welcome(BaseModel):
    """Risposta al join. `token` va conservato per rientrare come lo stesso giocatore."""

    type: Literal["welcome"] = "welcome"
    code: str
    name: str
    token: str


class PlayerInfo(BaseModel):
    name: str
    is_host: bool
    connected: bool
    progress: int = Field(description="Quanti film ha già votato")
    done: bool = Field(description="Ha votato tutta la pila")


class Result(BaseModel):
    movie_id: int
    likes: int
    liked_by: list[str]


class RoomState(BaseModel):
    """Fotografia della stanza dal punto di vista di un giocatore. Sostituisce la precedente."""

    type: Literal["state"] = "state"
    code: str
    phase: Phase
    you: str = Field(description="Il tuo nome (unico nella stanza)")
    host: str
    players: list[PlayerInfo]
    settings: StackSettings
    total: int = Field(description="Film nella pila (0 prima dell'inizio)")
    position: int = Field(description="Indice del prossimo film che devi votare")
    matches: list[int] = Field(description="Film piaciuti a tutti, in ordine di pila")
    results: list[Result] | None = Field(
        None, description="Classifica per numero di like: solo a fine partita"
    )


class Stack(BaseModel):
    """La pila di film, uguale per tutti. Arriva all'inizio e a chi rientra a partita in corso."""

    type: Literal["stack"] = "stack"
    movies: list[Movie]


class MatchFound(BaseModel):
    type: Literal["match"] = "match"
    movie_id: int


class Error(BaseModel):
    type: Literal["error"] = "error"
    message: str
    fatal: bool = Field(False, description="Se true il server chiude la connessione")


class Pong(BaseModel):
    type: Literal["pong"] = "pong"
