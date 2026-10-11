import { useEffect, useRef, useState } from 'react'
import { movieById, nextIndex } from '../roomReducer'
import type { Movie } from '../types'
import type { RoomApi } from '../useRoom'
import MatchOverlay from './MatchOverlay'
import MovieRow from './MovieRow'
import MovieSheet from './MovieSheet'
import PlayerList from './PlayerList'
import SwipeCard, { type CardHandle } from './SwipeCard'

interface Props {
  room: RoomApi
  onLeave: () => void
}

export default function Swipe({ room, onLeave }: Props) {
  const { data } = room
  const state = data.state!
  const cardRef = useRef<CardHandle>(null)
  const [info, setInfo] = useState<Movie | null>(null)
  const [showMatches, setShowMatches] = useState(false)

  const total = data.movies.length
  const index = nextIndex(data)
  const movie = data.movies[index]
  const matchMovie = movieById(data, data.matchQueue[0])
  const blocked = Boolean(info || matchMovie || showMatches)
  const isHost = state.you === state.host
  const matches = state.matches.flatMap((id) => movieById(data, id) ?? [])
  // Da solo non ci sono match: il cuore conta i film a cui hai detto sì.
  const liked = data.movies.filter((m) => data.votes[m.id] === true)
  const hearts = state.solo ? liked : matches

  // Le prossime locandine si scaricano in anticipo, così lo swipe non aspetta la rete.
  useEffect(() => {
    for (const next of data.movies.slice(index + 1, index + 4)) new Image().src = next.poster_url
  }, [data.movies, index])

  useEffect(() => {
    if (blocked || !movie) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') cardRef.current?.swipe(true)
      else if (event.key === 'ArrowLeft') cardRef.current?.swipe(false)
      else if (event.key === 'ArrowUp' || event.key === 'i') setInfo(movie)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocked, movie])

  const exit = () => window.confirm('Uscire dalla partita?') && onLeave()

  const topbar = (
    <div className="topbar">
      <div className="progress" aria-hidden>
        <i style={{ width: total ? `${(Math.min(index, total) / total) * 100}%` : 0 }} />
      </div>
      <span className="pill">
        {Math.min(index + 1, total)}/{total}
      </span>
      <button
        className="pill"
        onClick={() => setShowMatches(true)}
        aria-label={state.solo ? `${liked.length} film che ti piacciono` : `${matches.length} match`}
      >
        ❤ {hearts.length}
      </button>
      <button className="pill" onClick={exit} aria-label="Esci">
        ✕
      </button>
    </div>
  )

  const overlays = (
    <>
      {matchMovie && <MatchOverlay movie={matchMovie} more={data.matchQueue.length - 1} onContinue={room.dismissMatch} />}
      {info && <MovieSheet movie={info} onClose={() => setInfo(null)} />}
      {showMatches && (
        <div className="overlay" onClick={() => setShowMatches(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{state.solo ? `Ti piacciono (${liked.length})` : `I vostri match (${matches.length})`}</h2>
            {hearts.length === 0 && (
              <p className="muted">
                {state.solo ? 'Ancora nessun sì. Continua a swipare!' : 'Ancora nessun film piace a tutti. Continua a swipare!'}
              </p>
            )}
            {hearts.map((m) => (
              <MovieRow key={m.id} movie={m} onClick={() => setInfo(m)} />
            ))}
            {state.solo && liked.length > 0 && (
              <button className="btn primary" onClick={room.finish}>
                Basta così: aiutami a scegliere
              </button>
            )}
            <button className="btn" onClick={() => setShowMatches(false)}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </>
  )

  if (total === 0) {
    return (
      <main className="app center">
        <p className="muted">
          <span className="spinner" /> Carico i film…
        </p>
      </main>
    )
  }

  // Pila finita: si aspettano gli altri.
  if (!movie) {
    return (
      <main className="app">
        {topbar}
        <section className="card" style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.4rem' }}>Hai finito la pila! 🎉</h2>
          <p className="muted">
            {matches.length > 0
              ? `Per ora ${matches.length === 1 ? 'c’è 1 match' : `ci sono ${matches.length} match`}.`
              : 'Per ora nessun match, aspettiamo gli altri.'}
          </p>
        </section>
        <section className="card">
          <h2>Gli altri stanno ancora votando</h2>
          <PlayerList players={state.players} you={state.you} total={total} />
        </section>
        <div className="field footer">
          {isHost && (
            <button className="btn primary" onClick={room.finish}>
              Mostra i risultati ora
            </button>
          )}
          <button className="btn ghost" onClick={onLeave}>
            Esci dalla stanza
          </button>
        </div>
        {overlays}
      </main>
    )
  }

  return (
    <main className="app fill">
      {topbar}
      <div className="deck">
        {data.movies[index + 1] && (
          <SwipeCard key={data.movies[index + 1].id} movie={data.movies[index + 1]} active={false} onSwipe={() => {}} onInfo={() => {}} />
        )}
        <SwipeCard
          key={movie.id}
          ref={cardRef}
          movie={movie}
          active={!blocked}
          onSwipe={(like) => room.swipe(movie.id, like)}
          onInfo={() => setInfo(movie)}
        />
      </div>
      <div className="actions">
        <button className="round" aria-label="Non mi va" disabled={blocked} onClick={() => cardRef.current?.swipe(false)}>
          ✕
        </button>
        <button className="round info" aria-label="Dettagli" disabled={blocked} onClick={() => setInfo(movie)}>
          ℹ
        </button>
        <button className="round yes" aria-label="Mi va" disabled={blocked} onClick={() => cardRef.current?.swipe(true)}>
          ♥
        </button>
      </div>
      {overlays}
    </main>
  )
}
