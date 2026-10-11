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
  ids: number[]
  /** Film nel file e film riconosciuti. */
  total: number
  matched: number
  source: string
  importedAt: string
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
