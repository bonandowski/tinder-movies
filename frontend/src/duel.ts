// La sfida finale della partita da solo: i film che ti sono piaciuti si scontrano a coppie
// (chi vince resta e affronta il successivo) finché ne rimane uno.

export interface Duel {
  champion: number
  queue: number[]
  out: number[]
}

export function startDuel(ids: number[]): Duel | null {
  if (ids.length === 0) return null
  return { champion: ids[0], queue: ids.slice(1), out: [] }
}

/** Il film sfidante del turno (null se è finita). */
export const challenger = (duel: Duel): number | null => duel.queue[0] ?? null

export const isDecided = (duel: Duel) => duel.queue.length === 0

/** Sfide fatte e totali, per mostrare "2 di 5". */
export const progress = (duel: Duel) => ({ done: duel.out.length, total: duel.out.length + duel.queue.length })

/** Sceglie fra campione e sfidante; qualsiasi altro id lascia la sfida com'è. */
export function choose(duel: Duel, winner: number): Duel {
  const rival = challenger(duel)
  if (rival === null || (winner !== duel.champion && winner !== rival)) return duel
  const loser = winner === duel.champion ? rival : duel.champion
  return { champion: winner, queue: duel.queue.slice(1), out: [...duel.out, loser] }
}

/** "Non so decidere": il caso sceglie fra quelli ancora in gara e la sfida finisce. */
export function decideAtRandom(duel: Duel, random: () => number = Math.random): Duel {
  const alive = [duel.champion, ...duel.queue]
  const winner = alive[Math.floor(random() * alive.length)]
  return { champion: winner, queue: [], out: [...duel.out, ...alive.filter((id) => id !== winner)] }
}

export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
