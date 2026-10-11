import { movieFacts } from '../format'
import type { Movie } from '../types'

interface Props {
  movie: Movie
  /** Altri match in coda dopo questo. */
  more: number
  onContinue: () => void
}

export default function MatchOverlay({ movie, more, onContinue }: Props) {
  return (
    <div className="overlay middle" role="dialog" aria-label="Match!">
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
