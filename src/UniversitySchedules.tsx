import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

type Provider = 'polito' | 'unito'
type ScheduleSource = { id: string; provider: Provider }
type FeedEvent = {
  uid: string
  title: string
  description: string
  starts_at: string
  ends_at: string
  all_day: boolean
}

const providers: { id: Provider; name: string; instructions: string }[] = [
  { id: 'polito', name: 'PoliTO', instructions: 'Incolla il link iCal HTTPS del calendario delle lezioni.' },
  { id: 'unito', name: 'UniTO', instructions: 'Incolla il link iCal HTTPS esportato dal calendario del tuo corso o dalla tua area personale.' },
]

export function UniversitySchedules({
  calendarId,
  userId,
  canEdit,
  onSynced,
}: {
  calendarId: string
  userId: string
  canEdit: boolean
  onSynced: () => void
}) {
  const [sources, setSources] = useState<ScheduleSource[]>([])
  const [feedUrls, setFeedUrls] = useState<Record<Provider, string>>({ polito: '', unito: '' })
  const [busy, setBusy] = useState<Provider | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadSources = useCallback(async () => {
    if (!supabase) return []
    const { data, error: loadError } = await supabase
      .from('calendar_schedule_sources')
      .select('id, provider')
      .eq('calendar_id', calendarId)
      .eq('user_id', userId)
    if (loadError) throw loadError
    const loaded = (data ?? []).filter((row): row is ScheduleSource =>
      typeof row.id === 'string' && (row.provider === 'polito' || row.provider === 'unito'))
    setSources(loaded)
    return loaded
  }, [calendarId, userId])

  const syncSource = useCallback(async (source: ScheduleSource) => {
    if (!supabase || !canEdit) return
    setBusy(source.provider)
    setError('')
    setNotice('')
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!sessionData.session) throw new Error('Accedi di nuovo per sincronizzare il feed.')
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ calendarId, sourceId: source.id }),
      })
      const result = await response.json() as {
        error?: string
        provider?: Provider
        from?: string
        until?: string
        events?: FeedEvent[]
      }
      if (!response.ok) throw new Error(result.error || `Sincronizzazione non riuscita (HTTP ${response.status}).`)
      if (result.provider !== source.provider || !result.from || !result.until || !Array.isArray(result.events)) {
        throw new Error('Risposta del servizio di sincronizzazione non valida.')
      }
      if (result.events.length === 0) {
        setNotice(`${providers.find((provider) => provider.id === source.provider)?.name}: nessuna lezione trovata nell’intervallo; gli eventi esistenti non sono stati modificati.`)
        return
      }
      const { data: changed, error: syncError } = await supabase.rpc('sync_calendar_schedule', {
        p_calendar_id: calendarId,
        p_provider: source.provider,
        p_from: result.from,
        p_until: result.until,
        p_events: result.events,
      })
      if (syncError) throw syncError
      setNotice(`${providers.find((provider) => provider.id === source.provider)?.name}: orari aggiornati (${changed ?? result.events.length} elementi elaborati).`)
      onSynced()
    } catch (syncError) {
      setError(`Sincronizzazione non riuscita: ${syncError instanceof Error ? syncError.message : 'errore sconosciuto'}`)
    } finally {
      setBusy(null)
    }
  }, [calendarId, canEdit, onSynced])

  useEffect(() => {
    let active = true
    void loadSources().then(async (loaded) => {
      if (!active || !canEdit) return
      for (const source of loaded) {
        if (!active) return
        await syncSource(source)
      }
    }).catch((loadError: unknown) => {
      if (active) setError(`Impossibile caricare i collegamenti: ${loadError instanceof Error ? loadError.message : 'errore sconosciuto'}`)
    })
    return () => { active = false }
  }, [canEdit, loadSources, syncSource])

  const saveSource = async (provider: Provider) => {
    if (!supabase || !canEdit) return
    const feedUrl = feedUrls[provider].trim()
    let parsedUrl: URL
    try {
      parsedUrl = new URL(feedUrl)
    } catch {
      setError('Inserisci un link iCal HTTPS valido.')
      return
    }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.port) {
      setError('Il link deve usare HTTPS e non contenere credenziali nell’indirizzo.')
      return
    }
    setBusy(provider)
    setError('')
    setNotice('')
    try {
      const { data: saved, error: saveError } = await supabase
        .from('calendar_schedule_sources')
        .upsert({ calendar_id: calendarId, user_id: userId, provider, feed_url: feedUrl }, { onConflict: 'calendar_id,user_id,provider' })
        .select('id, provider')
        .single()
      if (saveError) throw saveError
      if (!saved || typeof saved.id !== 'string') throw new Error('Supabase non ha confermato il collegamento.')
      const source = { id: saved.id, provider } as ScheduleSource
      setSources((current) => [...current.filter((entry) => entry.provider !== provider), source])
      setFeedUrls((current) => ({ ...current, [provider]: '' }))
      await syncSource(source)
    } catch (saveError) {
      setError(`Impossibile salvare il collegamento: ${saveError instanceof Error ? saveError.message : 'errore sconosciuto'}`)
      setBusy(null)
    }
  }

  const disconnectSource = async (source: ScheduleSource) => {
    if (!supabase || !canEdit || !window.confirm('Scollegare il feed? Gli eventi già importati resteranno nel calendario.')) return
    setBusy(source.provider)
    setError('')
    setNotice('')
    const { data: removed, error: removeError } = await supabase
      .from('calendar_schedule_sources')
      .delete()
      .eq('id', source.id)
      .select('id')
      .maybeSingle()
    if (removeError) setError(`Impossibile scollegare il feed: ${removeError.message}`)
    else if (!removed) setError('Feed non scollegato: potrebbe non essere più disponibile.')
    else {
      setSources((current) => current.filter((entry) => entry.id !== source.id))
      setNotice('Feed scollegato. Gli eventi già importati restano modificabili nel calendario.')
    }
    setBusy(null)
  }

  return <section className="feature-page">
    <header className="feature-hero">
      <span className="feature-kicker">ORARI NEL TUO CALENDARIO</span>
      <h2>Orari universitari</h2>
      <p>Collega i feed iCalendar personali di PoliTO e UniTO.</p>
    </header>
    <p>I link dei feed sono protetti dalle policy del database e non sono visibili agli altri membri; gli amministratori del progetto Supabase mantengono accesso amministrativo. Gli orari importati diventano normali lezioni assegnate a te: puoi regolarne visibilità e assegnazione dall’evento nel calendario.</p>
    {!canEdit && <p>Per collegare o aggiornare gli orari devi avere i permessi di modifica in questo calendario.</p>}
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    {notice && <p className="form-message form-notice" role="status">{notice}</p>}
    {providers.map((provider) => {
      const source = sources.find((entry) => entry.provider === provider.id)
      return <section className="feature-card" key={provider.id}>
        <h3>{provider.name}</h3>
        <p>{provider.instructions}</p>
        {provider.id === 'polito' && <div className="schedule-help">
          <strong>Come trovare il link su MyPoli</strong>
          <ol>
            <li>Apri <a href="https://my.polito.it/dotnet/orari_lezione_pub/Default.aspx?culture_language=it-IT" target="_blank" rel="noreferrer">Orari di lezione su MyPoli</a>.</li>
            <li>Scegli <strong>Consultazione guidata</strong>, imposta anno accademico, sede, tipo di laurea, area e corso, poi premi <strong>Cerca</strong>.</li>
            <li>Nel calendario del corso individua l’opzione iCal e copia l’indirizzo HTTPS del feed; qui va incollato il link, non il file scaricato.</li>
          </ol>
          <p>La pagina pubblica mostra gli orari del corso selezionato, non ricava il piano carriera tramite matricola. Non inserire qui le credenziali PoliTO.</p>
        </div>}
        {source
          ? <div className="feature-row">
            <span>Feed collegato; URL nascosto.</span>
            <button disabled={!canEdit || busy !== null} onClick={() => void syncSource(source)}>{busy === provider.id ? 'Sincronizzazione…' : 'Sincronizza ora'}</button>
            <button disabled={!canEdit || busy !== null} onClick={() => void disconnectSource(source)}>Scollega</button>
          </div>
          : <div className="feature-form">
            <label>Link iCal HTTPS<input
              type="password"
              autoComplete="off"
              value={feedUrls[provider.id]}
              disabled={!canEdit || busy !== null}
              onChange={(event) => setFeedUrls((current) => ({ ...current, [provider.id]: event.target.value }))}
              placeholder="https://…"
            /></label>
            <button className="primary-button" disabled={!canEdit || busy !== null || !feedUrls[provider.id].trim()} onClick={() => void saveSource(provider.id)}>
              {busy === provider.id ? 'Collegamento…' : 'Collega e sincronizza'}
            </button>
          </div>}
      </section>
    })}
    <p>La sincronizzazione copre gli ultimi 60 giorni e i prossimi 400. Gli eventi importati mantengono le impostazioni di visibilità e assegnazione quando il feed viene aggiornato; scollegare un feed non elimina gli eventi già presenti.</p>
  </section>
}
