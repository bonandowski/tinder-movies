import type { CreatedRoom, DiaryEntry, FilmRef, Genre, Provider, RoomInfo, StackSettings, Theme } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Server non raggiungibile, riprova tra poco', 0)
  }
  if (!response.ok) {
    let message = `Errore ${response.status}`
    try {
      const body = await response.json()
      // FastAPI: `detail` è una stringa per i nostri errori, una lista per la validazione.
      if (typeof body.detail === 'string') message = body.detail
      else if (response.status === 422) message = 'Dati non validi'
    } catch {
      /* risposta non JSON: teniamo il messaggio generico */
    }
    throw new ApiError(message, response.status)
  }
  return (await response.json()) as T
}

export const api = {
  createRoom: (name: string, solo = false) =>
    request<CreatedRoom>('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, solo }),
    }),
  roomInfo: (code: string) => request<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`),
  genres: () => request<Genre[]>('/api/genres'),
  themes: () => request<Theme[]>('/api/themes'),
  providers: () => request<Provider[]>('/api/providers'),
  /** Quanti film (circa) rispettano i filtri, prima di togliere i già visti. */
  countMovies: (filters: Omit<StackSettings, 'limit'>, signal?: AbortSignal) =>
    request<{ total: number }>('/api/movies/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
      signal,
    }).then((result) => result.total),
  /** Ultimi ~50 film del diario pubblico di un utente Letterboxd. */
  letterboxdRecent: (username: string) =>
    request<{ username: string; films: DiaryEntry[]; truncated: boolean }>(`/api/letterboxd/${encodeURIComponent(username)}/recent`),
  /** Id TMDB di ogni film (titolo + anno), o null se non riconosciuto. Stesso ordine. */
  matchFilms: (films: FilmRef[]) =>
    request<{ ids: (number | null)[] }>('/api/films/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ films }),
    }).then((result) => result.ids),
}
