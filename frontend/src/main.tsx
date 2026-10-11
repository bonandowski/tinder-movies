import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Niente StrictMode: in sviluppo monterebbe due volte la stanza e aprirebbe due WebSocket,
// cioè due giocatori con lo stesso nome.
createRoot(document.getElementById('root')!).render(<App />)
