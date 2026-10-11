import { useEffect, useImperativeHandle, useRef, type PointerEvent, type Ref } from 'react'
import { movieFacts } from '../format'
import type { Movie } from '../types'

export interface CardHandle {
  swipe: (like: boolean) => void
}

/** Quanto bisogna trascinare (px) perché il rilascio valga come voto. */
export const SWIPE_THRESHOLD = 90
const FLY_MS = 220

interface Props {
  movie: Movie
  /** Vero solo per la carta in cima: l'altra sta sotto e non risponde ai tocchi. */
  active: boolean
  onSwipe: (like: boolean) => void
  onInfo: () => void
  ref?: Ref<CardHandle>
}

/** Decide cosa fa un rilascio: voto a destra/sinistra se si è trascinato abbastanza, altrimenti niente. */
export function releaseDecision(dx: number): 'like' | 'nope' | 'stay' {
  if (dx > SWIPE_THRESHOLD) return 'like'
  if (dx < -SWIPE_THRESHOLD) return 'nope'
  return 'stay'
}

export default function SwipeCard({ movie, active, onSwipe, onInfo, ref }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; moved: boolean } | null>(null)
  const leaving = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ onSwipe, onInfo })
  useEffect(() => {
    latest.current = { onSwipe, onInfo }
  })
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function place(dx: number, dy: number, animate: boolean) {
    const node = element.current
    if (!node) return
    node.style.transition = animate ? `transform ${FLY_MS}ms ease-out` : 'none'
    node.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`
    node.style.setProperty('--dx', String(dx))
  }

  function fly(like: boolean) {
    if (leaving.current) return
    leaving.current = true
    place((like ? 1 : -1) * window.innerWidth * 1.3, -40, true)
    timer.current = window.setTimeout(() => latest.current.onSwipe(like), FLY_MS)
  }

  useImperativeHandle(ref, () => ({ swipe: fly }))

  function down(event: PointerEvent<HTMLDivElement>) {
    if (!active || leaving.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, moved: false }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    g.dx = event.clientX - g.x
    const dy = event.clientY - g.y
    if (!g.moved && Math.hypot(g.dx, dy) > 8) g.moved = true
    if (g.moved) place(g.dx, dy * 0.3, false)
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    gesture.current = null
    if (!g.moved) return latest.current.onInfo() // un tocco apre la scheda del film
    const decision = releaseDecision(g.dx)
    if (decision === 'stay') place(0, 0, true)
    else fly(decision === 'like')
  }

  function cancel() {
    gesture.current = null
    if (!leaving.current) place(0, 0, true)
  }

  return (
    <div
      ref={element}
      className={`movie-card ${active ? '' : 'behind'}`}
      style={{ backgroundImage: `url(${movie.poster_url})` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      <div className="shade" />
      <span className="stamp like">SÌ</span>
      <span className="stamp nope">NO</span>
      <div className="caption">
        <h2>{movie.title}</h2>
        <p className="muted">{movieFacts(movie)}</p>
        <div className="logos">
          {movie.providers.slice(0, 6).map(
            (p) => p.logo_url && <img key={p.id} src={p.logo_url} alt={p.name} title={p.name} draggable={false} />,
          )}
        </div>
      </div>
    </div>
  )
}
