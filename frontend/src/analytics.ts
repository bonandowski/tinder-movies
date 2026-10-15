// Statistiche anonime con GoatCounter (script in index.html): niente cookie, solo conteggi.

interface GoatCounter {
  count(vars: { path: string; title?: string; event?: boolean }): void
}

declare global {
  interface Window {
    goatcounter?: GoatCounter
  }
}

export type AppEvent = 'sessione-creata' | 'sessione-da-solo' | 'entra-con-codice' | 'entra-da-link' | 'partita-avviata' | 'match' | 'scelta-da-solo'

/** Conta un evento; se lo script è bloccato (adblock) o non ancora caricato, pazienza. */
export function track(event: AppEvent) {
  try {
    window.goatcounter?.count({ path: event, event: true })
  } catch {
    /* le statistiche non devono mai rompere l'app */
  }
}
