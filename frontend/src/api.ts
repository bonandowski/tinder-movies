import type { CreatedRoom, DiaryEntry, FilmRef, Genre, Provider, RoomInfo } from './types'

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
  } catch {
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
  createRoom: (name: string) =>
    request<CreatedRoom>('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  roomInfo: (code: string) => request<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`),
  genres: () => request<Genre[]>('/api/genres'),
  providers: () => request<Provider[]>('/api/providers'),
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
