from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, model_validator


class Provider(BaseModel):
    id: int
    name: str
    logo_url: str | None = None


class Genre(BaseModel):
    id: int
    name: str


class Movie(BaseModel):
    id: int
    title: str
    poster_url: str
    overview: str
    runtime: int | None = Field(None, description="Durata in minuti, se nota")
    rating: float = Field(description="Voto medio TMDB, 0-10")
    year: int | None = None
    providers: list[Provider] = Field(description="Piattaforme in abbonamento in Italia")


class Theme(BaseModel):
    """Un tema (parola chiave TMDB) con il nome in italiano."""

    id: int
    name: str


class StackKind(StrEnum):
    """Che pila costruire: decide ordine e soglie di voto."""

    POPULAR = "popular"  # i più visti adesso (come prima)
    TOP_RATED = "top_rated"  # voto alto, con tanti voti
    RECENT = "recent"  # dal più recente
    HIDDEN_GEMS = "hidden_gems"  # voto alto ma poco conosciuti


LanguageCode = Annotated[str, Field(pattern=r"^[a-z]{2}$")]


class MovieFilters(BaseModel):
    """Filtri della pila. Lista vuota / None = nessun vincolo."""

    kind: StackKind = Field(StackKind.POPULAR, description="Tipo di pila")

    platforms: list[int] = Field(
        default_factory=list, max_length=50, description="ID provider TMDB (OR)"
    )
    genres: list[int] = Field(
        default_factory=list, max_length=50, description="ID generi TMDB (OR)"
    )
    exclude_genres: list[int] = Field(
        default_factory=list, max_length=50, description="ID generi da escludere (basta uno)"
    )
    year_min: int | None = Field(None, ge=1900, le=2100, description="Anno di uscita minimo")
    year_max: int | None = Field(None, ge=1900, le=2100, description="Anno di uscita massimo")
    max_runtime: int | None = Field(None, ge=30, le=600, description="Durata massima in minuti")
    min_rating: float | None = Field(None, ge=0, le=10, description="Voto TMDB minimo (0-10)")
    languages: list[LanguageCode] = Field(
        default_factory=list, max_length=20, description="Lingue originali, codici ISO 639-1 (OR)"
    )
    themes: list[int] = Field(
        default_factory=list, max_length=20, description="Temi: ID parole chiave TMDB (OR)"
    )

    @model_validator(mode="after")
    def _years_in_order(self) -> "MovieFilters":
        if self.year_min and self.year_max and self.year_min > self.year_max:
            raise ValueError("L'anno iniziale viene dopo quello finale")
        return self


class StackSettings(MovieFilters):
    """Impostazioni di una pila: i filtri più quanti film mostrare."""

    limit: int = Field(30, ge=1, le=100, description="Dimensione massima della pila")


class RoomSettings(StackSettings):
    """Impostazioni di una stanza: quelle della pila più cosa fare dei film già visti."""

    exclude_seen: bool = Field(
        True, description="Scarta i film che almeno un giocatore ha già visto"
    )


MAX_MATCH_BATCH = 200  # film per richiesta di riconoscimento


class FilmRef(BaseModel):
    """Un film come lo scrive Letterboxd: titolo e anno, senza id."""

    title: str = Field(min_length=1, max_length=300)
    year: int | None = Field(None, ge=1850, le=2100)
