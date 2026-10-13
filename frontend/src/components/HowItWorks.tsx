/**
 * Mini animazione (solo CSS) che spiega l'app in 6 secondi: due amici, una pila di locandine.
 * Primo film: Lello 👎, Mimmo 👍 → la carta vola via. Secondo: 👍 tutti e due → MATCH! Poi ricomincia.
 */
export default function HowItWorks() {
  return (
    <div className="demo" role="img" aria-label="Esempio: Lello e Mimmo swipano gli stessi film; quando tutti e due dicono sì, è match">
      <div className="demo-player">
        <span className="demo-avatar">🙋‍♂️</span>
        <span className="demo-name">Lello</span>
        <span className="demo-react r-a1">👎</span>
        <span className="demo-react r-a2">👍</span>
      </div>

      <div className="demo-phone">
        <div className="demo-card c3">
          <span>🍕</span>
        </div>
        <div className="demo-card c2">
          <span>🚀</span>
          <b className="demo-stamp yes">SÌ</b>
        </div>
        <div className="demo-card c1">
          <span>🧟</span>
          <b className="demo-stamp no">NO</b>
        </div>
        <div className="demo-match">
          MATCH! <span>🍿</span>
        </div>
        <div className="demo-confetti" aria-hidden>
          {['🎉', '✨', '❤️', '⭐', '🎊', '✨'].map((e, i) => (
            <i key={i} style={{ left: `${8 + i * 16}%`, animationDelay: `${i * 0.05}s` }}>
              {e}
            </i>
          ))}
        </div>
      </div>

      <div className="demo-player">
        <span className="demo-avatar">🧔‍♂️</span>
        <span className="demo-name">Mimmo</span>
        <span className="demo-react r-l1">👍</span>
        <span className="demo-react r-l2">👍</span>
      </div>
    </div>
  )
}
