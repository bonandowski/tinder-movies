// Opzioni dei filtri e piccoli calcoli sui filtri, tenuti fuori dai componenti per poterli testare.
import type { Catalog } from './useCatalog'
import type { Genre, PlayerInfo, RoomSettings, StackKind } from './types'

export const KINDS: { value: StackKind; label: string; hint: string; emoji: string }[] = [
  { value: 'popular', label: 'Popolari', hint: 'I più visti adesso', emoji: '🔥' },
  { value: 'top_rated', label: 'Più votati', hint: 'I classici sicuri', emoji: '🏆' },
  { value: 'recent', label: 'Usciti da poco', hint: 'Dal più recente', emoji: '🆕' },
  { value: 'hidden_gems', label: 'Perle nascoste', hint: 'Belli e poco noti', emoji: '💎' },
]

export const RATINGS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Qualsiasi', min: null, max: null },
  { label: '💩 Fino a 5', min: null, max: 5 },
  { label: '★ 6+', min: 6, max: null },
  { label: '★ 7+', min: 7, max: null },
  { label: '★ 7,5+', min: 7.5, max: null },
  { label: '★ 8+', min: 8, max: null },
]

/** Decenni e simili, scelti anche più d'uno: `value` è l'intervallo come lo vuole il server. */
export const YEAR_RANGES: { label: string; value: string }[] = [
  { label: 'Fino al 1979', value: '-1979' },
  { label: 'Anni ’80', value: '1980-1989' },
  { label: 'Anni ’90', value: '1990-1999' },
  { label: 'Anni 2000', value: '2000-2009' },
  { label: 'Anni 2010', value: '2010-2019' },
  { label: 'Dal 2020', value: '2020-' },
]

export const LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'en', label: 'Inglese', flag: '🇬🇧' },
  { code: 'fr', label: 'Francese', flag: '🇫🇷' },
  { code: 'es', label: 'Spagnolo', flag: '🇪🇸' },
  { code: 'de', label: 'Tedesco', flag: '🇩🇪' },
  { code: 'ko', label: 'Coreano', flag: '🇰🇷' },
  { code: 'ja', label: 'Giapponese', flag: '🇯🇵' },
  { code: 'zh', label: 'Cinese', flag: '🇨🇳' },
  { code: 'hi', label: 'Hindi', flag: '🇮🇳' },
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

/** Gli anni scelti in breve: "Anni ’90, Anni 2010", oppure "Qualsiasi". */
export function yearRangeLabel(settings: Pick<RoomSettings, 'year_min' | 'year_max' | 'year_ranges'>): string {
  if (settings.year_ranges.length) {
    const order = YEAR_RANGES.map((r) => r.value)
    return [...settings.year_ranges]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((value) => YEAR_RANGES.find((r) => r.value === value)?.label ?? value.replace('-', '–'))
      .join(', ')
  }
  if (settings.year_min === null && settings.year_max === null) return 'Qualsiasi'
  return `${settings.year_min ?? '…'}–${settings.year_max ?? 'oggi'}`
}

/** Il voto scelto in breve, per il riepilogo: "" se qualsiasi. */
export function ratingLabel(settings: Pick<RoomSettings, 'min_rating' | 'max_rating'>): string {
  const fmt = (n: number) => String(n).replace('.', ',')
  if (settings.min_rating !== null && settings.max_rating !== null) return `voto ${fmt(settings.min_rating)}–${fmt(settings.max_rating)}`
  if (settings.max_rating !== null) return `💩 voto fino a ${fmt(settings.max_rating)}`
  if (settings.min_rating !== null) return `voto ${fmt(settings.min_rating)}+`
  return ''
}

/**
 * I filtri che userà davvero la partita: i veti di chiunque tolgono quei generi (come fa il server
 * in begin_loading). null se tutti i generi scelti sono stati vietati: nessun film possibile.
 */
export function effectiveFilters(settings: RoomSettings, vetoed: number[]): Omit<RoomSettings, 'limit' | 'exclude_seen'> | null {
  const genres = settings.genres.filter((g) => !vetoed.includes(g))
  if (settings.genres.length && !genres.length) return null
  const { limit, exclude_seen, ...filters } = settings
  return { ...filters, genres, exclude_genres: [...new Set([...settings.exclude_genres, ...vetoed])].sort((a, b) => a - b) }
}

/** Chi ha vietato cosa: [{genere, nomi}] nell'ordine dei generi. */
export function groupVetoes(players: PlayerInfo[], genres: Genre[]): { genre: Genre; by: string[] }[] {
  return genres.flatMap((genre) => {
    const by = players.filter((p) => p.vetoes.includes(genre.id)).map((p) => p.name)
    return by.length ? [{ genre, by }] : []
  })
}

export type SetupStep = 'invite' | 'platforms' | 'genres' | 'mood' | 'era' | 'language' | 'themes' | 'seen' | 'summary' | 'wait'

/** I passi del wizard: l'host (o chi gioca da solo) sceglie tutto, gli ospiti solo le cose personali. */
export function setupSteps(isHost: boolean, solo: boolean): SetupStep[] {
  if (!isHost) return ['genres', 'seen', 'wait']
  return [...(solo ? [] : (['invite'] as SetupStep[])), 'platforms', 'genres', 'mood', 'era', 'language', 'themes', 'seen', 'summary']
}

/** Genere per l'host: neutro -> sì -> no (veto) -> neutro. Per gli ospiti: neutro <-> no. */
export function nextGenreState(current: 'none' | 'yes' | 'no', isHost: boolean): 'none' | 'yes' | 'no' {
  if (!isHost) return current === 'no' ? 'none' : 'no'
  return current === 'none' ? 'yes' : current === 'yes' ? 'no' : 'none'
}

/** Le scelte in breve, una riga per passo del wizard: per il riepilogo e per chi aspetta. */
export function describeSettings(
  settings: RoomSettings,
  catalog: Catalog | null,
): { step: SetupStep; label: string; value: string }[] {
  const pick = (ids: number[], source: { id: number; name: string }[] = [], all: string) =>
    ids.length ? ids.map((id) => source.find((s) => s.id === id)?.name ?? '…').join(', ') : all
  const kind = KINDS.find((k) => k.value === settings.kind)!
  const rating = ratingLabel(settings) && ` · ${ratingLabel(settings)}`
  const runtime = RUNTIMES.find((r) => r.value === settings.max_runtime)?.label ?? `max ${settings.max_runtime} min`
  return [
    { step: 'platforms', label: 'Piattaforme', value: pick(settings.platforms, catalog?.providers, 'tutte') },
    { step: 'genres', label: 'Generi', value: pick(settings.genres, catalog?.genres, 'tutti') },
    { step: 'mood', label: 'Serata', value: `${kind.emoji} ${kind.label}${rating}` },
    {
      step: 'era',
      label: 'Epoca',
      value: `${yearRangeLabel(settings)}${settings.max_runtime === null ? '' : ` · ${runtime.toLowerCase()}`}`,
    },
    {
      step: 'language',
      label: 'Lingua',
      value: settings.languages.length
        ? settings.languages.map((c) => LANGUAGES.find((l) => l.code === c)?.flag ?? c).join(' ')
        : 'qualsiasi',
    },
    { step: 'themes', label: 'Temi', value: pick(settings.themes, catalog?.themes, 'qualsiasi') },
    {
      step: 'seen',
      label: 'Pila',
      value: `${settings.limit} film${settings.exclude_seen ? ' · senza i già visti' : ''}`,
    },
  ]
}
