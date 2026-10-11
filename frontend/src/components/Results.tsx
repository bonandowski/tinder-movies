import { useState } from 'react'
import { movieById } from '../roomReducer'
import type { Movie, Result } from '../types'
import type { RoomApi } from '../useRoom'
import MovieRow from './MovieRow'
import MovieSheet from './MovieSheet'
import SoloDecision from './SoloDecision'

interface Props {
  room: RoomApi
  onLeave: () => void
}

export default function Results({ room, onLeave }: Props) {
  if (room.data.state?.solo) return <SoloDecision room={room} onLeave={onLeave} />
  return <GroupResults room={room} onLeave={onLeave} />
}

function GroupResults({ room, onLeave }: Props) {
  const { data } = room
  const state = data.state!
  const [info, setInfo] = useState<Movie | null>(null)
  const isHost = state.you === state.host
  const everyone = state.players.length

  const ranked = (state.results ?? []).flatMap((result) => {
    const movie = movieById(data, result.movie_id)
    return movie ? [{ movie, result }] : []
  })
  const isMatch = (result: Result) => state.matches.includes(result.movie_id)
  const matches = ranked.filter(({ result }) => isMatch(result))
  const nearMisses = ranked.filter(({ result }) => !isMatch(result)).slice(0, 10)
  const top = matches[0] ?? nearMisses[0]
  const rest = [...matches.slice(1), ...(matches.length ? [] : nearMisses.slice(1))]
  const others = matches.length ? nearMisses : []

  const note = (result: Result) => `Piace a ${result.liked_by.join(', ')} (${result.likes}/${everyone})`

  return (
    <main className="app">
      <div className="field" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.6rem' }}>
          {matches.length ? '🎉 Si guarda questo!' : top ? 'Nessun match… ma ci siamo vicini' : 'Nessun film piaciuto'}
        </h1>
        {!matches.length && top && (
          <p className="muted">Ecco i film piaciuti a più persone, i “meno peggio”.</p>
        )}
        {!top && <p className="muted">Nessuno ha messo un sì: riprovate con altri filtri.</p>}
      </div>

      {top && (
        <div className="hero" style={{ backgroundImage: `url(${top.movie.poster_url})` }} onClick={() => setInfo(top.movie)}>
          <div className="shade" />
          <div className="caption">
            <span className={`badge ${matches.length ? 'match' : ''}`} style={{ alignSelf: 'flex-start' }}>
              {matches.length ? 'Match' : `${top.result.likes}/${everyone} sì`}
            </span>
            <h2 style={{ fontSize: '1.6rem' }}>{top.movie.title}</h2>
            <p className="muted small">{note(top.result)}</p>
            <div className="logos">
              {top.movie.providers.map((p) => p.logo_url && <img key={p.id} src={p.logo_url} alt={p.name} title={p.name} />)}
            </div>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <section className="field">
          <h2>{matches.length ? 'Altri match' : 'Poi ci sono'}</h2>
          {rest.map(({ movie, result }) => (
            <MovieRow
              key={movie.id}
              movie={movie}
              note={note(result)}
              badge={<span className={`badge ${isMatch(result) ? 'match' : ''}`}>{result.likes}/{everyone}</span>}
              onClick={() => setInfo(movie)}
            />
          ))}
        </section>
      )}

      {others.length > 0 && (
        <section className="field">
          <h2>Quasi match</h2>
          {others.map(({ movie, result }) => (
            <MovieRow
              key={movie.id}
              movie={movie}
              note={note(result)}
              badge={<span className="badge">{result.likes}/{everyone}</span>}
              onClick={() => setInfo(movie)}
            />
          ))}
        </section>
      )}

      <div className="field footer">
        {isHost ? (
          <button className="btn primary" onClick={room.reset}>
            Nuova partita
          </button>
        ) : (
          <p className="muted" style={{ textAlign: 'center' }}>
            {state.host} può far partire una nuova partita.
          </p>
        )}
        <button className="btn ghost" onClick={onLeave}>
          Esci dalla stanza
        </button>
      </div>
      {info && <MovieSheet movie={info} onClose={() => setInfo(null)} />}
    </main>
  )
}
