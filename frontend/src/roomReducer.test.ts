import { describe, expect, it } from 'vitest'
import { initialRoomData, movieById, nextIndex, roomReducer, type RoomData } from './roomReducer'
import type { Movie, Phase, RoomState } from './types'

const movie = (id: number): Movie => ({
  id,
  title: `Film ${id}`,
  poster_url: '',
  overview: '',
  runtime: 100,
  rating: 7,
  year: 2020,
  providers: [],
})

const state = (over: Partial<RoomState> = {}): RoomState => ({
  type: 'state',
  code: 'ABCD',
  phase: 'swiping' as Phase,
  you: 'Anna',
  host: 'Anna',
  players: [],
  settings: { platforms: [], genres: [], year_min: null, max_runtime: null, limit: 30, exclude_seen: true },
  total: 3,
  position: 0,
  matches: [],
  results: null,
  ...over,
})

const playing = (over: Partial<RoomData> = {}): RoomData => ({
  ...initialRoomData,
  state: state(),
  movies: [movie(1), movie(2), movie(3)],
  ...over,
})

describe('roomReducer', () => {
  it('keeps the latest state and the stack', () => {
    let data = roomReducer(initialRoomData, { type: 'message', message: { type: 'stack', movies: [movie(1)] } })
    data = roomReducer(data, { type: 'message', message: state() })
    expect(data.movies).toHaveLength(1)
    expect(data.state?.phase).toBe('swiping')
  })

  it('queues a match once and ignores duplicates', () => {
    let data = playing()
    data = roomReducer(data, { type: 'message', message: { type: 'match', movie_id: 2 } })
    data = roomReducer(data, { type: 'message', message: { type: 'match', movie_id: 2 } })
    data = roomReducer(data, { type: 'message', message: { type: 'match', movie_id: 3 } })
    expect(data.matchQueue).toEqual([2, 3])
    data = roomReducer(data, { type: 'dismiss_match' })
    expect(data.matchQueue).toEqual([3])
  })

  it('does not pop up a match overlay once the game is over', () => {
    const data = roomReducer(playing({ state: state({ phase: 'finished' }) }), {
      type: 'message',
      message: { type: 'match', movie_id: 1 },
    })
    expect(data.matchQueue).toEqual([])
  })

  it('drops queued matches when the game finishes', () => {
    const data = roomReducer(playing({ matchQueue: [1] }), {
      type: 'message',
      message: state({ phase: 'finished' }),
    })
    expect(data.matchQueue).toEqual([])
    expect(data.movies).toHaveLength(3) // la pila serve ancora per i risultati
  })

  it.each(['lobby', 'loading'] as const)('forgets the previous game when back to %s', (phase) => {
    const data = roomReducer(playing({ votes: { 1: true }, matchQueue: [1] }), {
      type: 'message',
      message: state({ phase, total: 0 }),
    })
    expect(data.movies).toEqual([])
    expect(data.votes).toEqual({})
    expect(data.matchQueue).toEqual([])
  })

  it('shows server errors as a notice that can be cleared', () => {
    let data = roomReducer(initialRoomData, {
      type: 'message',
      message: { type: 'error', message: 'Servono almeno 2 giocatori', fatal: false },
    })
    expect(data.notice).toBe('Servono almeno 2 giocatori')
    data = roomReducer(data, { type: 'clear_notice' })
    expect(data.notice).toBeNull()
  })
})

describe('nextIndex', () => {
  it('follows our own votes immediately', () => {
    let data = playing()
    expect(nextIndex(data)).toBe(0)
    data = roomReducer(data, { type: 'vote', movieId: 1, like: true })
    data = roomReducer(data, { type: 'vote', movieId: 2, like: false })
    expect(nextIndex(data)).toBe(2)
  })

  it('trusts the server when it is ahead (e.g. voted from another tab)', () => {
    expect(nextIndex(playing({ state: state({ position: 2 }) }))).toBe(2)
  })

  it('is the stack length when everything is voted', () => {
    const votes = { 1: true, 2: true, 3: false }
    expect(nextIndex(playing({ votes }))).toBe(3)
  })
})

describe('movieById', () => {
  it('finds a movie of the stack', () => {
    expect(movieById(playing(), 2)?.title).toBe('Film 2')
    expect(movieById(playing(), 99)).toBeUndefined()
  })
})
