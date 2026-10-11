import type { ReactNode } from 'react'
import { movieFacts } from '../format'
import type { Movie } from '../types'

interface Props {
  movie: Movie
  badge?: ReactNode
  note?: string
  onClick: () => void
}

export default function MovieRow({ movie, badge, note, onClick }: Props) {
  return (
    <button className="movie-row" onClick={onClick}>
      <img className="thumb" src={movie.poster_url} alt="" loading="lazy" />
      <div className="grow field" style={{ gap: 4 }}>
        <strong>{movie.title}</strong>
        <span className="muted small">{movieFacts(movie)}</span>
        {note && <span className="small">{note}</span>}
        <div className="logos">
          {movie.providers.slice(0, 5).map((p) => p.logo_url && <img key={p.id} src={p.logo_url} alt={p.name} />)}
        </div>
      </div>
      {badge}
    </button>
  )
}
