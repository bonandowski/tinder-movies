import type { SeenData } from './session'
import type { FilmRef } from './types'
import { MAX_SEEN } from './types'

export const BATCH_SIZE = 150
const ATTEMPTS = 3
const RETRY_DELAY_MS = 1500

export interface MatchOutcome {
  ids: number[]
  total: number
  matched: number
}

type Matcher = (films: FilmRef[]) => Promise<(number | null)[]>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Riconosce i film a blocchi (il server ne accetta pochi per volta), ritentando i blocchi che
 * falliscono. Un blocco che continua a fallire interrompe tutto: meglio un errore chiaro di un
 * elenco di film visti a metà.
 */
export async function matchAll(
  films: FilmRef[],
  match: Matcher,
  onProgress: (done: number, total: number) => void = () => {},
  wait: (ms: number) => Promise<void> = sleep,
): Promise<MatchOutcome> {
  const found = new Set<number>()
  let matched = 0
  for (let start = 0; start < films.length; start += BATCH_SIZE) {
    const batch = films.slice(start, start + BATCH_SIZE)
    const ids = await withRetries(() => match(batch), wait)
    for (const id of ids) {
      if (id !== null) {
        matched++
        found.add(id)
      }
    }
    onProgress(Math.min(start + BATCH_SIZE, films.length), films.length)
  }
  return { ids: [...found].slice(0, MAX_SEEN), total: films.length, matched }
}

async function withRetries<T>(run: () => Promise<T>, wait: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error
      await wait(RETRY_DELAY_MS * attempt)
    }
  }
}

/**
 * Aggiunge film visti a quelli salvati senza perderne nessuno: la RSS dà solo gli ultimi ~50, quindi
 * l'elenco completo si costruisce accumulando (un export una volta, poi la RSS a ogni stanza).
 */
export function mergeSeen(
  previous: SeenData | null,
  update: Partial<SeenData> & { ids: number[] },
): { data: SeenData; added: number } {
  const known = new Set(previous?.ids ?? [])
  const fresh = update.ids.filter((id) => !known.has(id))
  const ids = [...(previous?.ids ?? []), ...new Set(fresh)].slice(0, MAX_SEEN)
  return { data: { ...previous, ...update, ids }, added: ids.length - known.size }
}

/** "dave", "@dave", "letterboxd.com/dave", "https://letterboxd.com/dave/films/" -> "dave". */
export function parseUsername(input: string): string | null {
  const text = input.trim()
  const fromUrl = /letterboxd\.com\/([^/?#\s]+)/i.exec(text)
  const candidate = (fromUrl ? fromUrl[1] : text).replace(/^@/, '')
  return /^[A-Za-z0-9_]{1,40}$/.test(candidate) ? candidate : null
}
