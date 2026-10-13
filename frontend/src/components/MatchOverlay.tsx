import { useEffect } from 'react'
import { movieFacts } from '../format'
import { buzz } from '../share'
import type { Movie } from '../types'

interface Props {
  movie: Movie
  /** Altri match in coda dopo questo. */
  more: number
  onContinue: () => void
}

const CONFETTI = ['🎉', '🍿', '✨', '❤️', '🎬', '⭐', '🎊', '💥']

export default function MatchOverlay({ movie, more, onContinue }: Props) {
  useEffect(() => buzz([60, 40, 120]), [movie.id])
  return (
    <div className="overlay middle" role="dialog" aria-label="Match!">
      <div className="confetti" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <span key={`${movie.id}-${i}`} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.08}s` }}>
            {CONFETTI[i % CONFETTI.length]}
          </span>
        ))}
      </div>
      <div className="match-box">
        <div className="match-title">Match!</div>
        <p className="muted">Tutti volete vedere</p>
        <img className="poster" src={movie.poster_url} alt="" />
        <div className="field" style={{ gap: 4 }}>
          <h2>{movie.title}</h2>
          <p className="muted small">{movieFacts(movie)}</p>
        </div>
        <div className="logos" style={{ justifyContent: 'center' }}>
          {movie.providers.map((p) => p.logo_url && <img key={p.id} src={p.logo_url} alt={p.name} title={p.name} />)}
        </div>
        <button className="btn primary" style={{ width: '100%' }} onClick={onContinue}>
          {more > 0 ? `Vedi il prossimo match (+${more})` : 'Continua a swipare'}
        </button>
      </div>
    </div>
  )
}
