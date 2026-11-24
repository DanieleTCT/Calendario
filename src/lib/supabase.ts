import { createClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { setDatabaseStatus, getDatabaseStatus } from './databaseStatus'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
let activeUser: User | null = null
let syncTimer: number | undefined
let syncInFlight: Promise<void> | null = null
let sessionGeneration = 0

function isRestRequest(input: RequestInfo | URL) {
  const url = input instanceof Request ? input.url : String(input)
  return url.includes('/rest/v1/')
}

function restResource(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : String(input))
  return url.pathname.match(/\/rest\/v1\/([^/]+)/)?.[1] ?? ''
}

function isNetworkFailure(error: unknown) {
  return error instanceof TypeError
    || (error instanceof DOMException && error.name === 'AbortError')
}

async function localFetch(request: Request) {
  const localDatabase = await import('./localDatabase')
  const user = activeUser ? { id: activeUser.id, email: activeUser.email } : null
  const response = await localDatabase.handleLocalDatabaseRequest(request, user)
  if (response.status >= 500) {
    setDatabaseStatus('error', 'Database locale non disponibile. Controlla il messaggio restituito dalla richiesta.')
  } else {
    setDatabaseStatus('offline', 'Supabase non raggiungibile: operazioni sulle tabelle applicative salvate nel database locale.')
  }
  return response
}

async function hybridFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const databaseRequest = import.meta.env.DEV && isRestRequest(input)
  const request = databaseRequest
    ? input instanceof Request ? input.clone() : new Request(input, init)
    : null
  try {
    const response = await fetch(input, init)
    if (!databaseRequest || !request) return response
    if (response.status >= 500) return await localFetch(request)
    if (response.ok) {
      if (getDatabaseStatus().mode === 'offline' && activeUser) void synchronizeNow()
      else if (getDatabaseStatus().mode === 'checking') setDatabaseStatus('online')
      const resource = restResource(request)
      const responseData = await response.clone().json().catch(() => null) as unknown
      if (resource && resource !== 'rpc' && responseData !== null) {
        void import('./localDatabase')
          .then((localDatabase) => localDatabase.mirrorRemoteResponse(resource, request.method, responseData))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Errore durante la cache locale.'
            setDatabaseStatus('error', `Supabase risponde ma la cache locale non è aggiornata: ${message}`)
          })
      }
    }
    return response
  } catch (error) {
    if (!databaseRequest || !request || !isNetworkFailure(error)) throw error
    return await localFetch(request)
  }
}

const remoteClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: hybridFetch } })
  : null

async function synchronizeNow(generation = sessionGeneration) {
  if (!remoteClient || !supabaseUrl || !supabaseAnonKey || !activeUser || !import.meta.env.DEV) return
  if (syncInFlight) return await syncInFlight
  const user = activeUser
  syncInFlight = (async () => {
    try {
      const { data: sessionData, error: sessionError } = await remoteClient.auth.getSession()
      if (sessionError) throw sessionError
      const session = sessionData.session
      if (!session || session.user.id !== user.id) {
        if (generation === sessionGeneration) setDatabaseStatus('checking')
        return
      }

      setDatabaseStatus('syncing', 'Connessione ripristinata: sincronizzazione per record in corso.')
      const localDatabase = await import('./localDatabase')
      const syncResult = await localDatabase.synchronizeLocalDatabase(
        supabaseUrl,
        supabaseAnonKey,
        session.access_token,
        { id: user.id, email: user.email },
        (progress) => {
          if (generation === sessionGeneration && activeUser?.id === user.id) {
            setDatabaseStatus('syncing', `Sincronizzazione: ${progress}.`)
          }
        },
      )
      if (generation === sessionGeneration && activeUser?.id === user.id) {
        if (syncResult.discardedLockedChanges > 0) {
          setDatabaseStatus(
            'warning',
            `${syncResult.discardedLockedChanges} modifiche locali a titoli o partecipanti sono state scartate: la sessione era già avviata.`,
          )
        } else {
          setDatabaseStatus('online', 'Database Supabase e copia locale sincronizzati.')
        }
      }
    } catch (error) {
      if (generation !== sessionGeneration) return
      if (isNetworkFailure(error)) {
        setDatabaseStatus('offline', 'Supabase non raggiungibile: il database locale resta attivo.')
      } else {
        const message = error instanceof Error ? error.message : 'Errore di sincronizzazione.'
        setDatabaseStatus('error', message)
      }
    } finally {
      syncInFlight = null
      if (generation !== sessionGeneration && activeUser) void synchronizeNow(sessionGeneration)
    }
  })()
  await syncInFlight
}

export function setActiveDatabaseUser(user: User | null) {
  const userChanged = activeUser?.id !== user?.id
  activeUser = user
  sessionGeneration += 1
  if (syncTimer !== undefined) window.clearInterval(syncTimer)
  syncTimer = undefined
  if (userChanged) setDatabaseStatus('checking')
  if (!import.meta.env.DEV || !user) return

  const generation = sessionGeneration
  void synchronizeNow(generation)
  syncTimer = window.setInterval(() => { void synchronizeNow(generation) }, 30_000)
}

export const supabase = remoteClient
