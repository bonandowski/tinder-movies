import { describe, expect, it } from 'vitest'
import { challenger, choose, decideAtRandom, isDecided, progress, shuffled, startDuel } from './duel'
import { activeAdvancedCount, groupVetoes, toggle, yearRangeLabel } from './filters'
import type { PlayerInfo, RoomSettings } from './types'

const base: RoomSettings = {
  kind: 'popular',
  platforms: [],
  genres: [],
  exclude_genres: [],
  year_min: null,
  year_max: null,
  max_runtime: null,
  min_rating: null,
  languages: [],
  themes: [],
  limit: 30,
  exclude_seen: true,
}

describe('filters', () => {
  it('counts only the advanced filters that differ from the default', () => {
    expect(activeAdvancedCount(base)).toBe(0)
    expect(activeAdvancedCount({ ...base, platforms: [8], genres: [35], limit: 10 })).toBe(0) // filtri base
    expect(
      activeAdvancedCount({ ...base, kind: 'top_rated', min_rating: 7, year_min: 1990, languages: ['it'], themes: [1], exclude_seen: false }),
    ).toBe(6)
  })

  it('names year ranges', () => {
    expect(yearRangeLabel({ year_min: 1990, year_max: 1999 })).toBe('Anni ’90')
    expect(yearRangeLabel({ year_min: null, year_max: null })).toBe('Qualsiasi')
    expect(yearRangeLabel({ year_min: 1995, year_max: null })).toBe('1995–oggi')
  })

  it('toggles items in a list', () => {
    expect(toggle([1, 2], 2)).toEqual([1])
    expect(toggle(['it'], 'fr')).toEqual(['it', 'fr'])
  })

  it('tells who vetoed which genre', () => {
    const player = (name: string, vetoes: number[]): PlayerInfo => ({
      name,
      vetoes,
      is_host: false,
      connected: true,
      progress: 0,
      done: false,
      seen: 0,
    })
    const genres = [
      { id: 27, name: 'Horror' },
      { id: 35, name: 'Commedia' },
      { id: 37, name: 'Western' },
    ]
    expect(groupVetoes([player('Anna', [37]), player('Luca', [27, 37])], genres)).toEqual([
      { genre: genres[0], by: ['Luca'] },
      { genre: genres[2], by: ['Anna', 'Luca'] },
    ])
  })
})

describe('duel', () => {
  it('needs at least one film', () => {
    expect(startDuel([])).toBeNull()
    expect(isDecided(startDuel([7])!)).toBe(true)
  })

  it('keeps the winner against the next challenger until one is left', () => {
    let duel = startDuel([1, 2, 3])!
    expect(challenger(duel)).toBe(2)
    duel = choose(duel, 2) // 2 batte 1
    expect([duel.champion, challenger(duel)]).toEqual([2, 3])
    expect(progress(duel)).toEqual({ done: 1, total: 2 })
    duel = choose(duel, 2) // 2 batte 3
    expect(isDecided(duel)).toBe(true)
    expect(duel.champion).toBe(2)
    expect(duel.out).toEqual([1, 3])
  })

  it('ignores a choice that is not one of the two on screen', () => {
    const duel = startDuel([1, 2, 3])!
    expect(choose(duel, 3)).toBe(duel)
  })

  it('can let chance decide among the films still in the game', () => {
    const duel = choose(startDuel([1, 2, 3, 4])!, 1) // 2 fuori
    const decided = decideAtRandom(duel, () => 0.99)
    expect(isDecided(decided)).toBe(true)
    expect(decided.champion).toBe(4)
    expect(decided.out.sort()).toEqual([1, 2, 3])
  })

  it('shuffles without losing or duplicating items', () => {
    const items = [1, 2, 3, 4, 5]
    expect(shuffled(items, () => 0).sort()).toEqual(items)
    expect(items).toEqual([1, 2, 3, 4, 5]) // l'originale non cambia
  })
})
