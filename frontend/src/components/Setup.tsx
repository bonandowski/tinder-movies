import { useEffect, useState, type ReactNode } from 'react'
import {
  describeSettings,
  effectiveFilters,
  groupVetoes,
  KINDS,
  LANGUAGES,
  LIMITS,
  nextGenreState,
  RATINGS,
  RUNTIMES,
  setupSteps,
  toggle,
  YEAR_RANGES,
  type SetupStep,
} from '../filters'
import { loadVetoes, saveVetoes } from '../session'
import { buzz, share } from '../share'
import type { RoomSettings } from '../types'
import { useCatalog } from '../useCatalog'
import { useMovieCount, type MovieCount } from '../useMovieCount'
import type { RoomApi } from '../useRoom'
import SeenCard from './SeenCard'

interface Props {
  room: RoomApi
  onLeave: () => void
}

const MIN_PLAYERS = 2 // come MIN_PLAYERS del backend
const PROVIDERS_PER_PAGE = 12

const STEP_TEXT: Record<SetupStep, { emoji: string; title: string; hint: string }> = {
  invite: { emoji: '👋', title: 'Chiama gli amici', hint: 'Condividi il link: intanto puoi già scegliere i filtri.' },
  platforms: { emoji: '📺', title: 'Dove guardate?', hint: 'Basta una. Nessuna scelta = tutte.' },
  genres: { emoji: '🎭', title: 'Che genere?', hint: '' },
  mood: { emoji: '🍿', title: 'Che serata è?', hint: 'Come costruiamo la pila.' },
  era: { emoji: '⏳', title: 'Epoca e durata', hint: 'Nuovi, classici, e quanto tempo avete.' },
  language: { emoji: '🌍', title: 'Lingua originale', hint: 'Basta una. Nessuna scelta = qualsiasi.' },
  themes: { emoji: '✨', title: 'Un tema?', hint: 'Basta uno. Nessuna scelta = qualsiasi.' },
  seen: { emoji: '👀', title: 'Già visti', hint: 'Così non ti ripropone film che conosci già.' },
  summary: { emoji: '🚀', title: 'Tutto pronto?', hint: 'Tocca una riga per cambiarla.' },
  wait: { emoji: '⏳', title: 'Fatto!', hint: '' },
}

/** Preparazione della partita: un passo per schermata, senza scorrere, con quanto manca. */
export default function Setup({ room, onLeave }: Props) {
  const state = room.data.state!
  const { catalog, error } = useCatalog()
  const isHost = state.you === state.host
  const steps = setupSteps(isHost, state.solo)
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const step = steps[Math.min(index, steps.length - 1)]

  // L'host lavora su una copia locale dei filtri (i clic ravvicinati non si perdono con la latenza);
  // se diventa host a metà (l'host è uscito) riparte da quelli del server.
  const [settings, setSettings] = useState<RoomSettings>(state.settings)
  const [vetoes, setVetoes] = useState<number[]>(loadVetoes)
  useEffect(() => {
    setSettings(state.settings)
    setIndex(0)
  }, [isHost])

  const set = (patch: Partial<RoomSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    room.setSettings(next)
  }
  const go = (target: number) => {
    setDirection(target >= index ? 'forward' : 'back')
    setIndex(Math.max(0, Math.min(target, steps.length - 1)))
  }

  const online = state.players.filter((p) => p.connected).length
  const needed = state.solo ? 1 : MIN_PLAYERS
  const vetoedBy = new Map(groupVetoes(state.players, catalog?.genres ?? []).map(({ genre, by }) => [genre.id, by]))
  // Il conteggio dal vivo usa i filtri come li userà la partita: con i veti di tutti (anche i miei
  // appena toccati, prima che il server li rimandi).
  const vetoedAll = [...new Set([...state.players.filter((p) => p.name !== state.you).flatMap((p) => p.vetoes), ...vetoes])]
  const count = useMovieCount(effectiveFilters(isHost ? settings : state.settings, vetoedAll))
  const noFilms = count.status === 'ready' && count.total === 0
  const text = STEP_TEXT[step]
  const vetoRow = vetoedBy.size
    ? { label: 'No grazie', value: [...vetoedBy].map(([id]) => catalog?.genres.find((g) => g.id === id)?.name ?? '…').join(', ') }
    : null

  if (state.phase === 'loading') {
    return (
      <main className="app fill center">
        <div className="loading-reel">🎞️</div>
        <h2>Cerco i film giusti…</h2>
        <p className="muted">{isHost ? 'Un attimo e si parte.' : `${state.host} ha avviato la partita.`}</p>
      </main>
    )
  }

  function toggleVeto(genre: number) {
    const next = toggle(vetoes, genre)
    setVetoes(next)
    saveVetoes(next) // valgono anche per le prossime stanze
    room.setVetoes(next)
  }

  function tapGenre(genre: number) {
    buzz(8)
    const current = settings.genres.includes(genre) && isHost ? 'yes' : vetoes.includes(genre) ? 'no' : 'none'
    const next = nextGenreState(current, isHost)
    if (isHost && (current === 'yes') !== (next === 'yes')) set({ genres: toggle(settings.genres, genre) })
    if ((current === 'no') !== (next === 'no')) toggleVeto(genre)
  }

  const body: Record<SetupStep, () => ReactNode> = {
    invite: () => <InviteStep room={room} />,
    platforms: () => <PlatformsStep settings={settings} catalog={catalog} onToggle={(id) => set({ platforms: toggle(settings.platforms, id) })} />,
    genres: () => (
      <>
        <p className="muted small step-hint">
          {isHost ? 'Tocca una volta per 👍 sì, due per 👎 no (il tuo veto), tre per tornare neutro.' : 'Tocca i generi che proprio non vuoi: basta il veto di uno per toglierli a tutti.'}
        </p>
        <div className="chips compact">
          {(catalog?.genres ?? []).map((g) => {
            const yes = isHost && settings.genres.includes(g.id)
            const mine = vetoes.includes(g.id)
            const others = (vetoedBy.get(g.id) ?? []).filter((name) => name !== state.you)
            return (
              <button
                key={g.id}
                type="button"
                className={`chip cap ${yes ? 'yes' : ''} ${mine ? 'no' : ''} ${!mine && others.length ? 'vetoed' : ''}`}
                aria-pressed={yes || mine}
                title={others.length ? `Vietato da ${others.join(', ')}` : undefined}
                onClick={() => tapGenre(g.id)}
              >
                {yes ? '👍 ' : mine ? '👎 ' : ''}
                {g.name}
              </button>
            )
          })}
        </div>
        {[...vetoedBy].some(([, by]) => by.some((n) => n !== state.you)) && (
          <p className="muted small">Barrati: vietati da altri giocatori.</p>
        )}
      </>
    ),
    mood: () => (
      <>
        <div className="kind-grid">
          {KINDS.map((k) => (
            <button key={k.value} type="button" className="kind" aria-pressed={settings.kind === k.value} onClick={() => set({ kind: k.value })}>
              <span className="kind-emoji">{k.emoji}</span>
              <strong>{k.label}</strong>
              <span className="muted small">{k.hint}</span>
            </button>
          ))}
        </div>
        <Group label="Voto">
          {RATINGS.map((r) => (
            <Chip
              key={r.label}
              pressed={settings.min_rating === r.min && settings.max_rating === r.max}
              onClick={() => set({ min_rating: r.min, max_rating: r.max })}
            >
              {r.label}
            </Chip>
          ))}
        </Group>
      </>
    ),
    era: () => (
      <>
        <Group label="Anni (anche più d'uno)">
          <Chip
            pressed={!settings.year_ranges.length && settings.year_min === null && settings.year_max === null}
            onClick={() => set({ year_ranges: [], year_min: null, year_max: null })}
          >
            Qualsiasi
          </Chip>
          {YEAR_RANGES.map((r) => (
            <Chip
              key={r.value}
              pressed={settings.year_ranges.includes(r.value)}
              onClick={() => set({ year_ranges: toggle(settings.year_ranges, r.value), year_min: null, year_max: null })}
            >
              {r.label}
            </Chip>
          ))}
        </Group>
        <Group label="Durata">
          {RUNTIMES.map((r) => (
            <Chip key={r.label} pressed={settings.max_runtime === r.value} onClick={() => set({ max_runtime: r.value })}>
              {r.label}
            </Chip>
          ))}
        </Group>
      </>
    ),
    language: () => (
      <div className="chips">
        {LANGUAGES.map((l) => (
          <Chip key={l.code} pressed={settings.languages.includes(l.code)} onClick={() => set({ languages: toggle(settings.languages, l.code) })}>
            {l.flag} {l.label}
          </Chip>
        ))}
      </div>
    ),
    themes: () => (
      <div className="chips compact">
        {(catalog?.themes ?? []).map((t) => (
          <Chip key={t.id} pressed={settings.themes.includes(t.id)} onClick={() => set({ themes: toggle(settings.themes, t.id) })}>
            {t.name}
          </Chip>
        ))}
      </div>
    ),
    seen: () => (
      <>
        <SeenCard onChange={room.setSeen} solo={state.solo} />
        {isHost && (
          <>
            <Group label="Quanti film nella pila?">
              {LIMITS.map((n) => (
                <Chip key={n} pressed={settings.limit === n} onClick={() => set({ limit: n })}>
                  {n}
                </Chip>
              ))}
            </Group>
            <label className="row small switch">
              <input type="checkbox" checked={settings.exclude_seen} onChange={(e) => set({ exclude_seen: e.target.checked })} />
              Nascondi i film già visti da {state.solo ? 'te' : 'qualcuno'}
            </label>
          </>
        )}
      </>
    ),
    summary: () => (
      <>
        <div className="summary">
          {describeSettings(settings, catalog).map((row) => (
            <button key={row.label} type="button" className="summary-row" onClick={() => go(steps.indexOf(row.step))}>
              <span className="label">{row.label}</span>
              <span className="summary-value">{row.value}</span>
              <span className="muted">›</span>
            </button>
          ))}
          {vetoRow && (
            <button type="button" className="summary-row" onClick={() => go(steps.indexOf('genres'))}>
              <span className="label">{vetoRow.label}</span>
              <span className="summary-value">👎 {vetoRow.value}</span>
              <span className="muted">›</span>
            </button>
          )}
        </div>
        {!state.solo && <Players room={room} />}
      </>
    ),
    wait: () => (
      <>
        <p className="muted step-hint">Aspettiamo che {state.host} avvii la partita. Le sue scelte, in diretta:</p>
        <div className="summary">
          {describeSettings(state.settings, catalog).map((row) => (
            <div key={row.label} className="summary-row static">
              <span className="label">{row.label}</span>
              <span className="summary-value">{row.value}</span>
            </div>
          ))}
          {vetoRow && (
            <div className="summary-row static">
              <span className="label">{vetoRow.label}</span>
              <span className="summary-value">👎 {vetoRow.value}</span>
            </div>
          )}
        </div>
        <Players room={room} />
      </>
    ),
  }

  const last = index >= steps.length - 1
  const canStart = isHost && online >= needed

  return (
    <main className="app fill setup">
      <header className="setup-head">
        <button className="icon-btn" aria-label="Indietro" disabled={index === 0} onClick={() => go(index - 1)}>
          ‹
        </button>
        <div className="grow">
          <div className="row spread small muted">
            <span>
              Passo {index + 1} di {steps.length}
            </span>
            {!state.solo && <span>Stanza {state.code}</span>}
          </div>
          <div className="steps-bar" aria-hidden>
            {steps.map((s, i) => (
              <button key={s} className={i <= index ? 'on' : ''} tabIndex={-1} onClick={() => isHost && go(i)} />
            ))}
          </div>
        </div>
        <button className="icon-btn" aria-label="Esci" onClick={() => window.confirm(state.solo ? 'Uscire?' : 'Uscire dalla stanza?') && onLeave()}>
          ✕
        </button>
      </header>

      <section key={step} className={`step ${direction}`}>
        <div className="step-title">
          <span className="step-emoji">{text.emoji}</span>
          <h1>{step === 'genres' && !isHost ? 'Cosa non vuoi?' : text.title}</h1>
          {text.hint && <p className="muted small">{text.hint}</p>}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="step-body">{body[step]()}</div>
      </section>

      <footer className="setup-foot">
        {step !== 'invite' && <LiveCount count={count} limit={(isHost ? settings : state.settings).limit} />}
        {step === 'summary' ? (
          <>
            <button className="btn primary big" disabled={!canStart || noFilms} onClick={() => (buzz(20), room.start())}>
              🎬 Inizia a swipare
            </button>
            {!canStart && <p className="muted small center-text">Serve almeno un altro giocatore: torna a "Chiama gli amici".</p>}
          </>
        ) : step === 'wait' ? (
          <button className="btn ghost" onClick={() => go(0)}>
            Cambia i tuoi veti o i film visti
          </button>
        ) : (
          <div className="row">
            {isHost && !last && index < steps.length - 2 && (
              <button className="btn ghost" onClick={() => go(steps.length - 1)}>
                Riepilogo ⏭
              </button>
            )}
            <button className="btn primary grow" onClick={() => go(index + 1)}>
              Avanti
            </button>
          </div>
        )}
      </footer>
    </main>
  )
}

/** "circa 3.120 film tra cui pescare": per accorgersi subito se i filtri sono troppo stretti. */
function LiveCount({ count, limit }: { count: MovieCount; limit: number }) {
  if (count.status === 'error') return null
  if (count.status === 'loading') return <p className="live-count muted small">🎞️ Conto i film…</p>
  const total = count.total.toLocaleString('it-IT')
  if (count.total === 0) return <p className="live-count warn small">😶 Nessun film con questi filtri: allargali un po'</p>
  if (count.total < limit) return <p className="live-count warn small">⚠️ Solo {total} film: la pila sarà corta</p>
  return (
    <p className="live-count muted small">
      🎞️ Circa <strong>{total}</strong> film tra cui pescare
    </p>
  )
}

function InviteStep({ room }: { room: RoomApi }) {
  const state = room.data.state!
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}/r/${state.code}`

  async function invite() {
    const outcome = await share(`🍿 Scegliamo il film di stasera insieme! Entra nella stanza ${state.code}:`, url)
    if (outcome === 'copied') {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <>
      <div className="invite">
        <span className="label">Codice stanza</span>
        <div className="room-code">{state.code}</div>
        <button className="btn primary" onClick={invite}>
          {copied ? '✓ Link copiato' : '📲 Invia il link'}
        </button>
      </div>
      <Players room={room} />
    </>
  )
}

function Players({ room }: { room: RoomApi }) {
  const state = room.data.state!
  const isHost = state.you === state.host
  return (
    <div className="field" style={{ gap: 8 }}>
      <span className="label">In stanza ({state.players.length})</span>
      <div className="chips">
        {state.players.map((p) => (
          <span key={p.name} className={`player-chip ${p.connected ? '' : 'off'}`}>
            {p.is_host && '👑 '}
            {p.name}
            {p.name === state.you && ' (tu)'}
            {p.seen > 0 && <span className="muted"> · 👀{p.seen}</span>}
            {isHost && p.name !== state.you && (
              <button
                className="chip-x"
                aria-label={`Rimuovi ${p.name}`}
                onClick={() => window.confirm(`Togliere ${p.name} dalla stanza?`) && room.kick(p.name)}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {state.players.length < MIN_PLAYERS && <span className="muted small">Qui compariranno gli amici appena entrano.</span>}
    </div>
  )
}

function PlatformsStep({
  settings,
  catalog,
  onToggle,
}: {
  settings: RoomSettings
  catalog: ReturnType<typeof useCatalog>['catalog']
  onToggle: (id: number) => void
}) {
  const [page, setPage] = useState(0)
  const providers = catalog?.providers ?? []
  const pages = Math.max(1, Math.ceil(providers.length / PROVIDERS_PER_PAGE))
  const shown = providers.slice(page * PROVIDERS_PER_PAGE, (page + 1) * PROVIDERS_PER_PAGE)
  if (!catalog) return <p className="muted">Carico le piattaforme…</p>
  return (
    <>
      <div className="providers">
        {shown.map((p) => (
          <button key={p.id} type="button" className="provider" aria-pressed={settings.platforms.includes(p.id)} onClick={() => (buzz(8), onToggle(p.id))}>
            {p.logo_url && <img src={p.logo_url} alt="" />}
            {p.name}
          </button>
        ))}
      </div>
      {pages > 1 && (
        <div className="row spread small">
          <button className="btn small ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹ Più usate
          </button>
          <span className="muted">
            {page + 1}/{pages}
          </span>
          <button className="btn small ghost" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>
            Altre ›
          </button>
        </div>
      )}
    </>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field" style={{ gap: 8 }}>
      <span className="label">{label}</span>
      <div className="chips">{children}</div>
    </div>
  )
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={() => (buzz(8), onClick())}>
      {children}
    </button>
  )
}
