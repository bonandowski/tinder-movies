import { useEffect, useState } from 'react'
import { api } from './api'
import type { StackSettings } from './types'

const DEBOUNCE_MS = 350

export type MovieCount = { status: 'loading' } | { status: 'ready'; total: number } | { status: 'error' }

/** Quanti film ci sono con questi filtri, aggiornato dal vivo mentre si sceglie (null = nessuno). */
export function useMovieCount(filters: Omit<StackSettings, 'limit'> | null): MovieCount {
  const key = filters === null ? 'none' : JSON.stringify(filters)
  const [count, setCount] = useState<MovieCount>({ status: 'loading' })

  useEffect(() => {
    if (filters === null) {
      setCount({ status: 'ready', total: 0 })
      return
    }
    setCount({ status: 'loading' })
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api
        .countMovies(filters, controller.signal)
        .then((total) => setCount({ status: 'ready', total }))
        .catch(() => !controller.signal.aborted && setCount({ status: 'error' }))
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  return count
}
