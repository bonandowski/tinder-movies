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
    <main className="app fill center home">
      <div className="home-hero">
        <span className="brand">
          🎬 Tinder <span>Movies</span>
        </span>
        <h1 className="headline">
          Trovare l’<span className="hl-love">amore</span> è difficile. Il <span className="hl-film">film perfetto</span> da vedere in
          compagnia, <span className="hl-more">ancora di più</span>.
        </h1>
        <p className="muted subtitle">
          Basta discussioni e scroll infiniti, pochi swipe e <s>l’amore</s> <span className="hl-right">il film giusto</span> è lì che vi aspetta.
        </p>
      </div>

      {(flash || error) && <p className="error">{error ?? flash}</p>}

      <form className="card" onSubmit={(e) => (e.preventDefault(), create(false))}>
        <label className="field">
          <span className="label">Il tuo nome</span>
          <input
            className="input"
            value={name}
            maxLength={20}
            autoComplete="nickname"
            placeholder="Come ti chiami?"
            aria-label="Il tuo nome"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="btn primary" disabled={busy}>
          Crea una stanza
        </button>
      </form>

      <div className="divider">oppure</div>

      <form className="card" onSubmit={join}>
        <span className="label">Hai già un codice?</span>
        <div className="row">
          <input
            className="input code grow"
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABCD"
            aria-label="Codice stanza"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <button className="btn" disabled={busy || code.length < 4}>
            Entra
          </button>
        </div>
      </form>

      <div className="divider">da solo</div>

      <button className="card solo-card" disabled={busy} onClick={() => create(true)}>
        <span className="solo-text">
          <strong>🎲 Non sai cosa guardare?</strong>
          <span className="muted small">Swipe da solo, poi i film che ti piacciono si sfidano.</span>
        </span>
        <span className="muted">›</span>
      </button>

      <p className="muted small">Solo film in streaming in Italia · niente registrazione</p>
    </main>
  )
}
