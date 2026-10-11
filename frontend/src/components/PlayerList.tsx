import type { PlayerInfo } from '../types'

const COLORS = ['#ff8fa3', '#ffc971', '#8de0a0', '#7fd1ff', '#b9a4ff', '#ff9d6c', '#6fe3d0', '#f4a6e6']

function colorFor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return COLORS[hash % COLORS.length]
}

interface Props {
  players: PlayerInfo[]
  you: string
  /** Con `total` mostra la barra di avanzamento di ognuno. */
  total?: number
  /** Se presente (solo per l'host) compare "Rimuovi" accanto agli altri giocatori. */
  onKick?: (name: string) => void
}

export default function PlayerList({ players, you, total, onKick }: Props) {
  return (
    <div className="field">
      {players.map((player) => (
        <div className="player" key={player.name}>
          <span className="avatar" style={{ background: colorFor(player.name) }} aria-hidden>
            {player.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="grow">
            <div className="row">
              <strong>{player.name}</strong>
              {player.name === you && <span className="muted small">(tu)</span>}
              {player.is_host && <span title="Ha creato la stanza">👑</span>}
              <span
                className={`dot ${player.connected ? '' : 'off'}`}
                title={player.connected ? 'Collegato' : 'Non collegato'}
              />
            </div>
            {player.seen > 0 && (
              <span className="muted small">{player.seen.toLocaleString('it-IT')} film visti collegati</span>
            )}
            {total ? (
              <div className="bar" aria-label={`${player.progress} su ${total}`}>
                <i style={{ width: `${(player.progress / total) * 100}%` }} />
              </div>
            ) : null}
          </div>
          {onKick && player.name !== you && (
            <button
              className="btn small ghost"
              onClick={() => window.confirm(`Togliere ${player.name} dalla stanza?`) && onKick(player.name)}
            >
              Rimuovi
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
