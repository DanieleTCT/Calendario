import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Check, ExternalLink, RefreshCw, Unlink } from 'lucide-react'
import { supabase } from './lib/supabase'

type GoogleCalendar = {
  id: string
  summary: string
  timeZone: string
  primary: boolean
  selected: boolean
  lastSyncedAt: string | null
}

type GoogleApiResponse = {
  error?: string
  connected?: boolean
  calendars?: GoogleCalendar[]
  authorizationUrl?: string
  updated?: number
  selected?: number
  disconnected?: boolean
  revoked?: boolean
}

async function requestGoogleCalendar(action: string, method: 'GET' | 'POST', calendarId: string, body?: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase non è configurato.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('Accedi di nuovo per gestire Google Calendar.')
  const url = new URL('/api/google-calendar', window.location.origin)
  url.searchParams.set('action', action)
  if (method === 'GET') url.searchParams.set('calendarId', calendarId)
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify({ calendarId, ...body }) } : {}),
  })
  const result = await response.json() as GoogleApiResponse
  if (!response.ok) throw new Error(result.error || `Richiesta non riuscita (HTTP ${response.status}).`)
  return result
}

export function GoogleCalendarSettings({
  calendarId,
  onSynced,
}: {
  calendarId: string
  onSynced: () => void
}) {
  const [connected, setConnected] = useState(false)
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadCalendars = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await requestGoogleCalendar('calendars', 'GET', calendarId)
      setConnected(result.connected === true)
      setCalendars(result.calendars ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare i calendari Google.')
    } finally {
      setLoading(false)
    }
  }, [calendarId])

  useEffect(() => {
    void loadCalendars()
  }, [loadCalendars])

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await requestGoogleCalendar('authorize', 'POST', calendarId)
      if (!result.authorizationUrl) throw new Error('Google non ha restituito il collegamento di autorizzazione.')
      window.location.assign(result.authorizationUrl)
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Impossibile collegare Google Calendar.')
      setBusy(false)
    }
  }

  const toggleCalendar = (calendar: GoogleCalendar) => {
    setCalendars((current) => current.map((entry) => entry.id === calendar.id
      ? { ...entry, selected: !entry.selected }
      : entry))
  }

  const saveSelection = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const selectedIds = calendars.filter((entry) => entry.selected).map((entry) => entry.id)
      const result = await requestGoogleCalendar('select', 'POST', calendarId, { googleCalendarIds: selectedIds })
      if (result.selected !== selectedIds.length) throw new Error('Google non ha confermato tutti i calendari selezionati.')
      const sync = await requestGoogleCalendar('sync', 'POST', calendarId)
      setNotice(`Selezione salvata; ${sync.updated ?? 0} eventi aggiornati.`)
      await loadCalendars()
      onSynced()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Impossibile salvare la selezione.')
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await requestGoogleCalendar('sync', 'POST', calendarId)
      setNotice(`${result.updated ?? 0} eventi Google Calendar aggiornati.`)
      await loadCalendars()
      onSynced()
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Sincronizzazione Google Calendar non riuscita.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Scollegare Google Calendar da questo spazio e rimuovere qui gli eventi importati? Gli eventi originali su Google non verranno modificati.')) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await requestGoogleCalendar('disconnect', 'POST', calendarId)
      setConnected(false)
      setCalendars([])
      setNotice(result.revoked === false
        ? 'Collegamento e dati locali rimossi, ma Google non ha confermato la revoca. Puoi revocare Family Calendar dalle impostazioni di sicurezza del tuo account Google.'
        : 'Google Calendar scollegato e autorizzazione revocata; gli eventi originali su Google non sono stati modificati.')
      onSynced()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Impossibile scollegare Google Calendar.')
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = calendars.filter((entry) => entry.selected).length
  const serverConfigurationMissing = error.startsWith('Configurazione Google Calendar incompleta sul server.')

  return <section className="feature-page google-calendar-settings">
    <header className="feature-hero">
      <span className="feature-kicker">SOLO NELLA TUA VISUALIZZAZIONE</span>
      <h2>Google Calendar</h2>
      <p>Collega i tuoi calendari Google in sola lettura. Eventi e modifiche Google appaiono qui, senza essere condivisi con gli altri membri e senza mai scrivere su Google.</p>
    </header>
    {serverConfigurationMissing
      ? <div className="google-configuration-warning" role="alert">
        <strong>Configurazione Google da completare sul server</strong>
        <p>Il gestore dell’app deve impostare le credenziali tecniche una sola volta. Non inserire qui chiavi Supabase, segreti OAuth o la password Google.</p>
        <details>
          <summary>Mostra i dettagli per il gestore</summary>
          <p>{error}</p>
        </details>
        <p>Dopo la configurazione, ogni utente potrà collegare il proprio account dal pulsante qui sotto tramite autorizzazione Google in sola lettura.</p>
      </div>
      : error && <p className="form-message form-error" role="alert">{error}</p>}
    {notice && <p className="form-message form-notice" role="status">{notice}</p>}
    {loading
      ? <p>Controllo del collegamento Google…</p>
      : !connected
        ? <section className="feature-card google-connect-card">
          <CalendarDays size={26} aria-hidden="true" />
          <div><h3>Collega un account Google</h3><p>Verrà richiesta l’autorizzazione di sola lettura ai calendari.</p></div>
          <button
            className="primary-button"
            disabled={busy || serverConfigurationMissing}
            title={serverConfigurationMissing ? 'Il gestore deve completare prima la configurazione server.' : undefined}
            onClick={() => void connect()}
          >
            {serverConfigurationMissing ? 'Non disponibile' : busy ? 'Apertura…' : 'Collega Google'} <ExternalLink size={15} />
          </button>
        </section>
        : <>
          <section className="feature-card google-permissions">
            <h3>Account Google collegato</h3>
            <p>Seleziona i calendari da mostrare nel tuo calendario personale. La sincronizzazione aggiorna le modifiche e rimuove gli eventi cancellati su Google.</p>
            <p className="google-private-note">I titoli, le descrizioni e gli orari importati sono privati e visibili solo a te in questo spazio.</p>
          </section>
          <section className="feature-card google-calendar-list">
            <div className="google-list-heading"><h3>I tuoi calendari Google</h3><span>{selectedCount} selezionati</span></div>
            {!calendars.length
              ? <p>Nessun calendario Google accessibile trovato.</p>
              : calendars.map((entry) => <label className="google-calendar-option" key={entry.id}>
                <input type="checkbox" checked={entry.selected} disabled={busy} onChange={() => toggleCalendar(entry)} />
                <span className="google-calendar-option-copy">
                  <strong>{entry.summary}{entry.primary && <small>Principale</small>}</strong>
                  <span>{entry.timeZone}{entry.lastSyncedAt ? ` · Aggiornato ${new Date(entry.lastSyncedAt).toLocaleString('it-IT')}` : ''}</span>
                </span>
                {entry.selected && <Check size={17} aria-hidden="true" />}
              </label>)}
            <div className="google-calendar-actions">
              <button className="primary-button" disabled={busy} onClick={() => void saveSelection()}>{busy ? 'Aggiornamento…' : 'Salva e sincronizza'}</button>
              <button disabled={busy || selectedCount === 0} onClick={() => void syncNow()}><RefreshCw size={15} /> Sincronizza ora</button>
              <button className="google-disconnect-button" disabled={busy} onClick={() => void disconnect()}><Unlink size={15} /> Scollega</button>
            </div>
          </section>
        </>}
    <p className="google-sync-note">Aggiornamento automatico all’apertura del calendario e ogni 5 minuti mentre l’app è aperta. Gli eventi Google importati sono di sola lettura nell’app; per modificarli, aprili su Google Calendar.</p>
  </section>
}
