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

export interface StackSettings {
  platforms: number[]
  genres: number[]
  year_min: number | null
  max_runtime: number | null
  limit: number
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
}

export interface Result {
  movie_id: number
  likes: number
  liked_by: string[]
}

export interface RoomState {
  type: 'state'
  code: string
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
  | { type: 'start' }
  | { type: 'swipe'; movie_id: number; like: boolean }
  | { type: 'finish' }
  | { type: 'reset' }
  | { type: 'kick'; name: string }
  | { type: 'leave' }
  | { type: 'ping' }

export interface RoomInfo {
  code: string
  phase: Phase
  players: number
  joinable: boolean
}

export interface CreatedRoom {
  code: string
  name: string
  token: string
}
