import { useEffect, useState, type FormEvent } from 'react'
import type { Navigate } from '../App'
import { api } from '../api'
import { loadName, loadToken, saveName } from '../session'
import type { RoomInfo } from '../types'
import RoomScreen from './RoomScreen'

interface Props {
  code: string
  navigate: Navigate
}

/** Chi ha già un token rientra subito; gli altri passano da "come ti chiami?". */
export default function RoomPage({ code, navigate }: Props) {
  const [name, setName] = useState<string | null>(() => (loadToken(code) ? loadName() : null))
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
  const [name, setName] = useState(loadName)

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
    <main className="app center">
      <h1 className="logo">
        Stanza <span>{code}</span>
      </h1>
      {blocked ? (
        <>
          <p className="error">{blocked}</p>
          <button className="btn" onClick={() => navigate('/')}>
            Torna alla home
          </button>
        </>
      ) : !info ? (
        <p className="muted">
          <span className="spinner" /> Cerco la stanza…
        </p>
      ) : (
        <form className="card" onSubmit={submit}>
          <p className="muted">
            {info.players === 1 ? '1 giocatore ti aspetta' : `${info.players} giocatori ti aspettano`}
          </p>
          <label className="field">
            <span className="label">Il tuo nome</span>
            <input
              className="input"
              value={name}
              maxLength={20}
              autoFocus
              autoComplete="nickname"
              placeholder="Come ti chiami?"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={!name.trim()}>
            Entra
          </button>
          <button type="button" className="btn ghost" onClick={() => navigate('/')}>
            Annulla
          </button>
        </form>
      )}
    </main>
  )
}
