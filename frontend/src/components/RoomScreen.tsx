import type { Navigate } from '../App'
import { useRoom } from '../useRoom'
import Lobby from './Lobby'
import Results from './Results'
import Swipe from './Swipe'

interface Props {
  code: string
  name: string
  navigate: Navigate
}

export default function RoomScreen({ code, name, navigate }: Props) {
  const room = useRoom(code, name, (message) => navigate('/', message))
  const { state, connection, notice } = room.data

  const leave = () => {
    room.leave()
    navigate('/')
  }

  if (!state) {
    return (
      <main className="app center">
        <p className="muted">
          <span className="spinner" />{' '}
          {connection === 'reconnecting' ? 'Riconnessione…' : 'Mi collego alla stanza…'}
        </p>
      </main>
    )
  }

  return (
    <>
      {connection !== 'open' && <div className="banner">Connessione persa, riprovo…</div>}
      {state.phase === 'swiping' ? (
        <Swipe room={room} onLeave={leave} />
      ) : state.phase === 'finished' ? (
        <Results room={room} onLeave={leave} />
      ) : (
        <Lobby room={room} onLeave={leave} />
      )}
      {notice && (
        <div className="toast" role="alert" onClick={room.clearNotice}>
          {notice}
        </div>
      )}
    </>
  )
}
