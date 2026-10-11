import { useState } from 'react'
import type { Catalog } from '../useCatalog'
import type { StackSettings } from '../types'

const YEARS: { label: string; value: number | null }[] = [
  { label: 'Qualsiasi', value: null },
  { label: 'Dal 1990', value: 1990 },
  { label: 'Dal 2000', value: 2000 },
  { label: 'Dal 2010', value: 2010 },
  { label: 'Dal 2020', value: 2020 },
]
const RUNTIMES: { label: string; value: number | null }[] = [
  { label: 'Qualsiasi', value: null },
  { label: 'Max 90 min', value: 90 },
  { label: 'Max 2 h', value: 120 },
  { label: 'Max 2 h 30', value: 150 },
]
const LIMITS = [10, 20, 30, 50]
const VISIBLE_PROVIDERS = 12

const toggle = (list: number[], id: number) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

interface Props {
  settings: StackSettings
  catalog: Catalog | null
  onChange: (settings: StackSettings) => void
}

/** Filtri modificabili (solo l'host li vede così). */
export function FiltersEditor({ settings, catalog, onChange }: Props) {
  const [allProviders, setAllProviders] = useState(false)
  const providers = catalog?.providers ?? []
  const shown = allProviders
    ? providers
    : providers.filter((p, i) => i < VISIBLE_PROVIDERS || settings.platforms.includes(p.id))

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
              onClick={() => onChange({ ...settings, platforms: toggle(settings.platforms, p.id) })}
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
          {(catalog?.genres ?? []).map((g) => (
            <button
              key={g.id}
              type="button"
              className="chip cap"
              aria-pressed={settings.genres.includes(g.id)}
              onClick={() => onChange({ ...settings, genres: toggle(settings.genres, g.id) })}
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>

      <Choice
        label="Uscito"
        options={YEARS}
        value={settings.year_min}
        onPick={(year_min) => onChange({ ...settings, year_min })}
      />
      <Choice
        label="Durata"
        options={RUNTIMES}
        value={settings.max_runtime}
        onPick={(max_runtime) => onChange({ ...settings, max_runtime })}
      />
      <Choice
        label="Quanti film"
        options={LIMITS.map((n) => ({ label: String(n), value: n }))}
        value={settings.limit}
        onPick={(limit) => onChange({ ...settings, limit: limit ?? 30 })}
      />
    </div>
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
    <div className="field">
      <span className="label">{label}</span>
      <div className="chips">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="chip"
            aria-pressed={option.value === value}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Riepilogo dei filtri per chi non è l'host. */
export function FiltersSummary({ settings, catalog }: Omit<Props, 'onChange'>) {
  const names = (ids: number[], source: { id: number; name: string }[] = []) =>
    ids.length ? ids.map((id) => source.find((s) => s.id === id)?.name ?? '…').join(', ') : 'tutte'
  const lines: [string, string][] = [
    ['Piattaforme', names(settings.platforms, catalog?.providers)],
    ['Generi', names(settings.genres, catalog?.genres)],
    ['Uscito', settings.year_min ? `dal ${settings.year_min}` : 'qualsiasi'],
    ['Durata', settings.max_runtime ? `max ${settings.max_runtime} min` : 'qualsiasi'],
    ['Quanti film', String(settings.limit)],
  ]
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
