import { useEffect } from 'react'
import { movieFacts } from '../format'
import type { Movie } from '../types'

interface Props {
  movie: Movie
  onClose: () => void
}

/** Scheda del film: locandina, dati, dove si vede, trama. */
export default function MovieSheet({ movie, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={movie.title} onClick={(e) => e.stopPropagation()}>
        <img className="poster" src={movie.poster_url} alt="" />
        <div className="field" style={{ gap: 4 }}>
          <h2 style={{ fontSize: '1.3rem' }}>{movie.title}</h2>
          <p className="muted">{movieFacts(movie)}</p>
        </div>
        <div className="field" style={{ gap: 6 }}>
          <span className="label">In streaming su</span>
          <div className="chips">
            {movie.providers.map((p) => (
              <span className="chip" key={p.id}>
                {p.name}
              </span>
            ))}
          </div>
        </div>
        <p>{movie.overview || 'Trama non disponibile.'}</p>
        <button className="btn" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </div>
  )
}
