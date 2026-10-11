import type { Movie } from './types'

export function formatRuntime(minutes: number | null): string | null {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "2021 · 1 h 49 min · ★ 7.8": solo le parti che conosciamo. */
export function movieFacts(movie: Movie): string {
  return [
    movie.year ? String(movie.year) : null,
    formatRuntime(movie.runtime),
    movie.rating > 0 ? `★ ${movie.rating.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}
