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
