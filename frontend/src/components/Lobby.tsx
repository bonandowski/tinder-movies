import { useState } from 'react'
import { groupVetoes } from '../filters'
import type { RoomApi } from '../useRoom'
import { useCatalog } from '../useCatalog'
import { FiltersEditor, FiltersSummary } from './Filters'
import PlayerList from './PlayerList'
import SeenCard from './SeenCard'
import VetoCard from './VetoCard'

interface Props {
  room: RoomApi
  onLeave: () => void
}

const MIN_PLAYERS = 2 // come MIN_PLAYERS del backend

export default function Lobby({ room, onLeave }: Props) {
  const state = room.data.state!
  const { catalog, error } = useCatalog()
  const [shared, setShared] = useState(false)

  const isHost = state.you === state.host
  const loading = state.phase === 'loading'
  const online = state.players.filter((p) => p.connected).length
  const needed = state.solo ? 1 : MIN_PLAYERS
  const canStart = isHost && !loading && online >= needed
  const vetoed = new Map(groupVetoes(state.players, catalog?.genres ?? []).map(({ genre, by }) => [genre.id, by]))

  async function invite() {
    const url = `${location.origin}/r/${state.code}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Tinder Movies', text: `Vieni a scegliere il film! Codice ${state.code}`, url })
      } else {
        await navigator.clipboard.writeText(url)
        setShared(true)
        window.setTimeout(() => setShared(false), 2000)
      }
    } catch {
      /* condivisione annullata dall'utente */
    }
  }

  return (
    <main className="app">
      {state.solo ? (
        <section className="field" style={{ textAlign: 'center', gap: 6 }}>
          <h1 className="logo" style={{ fontSize: '1.8rem' }}>
            Da <span>solo</span>
          </h1>
          <p className="muted">Scegli i filtri e swipe: alla fine ti aiutiamo a decidere fra i film che ti sono piaciuti.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <span className="label" style={{ textAlign: 'center' }}>
              Codice stanza
            </span>
            <div className="room-code">{state.code}</div>
            <button className="btn" onClick={invite}>
              {shared ? 'Link copiato!' : '🔗 Invita gli amici'}
            </button>
          </section>

          <section className="card">
            <h2>Giocatori ({state.players.length})</h2>
            <PlayerList players={state.players} you={state.you} onKick={isHost ? room.kick : undefined} />
          </section>
        </>
      )}

      <SeenCard onChange={room.setSeen} solo={state.solo} />

      {catalog && (
        <VetoCard you={state.you} players={state.players} genres={catalog.genres} solo={state.solo} onChange={room.setVetoes} />
      )}

      <section className="card">
        <h2>{isHost ? 'Che film cerchi?' : 'Filtri scelti da ' + state.host}</h2>
        {error && <p className="error">{error}</p>}
        {isHost ? (
          <FiltersEditor settings={state.settings} catalog={catalog} vetoed={vetoed} onChange={room.setSettings} />
        ) : (
          <FiltersSummary settings={state.settings} catalog={catalog} />
        )}
      </section>

      <div className="field footer">
        {isHost ? (
          <>
            <button className="btn primary" disabled={!canStart} onClick={room.start}>
              {loading ? (
                <>
                  <span className="spinner" /> Cerco i film…
                </>
              ) : (
                'Inizia a swipare'
              )}
            </button>
            {online < needed && (
              <p className="muted small" style={{ textAlign: 'center' }}>
                Aspetta almeno un altro giocatore: condividi il codice o il link.
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ textAlign: 'center' }}>
            {loading ? (
              <>
                <span className="spinner" /> {state.host} sta cercando i film…
              </>
            ) : (
              `Aspetta che ${state.host} faccia partire la partita…`
            )}
          </p>
        )}
        <button className="btn ghost" onClick={onLeave}>
          {state.solo ? 'Esci' : 'Esci dalla stanza'}
        </button>
      </div>
    </main>
  )
}
