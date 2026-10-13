import { useState } from 'react'
import { challenger, choose, decideAtRandom, isDecided, progress, shuffled, startDuel, type Duel } from '../duel'
import { movieFacts } from '../format'
import { movieById } from '../roomReducer'
import type { Movie } from '../types'
import { share } from '../share'
import type { RoomApi } from '../useRoom'
import MovieSheet from './MovieSheet'

interface Props {
  room: RoomApi
  onLeave: () => void
}

/** Fine della partita da solo: fra i film che ti sono piaciuti, una sfida a coppie fino al vincitore. */
export default function SoloDecision({ room, onLeave }: Props) {
  const { data } = room
  const liked = (data.state?.results ?? []).map((r) => r.movie_id).filter((id) => movieById(data, id))
  const [duel, setDuel] = useState<Duel | null>(() => startDuel(shuffled(liked)))
  const [info, setInfo] = useState<Movie | null>(null)
  const movie = (id: number | null) => (id === null ? undefined : movieById(data, id))

  const footer = (
    <div className="field footer">
      <button className="btn primary" onClick={room.reset}>
        Un’altra pila
      </button>
      <button className="btn ghost" onClick={onLeave}>
        Esci
      </button>
    </div>
  )

  if (!duel) {
    return (
      <main className="app">
        <div className="field" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.6rem' }}>Niente ti ha convinto 🤷</h1>
          <p className="muted">Prova un’altra pila, magari con altri filtri: i film già visti stavolta non tornano.</p>
        </div>
        {footer}
      </main>
    )
  }

  if (isDecided(duel)) {
    const winner = movie(duel.champion)!
    return (
      <main className="app">
        <h1 style={{ fontSize: '1.6rem', textAlign: 'center' }}>🍿 Stasera guardi</h1>
        <div className="hero" style={{ backgroundImage: `url(${winner.poster_url})` }} onClick={() => setInfo(winner)}>
          <div className="shade" />
          <div className="caption">
            <h2 style={{ fontSize: '1.6rem' }}>{winner.title}</h2>
            <p className="muted small">{movieFacts(winner)}</p>
            <div className="logos">
              {winner.providers.map((p) => p.logo_url && <img key={p.id} src={p.logo_url} alt={p.name} title={p.name} />)}
            </div>
          </div>
        </div>
        <button className="btn" onClick={() => void share(`🍿 Stasera guardo «${winner.title}»: scelto con Tinder Movies`, location.origin)}>
          📲 Condividi
        </button>
        {liked.length > 1 && (
          <button className="btn ghost" onClick={() => setDuel(startDuel(shuffled(liked)))}>
            Rifai la sfida
          </button>
        )}
        {footer}
        {info && <MovieSheet movie={info} onClose={() => setInfo(null)} />}
      </main>
    )
  }

  const left = movie(duel.champion)!
  const right = movie(challenger(duel))!
  const { done, total } = progress(duel)
  return (
    <main className="app">
      <div className="field" style={{ textAlign: 'center', gap: 4 }}>
        <h1 style={{ fontSize: '1.5rem' }}>Quale preferisci?</h1>
        <p className="muted small">
          Ti sono piaciuti {liked.length} film: sfida {done + 1} di {total}. Tocca la locandina che vince.
        </p>
      </div>
      <div className="duel">
        {[left, right].map((m) => (
          <div key={m.id} className="field" style={{ gap: 6 }}>
            <button className="duel-card" aria-label={`Scelgo ${m.title}`} onClick={() => setDuel(choose(duel, m.id))}>
              <img src={m.poster_url} alt="" />
            </button>
            <strong className="small">{m.title}</strong>
            <span className="muted small">{movieFacts(m)}</span>
            <button className="btn small ghost" onClick={() => setInfo(m)}>
              Trama
            </button>
          </div>
        ))}
      </div>
      <button className="btn" onClick={() => setDuel(decideAtRandom(duel))}>
        🎲 Non so decidere: scegli tu
      </button>
      {footer}
      {info && <MovieSheet movie={info} onClose={() => setInfo(null)} />}
    </main>
  )
}
