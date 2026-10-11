import { useState, type ReactNode } from 'react'
import { activeAdvancedCount, KINDS, LANGUAGES, LIMITS, MIN_RATINGS, RUNTIMES, toggle, YEAR_RANGES, yearRangeLabel } from '../filters'
import type { Catalog } from '../useCatalog'
import type { RoomSettings } from '../types'

const VISIBLE_PROVIDERS = 12

interface Props {
  settings: RoomSettings
  catalog: Catalog | null
  /** Generi vietati da qualcuno (id -> nomi): nei filtri si vedono barrati. */
  vetoed: Map<number, string[]>
  onChange: (settings: RoomSettings) => void
}

/**
 * Filtri modificabili (solo l'host li vede così): i principali, poi "Altri filtri".
 *
 * Si lavora su una copia locale: ogni modifica parte dall'ultima fatta qui, non dall'ultimo stato
 * confermato dal server. Altrimenti, con un po' di latenza, due clic ravvicinati si annullano.
 * Va bene perché i filtri li cambia solo l'host.
 */
export function FiltersEditor({ settings: initial, catalog, vetoed, onChange }: Props) {
  const [settings, setSettings] = useState(initial)
  const [allProviders, setAllProviders] = useState(false)
  const [advanced, setAdvanced] = useState(() => activeAdvancedCount(settings) > 0)
  const providers = catalog?.providers ?? []
  const shown = allProviders
    ? providers
    : providers.filter((p, i) => i < VISIBLE_PROVIDERS || settings.platforms.includes(p.id))
  const set = (patch: Partial<RoomSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    onChange(next)
  }
  const active = activeAdvancedCount(settings)

  return (
    <div className="field" style={{ gap: 18 }}>
      <div className="field">
        <span className="label">Piattaforme (basta una)</span>
        {!catalog && <span className="muted small">Carico…</span>}
        <div className="providers">
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              className="provider"
              aria-pressed={settings.platforms.includes(p.id)}
              onClick={() => set({ platforms: toggle(settings.platforms, p.id) })}
            >
              {p.logo_url && <img src={p.logo_url} alt="" loading="lazy" />}
              {p.name}
            </button>
          ))}
        </div>
        {providers.length > VISIBLE_PROVIDERS && (
          <button type="button" className="btn small ghost" onClick={() => setAllProviders(!allProviders)}>
            {allProviders ? 'Mostra meno' : `Mostra tutte (${providers.length})`}
          </button>
        )}
      </div>

      <div className="field">
        <span className="label">Generi (basta uno)</span>
        <div className="chips">
          {(catalog?.genres ?? []).map((g) => {
            const by = vetoed.get(g.id)
            return (
              <button
                key={g.id}
                type="button"
                className={`chip cap ${by ? 'vetoed' : ''}`}
                aria-pressed={settings.genres.includes(g.id)}
                title={by ? `Vietato da ${by.join(', ')}` : undefined}
                onClick={() => set({ genres: toggle(settings.genres, g.id) })}
              >
                {g.name}
              </button>
            )
          })}
        </div>
        {vetoed.size > 0 && <span className="muted small">I generi barrati sono vietati da qualcuno: non ci saranno.</span>}
      </div>

      <Choice
        label="Quanti film"
        options={LIMITS.map((n) => ({ label: String(n), value: n }))}
        value={settings.limit}
        onPick={(limit) => set({ limit: limit ?? 30 })}
      />

      <button type="button" className="btn small ghost" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
        {advanced ? 'Meno filtri' : 'Altri filtri'}
        {active > 0 && ` (${active} attiv${active === 1 ? 'o' : 'i'})`}
      </button>

      {advanced && (
        <div className="field" style={{ gap: 18 }}>
          <Group label="Tipo di pila" hint={KINDS.find((k) => k.value === settings.kind)?.hint}>
            {KINDS.map((k) => (
              <Chip key={k.value} pressed={settings.kind === k.value} onClick={() => set({ kind: k.value })}>
                {k.label}
              </Chip>
            ))}
          </Group>

          <Choice label="Voto minimo" options={MIN_RATINGS} value={settings.min_rating} onPick={(min_rating) => set({ min_rating })} />

          <Group label="Anni">
            {YEAR_RANGES.map((r) => (
              <Chip
                key={r.label}
                pressed={settings.year_min === r.min && settings.year_max === r.max}
                onClick={() => set({ year_min: r.min, year_max: r.max })}
              >
                {r.label}
              </Chip>
            ))}
          </Group>

          <Group label="Lingua originale (basta una)">
            {LANGUAGES.map((l) => (
              <Chip key={l.code} pressed={settings.languages.includes(l.code)} onClick={() => set({ languages: toggle(settings.languages, l.code) })}>
                {l.label}
              </Chip>
            ))}
          </Group>

          <Group label="Temi (basta uno)">
            {(catalog?.themes ?? []).map((t) => (
              <Chip key={t.id} pressed={settings.themes.includes(t.id)} onClick={() => set({ themes: toggle(settings.themes, t.id) })}>
                {t.name}
              </Chip>
            ))}
          </Group>

          <Choice label="Durata" options={RUNTIMES} value={settings.max_runtime} onPick={(max_runtime) => set({ max_runtime })} />

          <Group label="Film già visti">
            <Chip pressed={settings.exclude_seen} onClick={() => set({ exclude_seen: true })}>
              Nascondi quelli visti da qualcuno
            </Chip>
            <Chip pressed={!settings.exclude_seen} onClick={() => set({ exclude_seen: false })}>
              Mostrali comunque
            </Chip>
          </Group>
        </div>
      )}
    </div>
  )
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="chips">{children}</div>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  )
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}

function Choice({
  label,
  options,
  value,
  onPick,
}: {
  label: string
  options: { label: string; value: number | null }[]
  value: number | null
  onPick: (value: number | null) => void
}) {
  return (
    <Group label={label}>
      {options.map((option) => (
        <Chip key={option.label} pressed={option.value === value} onClick={() => onPick(option.value)}>
          {option.label}
        </Chip>
      ))}
    </Group>
  )
}

/** Riepilogo dei filtri per chi non è l'host: i principali sempre, gli altri solo se attivi. */
export function FiltersSummary({ settings, catalog }: Omit<Props, 'onChange' | 'vetoed'>) {
  const names = (ids: (number | string)[], source: { id: number | string; name: string }[] = [], all = 'tutti') =>
    ids.length ? ids.map((id) => source.find((s) => s.id === id)?.name ?? '…').join(', ') : all
  const lines: [string, string][] = [
    ['Piattaforme', names(settings.platforms, catalog?.providers, 'tutte')],
    ['Generi', names(settings.genres, catalog?.genres)],
    ['Quanti film', String(settings.limit)],
  ]
  if (settings.kind !== 'popular') lines.push(['Tipo di pila', KINDS.find((k) => k.value === settings.kind)?.label ?? ''])
  if (settings.min_rating !== null) lines.push(['Voto minimo', `${String(settings.min_rating).replace('.', ',')}+`])
  if (settings.year_min !== null || settings.year_max !== null) lines.push(['Anni', yearRangeLabel(settings) ?? ''])
  if (settings.languages.length)
    lines.push(['Lingua originale', names(settings.languages, LANGUAGES.map((l) => ({ id: l.code, name: l.label })))])
  if (settings.themes.length) lines.push(['Temi', names(settings.themes, catalog?.themes)])
  if (settings.max_runtime !== null) lines.push(['Durata', `max ${settings.max_runtime} min`])
  lines.push(['Film già visti', settings.exclude_seen ? 'nascosti (se qualcuno li ha collegati)' : 'mostrati comunque'])
  return (
    <div className="field">
      {lines.map(([label, value]) => (
        <div key={label}>
          <span className="label">{label}</span>
          <p>{value}</p>
        </div>
      ))}
    </div>
  )
}
