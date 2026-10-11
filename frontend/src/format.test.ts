import { describe, expect, it } from 'vitest'
import { formatRuntime, movieFacts, normalizeCode } from './format'
import type { Movie } from './types'

const base: Movie = {
  id: 1,
  title: 'x',
  poster_url: '',
  overview: '',
  runtime: 109,
  rating: 7.84,
  year: 2021,
  providers: [],
}

describe('format', () => {
  it('formats runtimes', () => {
    expect(formatRuntime(109)).toBe('1 h 49 min')
    expect(formatRuntime(120)).toBe('2 h')
    expect(formatRuntime(45)).toBe('45 min')
    expect(formatRuntime(null)).toBeNull()
  })

  it('joins only the facts we know', () => {
    expect(movieFacts(base)).toBe('2021 · 1 h 49 min · ★ 7.8')
    expect(movieFacts({ ...base, year: null, runtime: null, rating: 0 })).toBe('')
  })

  it('normalizes room codes typed by hand', () => {
    expect(normalizeCode(' ab-c d9 ')).toBe('ABCD')
    expect(normalizeCode('abcdef')).toBe('ABCD')
  })
})
