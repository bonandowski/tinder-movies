// Nome e token dei giocatori stanno nel browser: con il token si rientra nella stanza dopo un refresh.

const NAME_KEY = 'tm:name'
const tokenKey = (code: string) => `tm:token:${code}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // storage bloccato (es. navigazione privata): si va avanti senza
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* vedi sopra */
  }
}

export const loadName = () => read(NAME_KEY) ?? ''
export const saveName = (name: string) => write(NAME_KEY, name)
export const loadToken = (code: string) => read(tokenKey(code))
export const saveToken = (code: string, token: string) => write(tokenKey(code), token)
export const clearToken = (code: string) => write(tokenKey(code), null)

// I film già visti (id TMDB) restano solo nel browser: al server arrivano quando si entra in una stanza.

const SEEN_KEY = 'tm:seen'

export interface SeenData {
  /** Tutti i film visti noti: l'unione di export e RSS, che si accumula nel tempo. */
  ids: number[]
  /** L'ultimo export caricato: film nel file e film riconosciuti. */
  exportInfo?: { total: number; matched: number; source: string; importedAt: string }
  /** Utente Letterboxd da cui leggere la RSS (ultimi ~50 film del diario). */
  username?: string
  syncedAt?: string
  /** L'ultima RSS era piena: nel diario ci sono film più vecchi, che arrivano solo dall'export. */
  feedTruncated?: boolean
}

export function loadSeen(): SeenData | null {
  const raw = read(SEEN_KEY)
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as SeenData
    const valid =
      Array.isArray(data.ids) && data.ids.every((id) => Number.isInteger(id) && id > 0)
    return valid ? data : null
  } catch {
    return null
  }
}

export const saveSeen = (data: SeenData) => write(SEEN_KEY, JSON.stringify(data))
export const clearSeen = () => write(SEEN_KEY, null)

// I propri veti (generi da escludere) valgono per ogni stanza, come i film visti.

const VETOES_KEY = 'tm:vetoes'

export function loadVetoes(): number[] {
  try {
    const data: unknown = JSON.parse(read(VETOES_KEY) ?? '[]')
    return Array.isArray(data) ? data.filter((id): id is number => Number.isInteger(id)) : []
  } catch {
    return []
  }
}

export const saveVetoes = (genres: number[]) => write(VETOES_KEY, JSON.stringify(genres))
