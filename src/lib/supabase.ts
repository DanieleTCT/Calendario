import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { setDatabaseStatus } from './databaseStatus'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function isSupabaseRequest(input: RequestInfo | URL) {
  try {
    if (!supabaseUrl) return false
    const requestUrl = input instanceof Request ? input.url : String(input)
    return new URL(requestUrl).origin === new URL(supabaseUrl).origin
  } catch {
    return false
  }
}

async function monitoredFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const response = await fetch(input, init)
    if (isSupabaseRequest(input)) setDatabaseStatus('online')
    return response
  } catch (error) {
    if (isSupabaseRequest(input) && error instanceof TypeError) {
      setDatabaseStatus('offline', 'Supabase non raggiungibile: verifica la connessione e la configurazione del progetto.')
    }
    throw error
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  setDatabaseStatus('error', 'Configurazione Supabase mancante: controlla VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.')
}

const remoteClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: monitoredFetch } })
  : null

export function setActiveDatabaseUser(_user: User | null) {
  if (!remoteClient) {
    setDatabaseStatus('error', 'Configurazione Supabase mancante: controlla VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.')
    return
  }
  setDatabaseStatus('checking')
}

export const supabase = remoteClient
