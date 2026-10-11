import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In sviluppo il frontend gira su :5173 e inoltra API e WebSocket al backend FastAPI.
const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/ws': { target: backend, ws: true },
    },
  },
  test: { environment: 'node' },
})
