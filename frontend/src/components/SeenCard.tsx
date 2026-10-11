import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../api'
import { matchAll, mergeSeen, parseUsername } from '../importSeen'
import { readFilmsFromFile } from '../letterboxd'
import { clearSeen, loadSeen, saveSeen, type SeenData } from '../session'

interface Props {
  /** Chiamata con i film visti (id TMDB) quando cambiano, anche vuota quando li si scollega. */
  onChange: (ids: number[]) => void
}

const n = (value: number) => value.toLocaleString('it-IT')

function ago(iso: string | undefined): string {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'adesso'
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h fa` : `${Math.round(hours / 24)} g fa`
}

/**
 * "Film già visti": il nome utente Letterboxd porta gli ultimi ~50 film del diario (RSS pubblica,
 * aggiornata a ogni stanza); l'export porta tutto lo storico, una volta sola. Si accumulano.
 */
export default function SeenCard({ onChange }: Props) {
  const [data, setData] = useState<SeenData | null>(loadSeen)
  const [username, setUsername] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [lastAdded, setLastAdded] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function store(update: Partial<SeenData> & { ids: number[] }): number {
    const { data: next, added } = mergeSeen(loadSeen(), update)
    saveSeen(next)
    setData(next)
    if (added > 0) onChange(next.ids)
    return added
  }

  async function sync(user: string, quiet: boolean) {
    setSyncing(true)
    if (!quiet) setError(null)
    try {
      const { films } = await api.letterboxdRecent(user)
      const added = store({ ids: films.map((film) => film.tmdb_id), username: user, syncedAt: new Date().toISOString() })
      setLastAdded(added)
    } catch (e) {
      const message = (e as Error).message
      setError(quiet ? `Letterboxd non risponde ora (${message}): uso i film già salvati.` : message)
    } finally {
      setSyncing(false)
    }
  }

  // A ogni ingresso in lobby: si aggiunge quello che hai visto di recente.
  useEffect(() => {
    const saved = loadSeen()?.username
    if (saved) void sync(saved, true)
  }, [])

  function connect(event: FormEvent) {
    event.preventDefault()
    const user = parseUsername(username)
    if (!user) return setError('Scrivi il nome utente Letterboxd (quello nell’indirizzo del profilo).')
    setUsername('')
    void sync(user, false)
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // così si può ricaricare lo stesso file
    if (!file) return
    setError(null)
    try {
      const films = await readFilmsFromFile(file)
      if (films.length === 0) throw new Error('Nel file non ci sono film.')
      setProgress({ done: 0, total: films.length })
      const outcome = await matchAll(films, api.matchFilms, (done, total) => setProgress({ done, total }))
      store({
        ids: outcome.ids,
        exportInfo: { total: outcome.total, matched: outcome.matched, source: file.name, importedAt: new Date().toISOString() },
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  function disconnect() {
    clearSeen()
    setData(null)
    setLastAdded(null)
    setError(null)
    onChange([])
  }

  const busy = syncing || progress !== null

  return (
    <section className="card">
      <h2>Film già visti</h2>

      {data && data.ids.length > 0 ? (
        <div className="field" style={{ gap: 4 }}>
          <p>
            <strong>{n(data.ids.length)}</strong> film già visti collegati: non ti ricapitano nella pila.
          </p>
          {data.username && (
            <span className="muted small">
              Letterboxd <strong>@{data.username}</strong>: ultimi film del diario
              {syncing ? ', aggiorno…' : data.syncedAt ? `, aggiornati ${ago(data.syncedAt)}` : ''}
              {!syncing && lastAdded ? ` (+${n(lastAdded)} nuovi)` : ''}
            </span>
          )}
          {data.exportInfo && (
            <span className="muted small">
              Export: {n(data.exportInfo.matched)} riconosciuti su {n(data.exportInfo.total)} ({ago(data.exportInfo.importedAt)})
            </span>
          )}
        </div>
      ) : (
        <p className="muted">
          Collega Letterboxd: i film che hai già visto non compaiono nella pila di nessuno in questa stanza.
        </p>
      )}

      {progress && (
        <div className="field" style={{ gap: 6 }}>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <span className="muted small">
            Riconosco i film… {n(progress.done)}/{n(progress.total)}
          </span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {!data?.username && (
        <form className="row" onSubmit={connect}>
          <input
            className="input grow"
            value={username}
            placeholder="Nome utente Letterboxd"
            aria-label="Nome utente Letterboxd"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button className="btn primary" disabled={busy || !username.trim()}>
            Collega
          </button>
        </form>
      )}

      <div className="row">
        <label className={`btn grow small ${busy ? 'disabled' : ''}`} style={{ textAlign: 'center' }}>
          {data?.exportInfo ? 'Ricarica l’export completo' : 'Carica l’export completo'}
          <input className="file-input" type="file" accept=".zip,.csv,application/zip,text/csv" disabled={busy} onChange={importFile} />
        </label>
        {data && !busy && (
          <button className="btn small ghost" onClick={disconnect}>
            Scollega
          </button>
        )}
      </div>

      <details>
        <summary className="muted small">Come funziona?</summary>
        <div className="small muted field" style={{ gap: 8, marginTop: 8 }}>
          <p>
            <strong>Nome utente</strong>: leggiamo il tuo diario pubblico (gli ultimi ~50 film registrati) ogni volta che
            entri in una stanza, e li aggiungiamo a quelli già salvati. I film votati senza passare dal diario non ci sono.
          </p>
          <p>
            <strong>Export completo</strong>, per tutto lo storico, una volta sola: dal sito di Letterboxd, Impostazioni →
            Dati → «Esporta i tuoi dati», poi carichi qui lo ZIP. Il file lo legge il tuo browser: al server arrivano solo
            titoli e anni per riconoscere i film.
          </p>
          <p>Agli altri giocatori arriva solo quanti film hai collegato, mai quali. Nessuna password.</p>
        </div>
      </details>
    </section>
  )
}
