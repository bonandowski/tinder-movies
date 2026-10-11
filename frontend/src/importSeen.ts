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
