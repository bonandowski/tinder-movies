import { useState, type FormEvent } from 'react'
import type { Navigate } from '../App'
import { api } from '../api'
import { normalizeCode } from '../format'
import { funnyName } from '../names'
import { track } from '../analytics'
import { loadName, markAutojoin, saveName, saveToken } from '../session'
import HowItWorks from './HowItWorks'

interface Props {
  flash: string | null
  navigate: Navigate
}

export default function Home({ flash, navigate }: Props) {
  const [name, setName] = useState(loadName)
  const [joining, setJoining] = useState(false)
  const [mode, setMode] = useState<'group' | 'solo'>('group')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Nessun nome? Ne inventiamo uno buffo, e lo si vede nel campo.
  function nameOrFunny(): string {
    const clean = name.trim()
    if (clean) return clean
    const generated = funnyName()
    setName(generated)
    return generated
  }

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
      const chosen = solo ? name.trim() || 'Io' : nameOrFunny()
      const room = await api.createRoom(chosen, solo)
      if (!solo || name.trim()) saveName(room.name)
      saveToken(room.code, room.token)
      track(solo ? 'sessione-da-solo' : 'sessione-creata')
      navigate(`/r/${room.code}`)
    })

  function join(event: FormEvent) {
    event.preventDefault()
    if (code.length < 4) return setError('Il codice ha 4 caratteri')
    void run(async () => {
      const info = await api.roomInfo(code)
      saveName(nameOrFunny())
      markAutojoin(info.code)
      track('entra-con-codice')
      navigate(`/r/${info.code}`)
    })
  }

  return (
    <main className="app home">
      <div className="home-hero">
        <span className="brand">
          🎬 Tinder <span>Movies</span>
        </span>
        <h1 className="headline">
          Trovare l’<span className="hl-love">amore</span> è difficile. Il <span className="hl-film">film perfetto</span> da vedere in
          compagnia, <span className="hl-more">ancora di più</span>.
        </h1>
        <p className="muted subtitle">
          Basta discussioni e scroll infiniti, pochi swipe e <s>l’amore</s> <span className="hl-right">il film giusto</span> è lì che vi
          aspetta.
        </p>
      </div>

      <HowItWorks />

      {(flash || error) && <p className="error">{error ?? flash}</p>}

      <section className="card">
        {/* In compagnia o da solo; chi entra con un codice non deve scegliere. */}
        {!joining && (
          <div className="mode-switch" role="radiogroup" aria-label="Come giochi?">
            <button type="button" role="radio" aria-checked={mode === 'group'} onClick={() => setMode('group')}>
              👥 In compagnia
            </button>
            <button type="button" role="radio" aria-checked={mode === 'solo'} onClick={() => setMode('solo')}>
              🙋 Da solo
            </button>
          </div>
        )}
        <NameField name={name} onChange={setName} />
        {mode === 'solo' ? (
          <>
            <button className="btn primary" disabled={busy} onClick={() => create(true)}>
              🍿 Inizia da solo
            </button>
            <p className="muted small mode-hint">Swipa da solo, poi i film che ti piacciono si sfidano a coppie fino al vincitore.</p>
          </>
        ) : joining ? (
          <form className="field" style={{ gap: 8 }} onSubmit={join}>
            <div className="row">
              <input
                className="input code grow"
                value={code}
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="CODICE"
                aria-label="Codice sessione"
                onChange={(e) => setCode(normalizeCode(e.target.value))}
              />
              <button className="btn primary" disabled={busy || code.length < 4}>
                Entra
              </button>
            </div>
            <button type="button" className="link-btn" onClick={() => setJoining(false)}>
              ‹ Voglio creare una sessione
            </button>
          </form>
        ) : (
          <div className="row">
            <button className="btn primary grow" disabled={busy} onClick={() => create(false)}>
              Crea sessione
            </button>
            <button className="btn" disabled={busy} onClick={() => setJoining(true)}>
              Unisciti
            </button>
          </div>
        )}
      </section>


      <p className="muted small center-text">Solo film in streaming in Italia · niente registrazione</p>
    </main>
  )
}

/** "Come ti chiami?" con il dado che propone un nome buffo. */
export function NameField({ name, onChange, autoFocus = false }: { name: string; onChange: (name: string) => void; autoFocus?: boolean }) {
  return (
    <div className="name-field">
      <input
        className="input"
        value={name}
        maxLength={20}
        autoFocus={autoFocus}
        autoComplete="nickname"
        placeholder="Come ti chiami?"
        aria-label="Il tuo nome"
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="dice" aria-label="Nome a caso" title="Nome a caso" onClick={() => onChange(funnyName(Math.random, name))}>
        🎲
      </button>
    </div>
  )
}
