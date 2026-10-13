import { useEffect, useState, type FormEvent } from 'react'
import type { Navigate } from '../App'
import { api } from '../api'
import { funnyName } from '../names'
import { loadName, loadToken, saveName, takeAutojoin } from '../session'
import { NameField } from './Home'
import HowItWorks from './HowItWorks'
import type { RoomInfo } from '../types'
import RoomScreen from './RoomScreen'

interface Props {
  code: string
  navigate: Navigate
}

/** Chi ha già un token rientra subito; gli altri passano da "come ti chiami?". */
export default function RoomPage({ code, navigate }: Props) {
  // Rientro (token) o "Unisciti" dalla home (nome già scelto): si entra subito.
  const [name, setName] = useState<string | null>(() => (loadToken(code) || takeAutojoin(code) ? loadName() || funnyName() : null))
  if (name === null) return <JoinGate code={code} navigate={navigate} onJoin={setName} />
  return <RoomScreen code={code} name={name} navigate={navigate} />
}

function JoinGate({
  code,
  navigate,
  onJoin,
}: Props & {
  onJoin: (name: string) => void
}) {
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(() => loadName() || funnyName())

  useEffect(() => {
    api.roomInfo(code).then(setInfo, (e: Error) => setError(e.message))
  }, [code])

  function submit(event: FormEvent) {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return
    saveName(clean)
    onJoin(clean)
  }

  const blocked =
    error ??
    (info?.solo
      ? 'È una partita da solo: non si può entrare'
      : info && !info.joinable
        ? 'La partita è già iniziata o la stanza è piena'
        : null)

  return (
    <main className="app home">
      <div className="home-hero">
        <span className="brand">
          🎬 Tinder <span>Movies</span>
        </span>
        <h1 className="headline">
          Ti hanno invitato a scegliere il <span className="hl-film">film di stasera</span> 🍿
        </h1>
        <p className="muted subtitle">Sessione {code}: entra, swipe, e quando dite tutti sì è match.</p>
      </div>
      <HowItWorks />
      {blocked ? (
        <section className="card">
          <p className="error">{blocked}</p>
          <button className="btn" onClick={() => navigate('/')}>
            Torna alla home
          </button>
        </section>
      ) : (
        <form className="card" onSubmit={submit}>
          {info && (
            <p className="muted small">
              {info.players === 1 ? 'C’è già 1 persona che ti aspetta' : `Ci sono già ${info.players} persone che ti aspettano`}
            </p>
          )}
          <NameField name={name} onChange={setName} autoFocus />
          <button className="btn primary" disabled={!name.trim() || !info}>
            {info ? 'Entra' : 'Cerco la sessione…'}
          </button>
          <button type="button" className="link-btn" onClick={() => navigate('/')}>
            Annulla
          </button>
        </form>
      )}
    </main>
  )
}
