import { useState, type ChangeEvent } from 'react'
import { api } from '../api'
import { matchAll } from '../importSeen'
import { readFilmsFromFile } from '../letterboxd'
import { clearSeen, loadSeen, saveSeen, type SeenData } from '../session'

interface Props {
  /** Chiamata con i film visti (id TMDB) appena cambiano, anche vuota quando li si scollega. */
  onChange: (ids: number[]) => void
}

/** "Film già visti": si carica l'export di Letterboxd e quei film non compaiono più nella pila. */
export default function SeenCard({ onChange }: Props) {
  const [data, setData] = useState<SeenData | null>(loadSeen)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // così si può ricaricare lo stesso file
    if (!file) return
    setError(null)
    try {
      const films = await readFilmsFromFile(file)
      if (films.length === 0) throw new Error('Nel file non ci sono film.')
      setProgress({ done: 0, total: films.length })
      const outcome = await matchAll(films, api.matchFilms, (done, total) => setProgress({ done, total }))
      const next: SeenData = {
        ids: outcome.ids,
        total: outcome.total,
        matched: outcome.matched,
        source: file.name,
        importedAt: new Date().toISOString(),
      }
      saveSeen(next)
      setData(next)
      onChange(next.ids)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  function remove() {
    clearSeen()
    setData(null)
    onChange([])
  }

  const importing = progress !== null

  return (
    <section className="card">
      <h2>Film già visti</h2>

      {data ? (
        <p>
          <strong>{data.matched.toLocaleString('it-IT')}</strong> film riconosciuti su{' '}
          {data.total.toLocaleString('it-IT')}. Non ti ricapitano nella pila.
        </p>
      ) : (
        <p className="muted">
          Collega i film che hai già visto su Letterboxd: quelli non compaiono nella pila di nessuno in questa stanza.
        </p>
      )}

      {importing && (
        <div className="field" style={{ gap: 6 }}>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <span className="muted small">
            Riconosco i film… {progress.done.toLocaleString('it-IT')}/{progress.total.toLocaleString('it-IT')}
          </span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row">
        <label className={`btn grow ${importing ? 'disabled' : ''}`} style={{ textAlign: 'center' }}>
          {data ? 'Aggiorna da Letterboxd' : 'Collega Letterboxd'}
          <input
            className="file-input"
            type="file"
            accept=".zip,.csv,application/zip,text/csv"
            disabled={importing}
            onChange={pick}
          />
        </label>
        {data && !importing && (
          <button className="btn ghost" onClick={remove}>
            Scollega
          </button>
        )}
      </div>

      <details>
        <summary className="muted small">Come si fa?</summary>
        <ol className="small muted" style={{ paddingLeft: 18, margin: '8px 0 0' }}>
          <li>Dal sito di Letterboxd (non dall’app), con il tuo account: Impostazioni → Dati → «Esporta i tuoi dati».</li>
          <li>Scarichi uno ZIP: caricalo qui così com’è (basta anche il file watched.csv).</li>
        </ol>
        <p className="small muted" style={{ marginTop: 8 }}>
          Il file lo legge il tuo browser e non viene caricato. Al server arrivano solo titoli e anni per
          riconoscere i film su TMDB, e agli altri giocatori solo quanti film hai collegato. Nessuna password.
        </p>
      </details>
    </section>
  )
}
