from pydantic import BaseModel, Field


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


class MovieFilters(BaseModel):
    """Filtri della pila. Lista vuota / None = nessun vincolo."""

    platforms: list[int] = Field(default_factory=list, description="ID provider TMDB (OR)")
    genres: list[int] = Field(default_factory=list, description="ID generi TMDB (OR)")
    year_min: int | None = Field(None, ge=1900, le=2100, description="Anno di uscita minimo")
    max_runtime: int | None = Field(None, ge=30, le=600, description="Durata massima in minuti")
