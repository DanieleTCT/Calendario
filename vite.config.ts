import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { catalogHandler } from './api/catalog.js'
import { scheduleHandler } from './api/schedules.js'

const disabledLocalDatabase = fileURLToPath(new URL('./src/lib/localDatabase.disabled.ts', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
    resolve: {
      alias: mode === 'development'
        ? []
        : [{ find: './localDatabase', replacement: disabledLocalDatabase }],
    },
    plugins: [react(), {
      name: 'api-routes',
      configureServer(server) {
        server.middlewares.use('/api/catalog', (req, res) => {
          void catalogHandler(req, res, {
            token: env.TMDB_READ_ACCESS_TOKEN,
            supabaseUrl: env.VITE_SUPABASE_URL,
            supabaseKey: env.VITE_SUPABASE_ANON_KEY,
          })
        })
        server.middlewares.use('/api/schedules', (req, res) => {
          void scheduleHandler(req, res, {
            supabaseUrl: env.VITE_SUPABASE_URL,
            supabaseKey: env.VITE_SUPABASE_ANON_KEY,
          })
        })
      },
    }],
  }
})
