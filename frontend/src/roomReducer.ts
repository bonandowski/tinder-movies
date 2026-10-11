import type { Movie, RoomState, ServerMessage } from './types'

export type Connection = 'connecting' | 'open' | 'reconnecting'

export interface RoomData {
  connection: Connection
  state: RoomState | null
  movies: Movie[]
  /** Film su cui tutti hanno detto sì e che non abbiamo ancora mostrato con "Match!". */
  matchQueue: number[]
  /** I nostri voti, anche quelli non ancora confermati dal server: li rimandiamo se cade la rete. */
  votes: Record<number, boolean>
  notice: string | null
}

export const initialRoomData: RoomData = {
  connection: 'connecting',
  state: null,
  movies: [],
  matchQueue: [],
  votes: {},
  notice: null,
}

export type RoomAction =
  | { type: 'connection'; value: Connection }
  | { type: 'message'; message: ServerMessage }
  | { type: 'vote'; movieId: number; like: boolean }
  | { type: 'dismiss_match' }
  | { type: 'clear_notice' }

export function roomReducer(data: RoomData, action: RoomAction): RoomData {
  switch (action.type) {
    case 'connection':
      return { ...data, connection: action.value }
    case 'vote':
      return { ...data, votes: { ...data.votes, [action.movieId]: action.like } }
    case 'dismiss_match':
      return { ...data, matchQueue: data.matchQueue.slice(1) }
    case 'clear_notice':
      return { ...data, notice: null }
    case 'message':
      return applyMessage(data, action.message)
  }
}

function applyMessage(data: RoomData, message: ServerMessage): RoomData {
  switch (message.type) {
    case 'state': {
      const next: RoomData = { ...data, state: message }
      if (message.phase === 'lobby' || message.phase === 'loading') {
        // Nuova partita in arrivo: via pila, voti e match della precedente.
        return { ...next, movies: [], votes: {}, matchQueue: [] }
      }
      if (message.phase === 'finished') return { ...next, matchQueue: [] }
      return next
    }
    case 'stack':
      return { ...data, movies: message.movies }
    case 'match': {
      const finished = data.state?.phase === 'finished'
      if (finished || data.matchQueue.includes(message.movie_id)) return data
      return { ...data, matchQueue: [...data.matchQueue, message.movie_id] }
    }
    case 'error':
      return { ...data, notice: message.message }
    case 'welcome':
    case 'pong':
      return data
  }
}

/** Indice del prossimo film da votare: vale il più avanti tra i nostri voti e il server. */
export function nextIndex(data: RoomData): number {
  const firstUnvoted = data.movies.findIndex((movie) => data.votes[movie.id] === undefined)
  const local = firstUnvoted === -1 ? data.movies.length : firstUnvoted
  return Math.max(local, data.state?.position ?? 0)
}

export function movieById(data: RoomData, id: number): Movie | undefined {
  return data.movies.find((movie) => movie.id === id)
}
