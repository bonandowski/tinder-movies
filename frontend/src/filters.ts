// Opzioni dei filtri e piccoli calcoli sui filtri, tenuti fuori dai componenti per poterli testare.
import type { Genre, PlayerInfo, RoomSettings, StackKind } from './types'

export const KINDS: { value: StackKind; label: string; hint: string }[] = [
  { value: 'popular', label: 'Popolari', hint: 'I film più visti in questo periodo.' },
  { value: 'top_rated', label: 'Più votati', hint: 'Voto alto e tantissimi voti: i classici sicuri.' },
  { value: 'recent', label: 'Usciti da poco', hint: 'Dal più recente.' },
  { value: 'hidden_gems', label: 'Perle nascoste', hint: 'Voto alto ma poco conosciuti.' },
]

export const MIN_RATINGS: { label: string; value: number | null }[] = [
  { label: 'Qualsiasi', value: null },
  { label: '6+', value: 6 },
  { label: '7+', value: 7 },
  { label: '7,5+', value: 7.5 },
  { label: '8+', value: 8 },
]

export const YEAR_RANGES: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Qualsiasi', min: null, max: null },
  { label: 'Fino al 1979', min: null, max: 1979 },
  { label: 'Anni ’80', min: 1980, max: 1989 },
  { label: 'Anni ’90', min: 1990, max: 1999 },
  { label: 'Anni 2000', min: 2000, max: 2009 },
  { label: 'Anni 2010', min: 2010, max: 2019 },
  { label: 'Dal 2020', min: 2020, max: null },
]

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'it', label: 'Italiano' },
  { code: 'en', label: 'Inglese' },
  { code: 'fr', label: 'Francese' },
  { code: 'es', label: 'Spagnolo' },
  { code: 'de', label: 'Tedesco' },
  { code: 'ko', label: 'Coreano' },
  { code: 'ja', label: 'Giapponese' },
  { code: 'zh', label: 'Cinese' },
  { code: 'hi', label: 'Hindi' },
]

export const RUNTIMES: { label: string; value: number | null }[] = [
  { label: 'Qualsiasi', value: null },
  { label: 'Max 90 min', value: 90 },
  { label: 'Max 2 h', value: 120 },
  { label: 'Max 2 h 30', value: 150 },
]

export const LIMITS = [10, 20, 30, 50]

export const toggle = <T,>(list: T[], item: T) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

/** Il preset di anni corrispondente ai filtri, o null se è un intervallo fuori dai preset. */
export function yearRangeLabel(settings: Pick<RoomSettings, 'year_min' | 'year_max'>): string | null {
  const preset = YEAR_RANGES.find((r) => r.min === settings.year_min && r.max === settings.year_max)
  if (preset) return preset.label
  return `${settings.year_min ?? '…'}–${settings.year_max ?? 'oggi'}`
}

/** Quanti filtri di "Altri filtri" sono diversi dal normale: si mostra sul pulsante che li apre. */
export function activeAdvancedCount(settings: RoomSettings): number {
  return [
    settings.kind !== 'popular',
    settings.min_rating !== null,
    settings.year_min !== null || settings.year_max !== null,
    settings.languages.length > 0,
    settings.themes.length > 0,
    settings.max_runtime !== null,
    !settings.exclude_seen,
  ].filter(Boolean).length
}

/** Chi ha vietato cosa: [{genere, nomi}] nell'ordine dei generi. */
export function groupVetoes(players: PlayerInfo[], genres: Genre[]): { genre: Genre; by: string[] }[] {
  return genres.flatMap((genre) => {
    const by = players.filter((p) => p.vetoes.includes(genre.id)).map((p) => p.name)
    return by.length ? [{ genre, by }] : []
  })
}
