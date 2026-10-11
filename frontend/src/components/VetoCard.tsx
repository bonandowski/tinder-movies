import { useState } from 'react'
import { groupVetoes, toggle } from '../filters'
import { loadVetoes, saveVetoes } from '../session'
import type { Genre, PlayerInfo } from '../types'

interface Props {
  you: string
  players: PlayerInfo[]
  genres: Genre[]
  solo: boolean
  onChange: (genres: number[]) => void
}

/** "I tuoi veti": generi che non vuoi. In gruppo basta il veto di uno per toglierli dalla pila. */
export default function VetoCard({ you, players, genres, solo, onChange }: Props) {
  const mine = players.find((p) => p.name === you)?.vetoes ?? loadVetoes()
  const [open, setOpen] = useState(false)
  const group = groupVetoes(players, genres)
  const names = (ids: number[]) => genres.filter((g) => ids.includes(g.id)).map((g) => g.name.toLowerCase())

  function pick(genre: number) {
    const next = toggle(mine, genre)
    saveVetoes(next) // valgono anche per le prossime stanze
    onChange(next)
  }

  return (
    <section className="card">
      <div className="row spread">
        <h2>{solo ? 'Generi da escludere' : 'I tuoi veti'}</h2>
        <button className="btn small ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Fatto' : mine.length ? 'Modifica' : 'Scegli'}
        </button>
      </div>
      <p className="muted small">
        {mine.length
          ? `Non vuoi: ${names(mine).join(', ')}.`
          : solo
            ? 'Generi che non vuoi proprio vedere.'
            : 'Generi che proprio non vuoi: basta il veto di uno per toglierli dalla pila di tutti.'}
      </p>
      {open && (
        <div className="chips">
          {genres.map((g) => (
            <button key={g.id} type="button" className="chip cap" aria-pressed={mine.includes(g.id)} onClick={() => pick(g.id)}>
              {g.name}
            </button>
          ))}
        </div>
      )}
      {!solo && group.some(({ by }) => by.some((name) => name !== you)) && (
        <p className="small">
          Veti del gruppo:{' '}
          {group.map(({ genre, by }, i) => (
            <span key={genre.id}>
              {i > 0 && ' · '}
              <strong>{genre.name}</strong> <span className="muted">({by.join(', ')})</span>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
