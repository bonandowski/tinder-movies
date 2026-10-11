import { useCallback, useEffect, useReducer, useRef } from 'react'
import { initialRoomData, roomReducer, type RoomData } from './roomReducer'
import { clearToken, loadToken, saveName, saveToken } from './session'
import type { ClientMessage, ServerMessage, StackSettings } from './types'

const PING_EVERY_MS = 25_000
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

function socketUrl(code: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/ws/${code}`
}

export interface RoomApi {
  data: RoomData
  setSettings(settings: StackSettings): void
  start(): void
  swipe(movieId: number, like: boolean): void
  finish(): void
  reset(): void
  kick(name: string): void
  /** Esce davvero dalla stanza (non è un semplice refresh). */
  leave(): void
  dismissMatch(): void
  clearNotice(): void
}

/**
 * Tiene aperto il WebSocket della stanza: entra con nome e token salvato, si riconnette da solo
 * se cade la rete e rimanda i voti non confermati (il server ignora i voti doppi).
 * `onFatal` scatta quando il server ci chiude fuori per sempre (stanza sparita, espulsione…).
 */
export function useRoom(code: string, name: string, onFatal: (message: string) => void): RoomApi {
  const [data, dispatch] = useReducer(roomReducer, initialRoomData)
  const socketRef = useRef<WebSocket | null>(null)
  const dataRef = useRef(data)
  const onFatalRef = useRef(onFatal)
  useEffect(() => {
    dataRef.current = data
    onFatalRef.current = onFatal
  })

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }, [])

  useEffect(() => {
    let stopped = false
    let attempt = 0
    let retryTimer: number | undefined
    let pingTimer: number | undefined

    const connect = () => {
      dispatch({ type: 'connection', value: attempt === 0 ? 'connecting' : 'reconnecting' })
      const socket = new WebSocket(socketUrl(code))
      socketRef.current = socket
      let fatal = false

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'join', name, token: loadToken(code) }))
        pingTimer = window.setInterval(() => send({ type: 'ping' }), PING_EVERY_MS)
      }

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage
        if (message.type === 'welcome') {
          attempt = 0
          saveToken(code, message.token)
          saveName(message.name)
          dispatch({ type: 'connection', value: 'open' })
          // Dopo una caduta di rete: rimandiamo i voti, al server quelli già noti non fanno nulla.
          for (const [movieId, like] of Object.entries(dataRef.current.votes)) {
            send({ type: 'swipe', movie_id: Number(movieId), like })
          }
        } else if (message.type === 'error' && message.fatal) {
          fatal = true
          clearToken(code)
          onFatalRef.current(message.message)
          return
        }
        dispatch({ type: 'message', message })
      }

      socket.onclose = () => {
        window.clearInterval(pingTimer)
        if (stopped || fatal) return
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
        attempt += 1
        dispatch({ type: 'connection', value: 'reconnecting' })
        retryTimer = window.setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      stopped = true
      window.clearTimeout(retryTimer)
      window.clearInterval(pingTimer)
      socketRef.current?.close()
    }
  }, [code, name, send])

  // L'avviso sparisce da solo.
  const notice = data.notice
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => dispatch({ type: 'clear_notice' }), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  return {
    data,
    setSettings: (settings) => send({ type: 'set_settings', settings }),
    start: () => send({ type: 'start' }),
    swipe: (movieId, like) => {
      dispatch({ type: 'vote', movieId, like })
      send({ type: 'swipe', movie_id: movieId, like })
    },
    finish: () => send({ type: 'finish' }),
    reset: () => send({ type: 'reset' }),
    kick: (kicked) => send({ type: 'kick', name: kicked }),
    leave: () => {
      send({ type: 'leave' })
      clearToken(code)
    },
    dismissMatch: () => dispatch({ type: 'dismiss_match' }),
    clearNotice: () => dispatch({ type: 'clear_notice' }),
  }
}
