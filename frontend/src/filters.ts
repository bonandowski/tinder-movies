// Opzioni dei filtri e piccoli calcoli sui filtri, tenuti fuori dai componenti per poterli testare.
import type { Catalog } from './useCatalog'
import type { Genre, PlayerInfo, RoomSettings, StackKind } from './types'

export const KINDS: { value: StackKind; label: string; hint: string; emoji: string }[] = [
  { value: 'popular', label: 'Popolari', hint: 'I più visti adesso', emoji: '🔥' },
  { value: 'top_rated', label: 'Più votati', hint: 'I classici sicuri', emoji: '🏆' },
  { value: 'recent', label: 'Usciti da poco', hint: 'Dal più recente', emoji: '🆕' },
  { value: 'hidden_gems', label: 'Perle nascoste', hint: 'Belli e poco noti', emoji: '💎' },
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

/** Il preset di anni corrispondente ai filtri, o null se è un intervallo fuori dai preset. */
export function yearRangeLabel(settings: Pick<RoomSettings, 'year_min' | 'year_max'>): string | null {
  const preset = YEAR_RANGES.find((r) => r.min === settings.year_min && r.max === settings.year_max)
  if (preset) return preset.label
  return `${settings.year_min ?? '…'}–${settings.year_max ?? 'oggi'}`
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
  const rating = settings.min_rating === null ? '' : ` · voto ${String(settings.min_rating).replace('.', ',')}+`
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
