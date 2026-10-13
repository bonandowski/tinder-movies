import { useState, type FormEvent } from 'react'
import type { Navigate } from '../App'
import { api } from '../api'
import { normalizeCode } from '../format'
import { loadName, saveName, saveToken } from '../session'

interface Props {
  flash: string | null
  navigate: Navigate
}

/** Tutto in una schermata: nome, poi una delle tre strade (crea, entra con codice, da solo). */
export default function Home({ flash, navigate }: Props) {
  const [name, setName] = useState(loadName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const create = (solo: boolean) =>
    run(async () => {
      if (!solo && !name.trim()) throw new Error('Scrivi il tuo nome per creare la stanza')
      const room = await api.createRoom(name.trim() || 'Io', solo)
      if (name.trim()) saveName(room.name)
      saveToken(room.code, room.token)
      navigate(`/r/${room.code}`)
    })

  function join(event: FormEvent) {
    event.preventDefault()
    if (code.length < 4) return setError('Il codice ha 4 caratteri')
    void run(async () => {
      const info = await api.roomInfo(code)
      if (name.trim()) saveName(name.trim())
      navigate(`/r/${info.code}`)
    })
  }

  return (
    <main className="app fill home">
      <div className="hero-title">
        <div className="home-emoji" aria-hidden>
          🎬🍿
        </div>
        <h1 className="logo">
          Tinder <span>Movies</span>
        </h1>
        <p className="muted">Swipe insieme, e quando dite tutti sì è match: il film di stasera è deciso.</p>
      </div>

      {(flash || error) && <p className="error">{error ?? flash}</p>}

      <div className="field home-actions">
        <input
          className="input"
          value={name}
          maxLength={20}
          autoComplete="nickname"
          placeholder="Come ti chiami?"
          aria-label="Il tuo nome"
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn primary big" disabled={busy} onClick={() => create(false)}>
          Crea una stanza
        </button>
        <form className="row" onSubmit={join}>
          <input
            className="input code grow"
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="CODICE"
            aria-label="Codice stanza"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <button className="btn" disabled={busy || code.length < 4}>
            Entra
          </button>
        </form>
        <button className="btn ghost" disabled={busy} onClick={() => create(true)}>
          🎲 Non sai cosa guardare? Scegli da solo
        </button>
      </div>

      <p className="muted small center-text">Film in streaming in Italia · dati TMDB</p>
    </main>
  )
}
