import { useEffect, useState } from 'react'
import { api } from './api'
import type { Genre, Provider } from './types'

export interface Catalog {
  genres: Genre[]
  providers: Provider[]
}

// Generi e piattaforme cambiano di rado: una richiesta per sessione basta.
let cached: Promise<Catalog> | null = null

export function useCatalog(): { catalog: Catalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cached ??= Promise.all([api.genres(), api.providers()]).then(([genres, providers]) => ({
      genres,
      providers,
    }))
    cached.then(setCatalog, (e: Error) => {
      cached = null
      setError(e.message)
    })
  }, [])

  return { catalog, error }
}
