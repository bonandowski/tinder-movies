import { useCallback, useEffect, useState } from 'react'
import Home from './components/Home'
import RoomPage from './components/RoomPage'

/** `/r/ABCD` è una stanza, tutto il resto è la home. */
export function parseRoute(path: string): { kind: 'home' } | { kind: 'room'; code: string } {
  const match = /^\/r\/([A-Za-z0-9]{4})\/?$/.exec(path)
  return match ? { kind: 'room', code: match[1].toUpperCase() } : { kind: 'home' }
}

export type Navigate = (to: string, message?: string) => void

export default function App() {
  const [path, setPath] = useState(location.pathname)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate: Navigate = useCallback((to, message) => {
    history.pushState(null, '', to)
    setPath(to)
    setFlash(message ?? null)
    window.scrollTo(0, 0)
  }, [])

  const route = parseRoute(path)
  if (route.kind === 'room') {
    return <RoomPage key={route.code} code={route.code} navigate={navigate} />
  }
  return <Home flash={flash} navigate={navigate} />
}
