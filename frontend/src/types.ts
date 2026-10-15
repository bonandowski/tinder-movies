// Specchio di backend/app/protocol.py e backend/app/models.py.

export type Phase = 'lobby' | 'loading' | 'swiping' | 'finished'

export interface Provider {
  id: number
  name: string
  logo_url: string | null
}

export interface Genre {
  id: number
  name: string
}

export interface Movie {
  id: number
  title: string
  poster_url: string
  overview: string
  runtime: number | null
  rating: number
  year: number | null
  providers: Provider[]
}

export type StackKind = 'popular' | 'top_rated' | 'recent' | 'hidden_gems'

export interface StackSettings {
  kind: StackKind
  platforms: number[]
  genres: number[]
  exclude_genres: number[]
  year_min: number | null
  year_max: number | null
  /** Intervalli di anni (basta uno): "1990-1999", "-1979", "2020-". */
  year_ranges: string[]
  max_runtime: number | null
  min_rating: number | null
  max_rating: number | null
  /** Lingue originali, codici ISO 639-1 (basta una). */
  languages: string[]
  /** Temi: id di parole chiave TMDB (basta uno). */
  themes: number[]
  limit: number
}

export interface Theme {
  id: number
  name: string
}

export interface RoomSettings extends StackSettings {
  /** Scarta i film che almeno un giocatore ha già visto. */
  exclude_seen: boolean
}

/** Un film come lo scrive Letterboxd: titolo e anno, senza id. */
export interface FilmRef {
  title: string
  year: number | null
}

/** Un film del diario pubblico di Letterboxd (dalla RSS). */
export interface DiaryEntry {
  tmdb_id: number
  title: string
  year: number | null
  rating: number | null
  watched_date: string | null
  rewatch: boolean
}

/** Quanti film già visti il server accetta da un giocatore (MAX_SEEN nel backend). */
export const MAX_SEEN = 20_000

export interface PlayerInfo {
  name: string
  is_host: boolean
  connected: boolean
  progress: number
  done: boolean
  /** Quanti film già visti ha dichiarato (non quali). */
  seen: number
  /** Generi che ha vietato. */
  vetoes: number[]
}

export interface Result {
  movie_id: number
  likes: number
  liked_by: string[]
}

export interface RoomState {
  type: 'state'
  code: string
  /** Partita da solo: un giocatore, nessun match, alla fine si sceglie fra i film piaciuti. */
  solo: boolean
  phase: Phase
  you: string
  host: string
  players: PlayerInfo[]
  settings: RoomSettings
  total: number
  position: number
  matches: number[]
  results: Result[] | null
}

export type ServerMessage =
  | { type: 'welcome'; code: string; name: string; token: string }
  | RoomState
  | { type: 'stack'; movies: Movie[] }
  | { type: 'match'; movie_id: number }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'pong' }

export type ClientMessage =
  | { type: 'join'; name: string; token: string | null }
  | { type: 'set_settings'; settings: RoomSettings }
  | { type: 'set_seen'; ids: number[] }
  | { type: 'set_vetoes'; genres: number[] }
  | { type: 'start' }
  | { type: 'swipe'; movie_id: number; like: boolean }
  | { type: 'finish' }
  | { type: 'reset' }
  | { type: 'kick'; name: string }
  | { type: 'leave' }
  | { type: 'ping' }

export interface RoomInfo {
  code: string
  solo: boolean
  phase: Phase
  players: number
  joinable: boolean
}

export interface CreatedRoom {
  code: string
  name: string
  token: string
}
