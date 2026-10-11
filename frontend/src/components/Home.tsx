import { useState, type FormEvent } from 'react'
import type { Navigate } from '../App'
import { api } from '../api'
import { normalizeCode } from '../format'
import { loadName, saveName, saveToken } from '../session'

interface Props {
  flash: string | null
  navigate: Navigate
}

export default function Home({ flash, navigate }: Props) {
  const [name, setName] = useState(loadName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Scrivi il tuo nome')
    setBusy(true)
    setError(null)
    try {
      const room = await api.createRoom(name)
      saveName(room.name)
      saveToken(room.code, room.token)
      navigate(`/r/${room.code}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function playSolo() {
    setBusy(true)
    setError(null)
    try {
      const room = await api.createRoom(name.trim() || 'Io', true)
      if (name.trim()) saveName(room.name)
      saveToken(room.code, room.token)
      navigate(`/r/${room.code}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function join(event: FormEvent) {
    event.preventDefault()
    if (code.length < 4) return setError('Il codice ha 4 caratteri')
    setBusy(true)
    setError(null)
    try {
      const info = await api.roomInfo(code)
      navigate(`/r/${info.code}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="app center">
      <div className="field">
        <h1 className="logo">
          🎬 Tinder <span>Movies</span>
        </h1>
        <p className="muted">
          Scegliete insieme il film della serata. Swipe a destra se vi va, a sinistra se no: quando
          tutti dicono sì, è match!
        </p>
      </div>

      {(flash || error) && <p className="error">{error ?? flash}</p>}

      <form className="card" onSubmit={create}>
        <label className="field">
          <span className="label">Il tuo nome</span>
          <input
            className="input"
            value={name}
            maxLength={20}
            autoComplete="nickname"
            placeholder="Come ti chiami?"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="btn primary" disabled={busy}>
          Crea una stanza
        </button>
      </form>

      <div className="divider">oppure</div>

      <form className="card" onSubmit={join}>
        <label className="field">
          <span className="label">Hai già un codice?</span>
          <input
            className="input code"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABCD"
            aria-label="Codice stanza"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
        </label>
        <button className="btn" disabled={busy || code.length < 4}>
          Entra nella stanza
        </button>
      </form>

      <div className="divider">da solo</div>

      <section className="card">
        <p className="muted">
          Non sai cosa guardare? Swipe da solo, poi i film che ti piacciono si sfidano finché ne resta uno.
        </p>
        <button className="btn" disabled={busy} onClick={playSolo}>
          🎬 Scegli da solo
        </button>
      </section>
    </main>
  )
}
