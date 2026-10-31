import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { catalogHandler } from './api/catalog.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), {
      name: 'catalog-api',
      configureServer(server) {
        server.middlewares.use('/api/catalog', (req, res) => {
          void catalogHandler(req, res, {
            token: env.TMDB_READ_ACCESS_TOKEN,
            supabaseUrl: env.VITE_SUPABASE_URL,
            supabaseKey: env.VITE_SUPABASE_ANON_KEY,
          })
        })
      },
    }],
  }
})
