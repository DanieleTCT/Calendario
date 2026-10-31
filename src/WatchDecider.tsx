import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import { supabase } from './lib/supabase'
import type { CalendarMember } from './types'

type Category = 'film' | 'serie' | 'gioco' | 'altro'
type WatchSession = { id: string; name: string; created_at: string }
type Participant = { session_id: string; user_id: string }
type WatchItem = { id: string; title: string; category: Category; tags: string[]; created_at: string }
type Vote = { item_id: string; user_id: string; liked: boolean; rating: number | null }

export function WatchDecider({ calendarId, userId, canEdit, members }: {
  calendarId: string
  userId: string
  canEdit: boolean
  members: CalendarMember[]
}) {
  const [sessions, setSessions] = useState<WatchSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [items, setItems] = useState<WatchItem[]>([])
  const [votes, setVotes] = useState<Vote[]>([])
  const [sessionName, setSessionName] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>('film')
  const [tags, setTags] = useState('')
  const [filter, setFilter] = useState('')
  const [rating, setRating] = useState(3)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pointerStart = useRef<number | null>(null)
  const sequence = useRef(0)

  const load = useCallback(async () => {
    if (!supabase) return
    const request = ++sequence.current
    const list = await supabase.from('watch_sessions').select('id, name, created_at')
      .eq('calendar_id', calendarId).order('created_at', { ascending: false })
    if (request !== sequence.current) return
    if (list.error) { setError(`Impossibile caricare le sessioni: ${list.error.message}`); return }
    setSessions(list.data ?? [])
    if (!sessionId) { setParticipants([]); setItems([]); setVotes([]); return }
    const [people, choices, responses] = await Promise.all([
      supabase.from('watch_participants').select('session_id, user_id').eq('session_id', sessionId),
      supabase.from('watch_items').select('id, title, category, tags, created_at').eq('session_id', sessionId).order('created_at'),
      supabase.from('watch_votes').select('item_id, user_id, liked, rating').eq('session_id', sessionId),
    ])
    if (request !== sequence.current) return
    const failure = people.error ?? choices.error ?? responses.error
    if (failure) { setError(`Impossibile caricare la sessione: ${failure.message}`); return }
    setParticipants(people.data ?? [])
    setItems(choices.data ?? [])
    setVotes(responses.data ?? [])
  }, [calendarId, sessionId])

  useEffect(() => {
    if (!supabase) return
    void load()
    const client = supabase
    const channel = client.channel(`watch-${calendarId}-${sessionId || 'list'}`)
    for (const table of ['watch_sessions', 'watch_participants', 'watch_items', 'watch_votes']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => { void load() })
    }
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError('Connessione in tempo reale interrotta; i dati vengono aggiornati periodicamente.')
    })
    const timer = window.setInterval(() => { void load() }, 10000)
    return () => { ++sequence.current; window.clearInterval(timer); void client.removeChannel(channel) }
  }, [calendarId, sessionId, load])

  const joined = participants.some((person) => person.user_id === userId)
  const myVotes = useMemo(() => new Map(votes.filter((vote) => vote.user_id === userId).map((vote) => [vote.item_id, vote])), [votes, userId])
  const normalizedFilter = filter.trim().toLocaleLowerCase('it-IT')
  const deck = items.filter((item) => !myVotes.has(item.id) && (!normalizedFilter ||
    [item.title, item.category, ...item.tags].some((value) => value.toLocaleLowerCase('it-IT').includes(normalizedFilter))))
  const matches = items.filter((item) => participants.length >= 2 && participants.every((person) =>
    votes.some((vote) => vote.item_id === item.id && vote.user_id === person.user_id && vote.liked)))

  const createSession = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !sessionName.trim()) return
    setBusy(true); setError('')
    const id = crypto.randomUUID()
    const { error: createError } = await supabase.from('watch_sessions').insert({ id, calendar_id: calendarId, name: sessionName.trim(), created_by: userId })
    if (createError) { setError(`Impossibile creare la sessione: ${createError.message}`); setBusy(false); return }
    setSessionName('')
    setSessionId(id)
    setBusy(false)
  }

  const changeParticipation = async () => {
    if (!supabase || !sessionId) return
    setBusy(true); setError('')
    const result = joined
      ? await supabase.from('watch_participants').delete().eq('session_id', sessionId).eq('user_id', userId).select('user_id').maybeSingle()
      : await supabase.from('watch_participants').insert({ session_id: sessionId, calendar_id: calendarId, user_id: userId })
    if (result.error) setError(`Impossibile aggiornare la partecipazione: ${result.error.message}`)
    else if (joined && !result.data) setError('Partecipazione non rimossa: aggiorna la sessione e riprova.')
    else await load()
    setBusy(false)
  }

  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !sessionId || !title.trim()) return
    const parsedTags = [...new Set(tags.split(',').map((tag) => tag.trim()).filter(Boolean))]
    if (parsedTags.length > 10 || parsedTags.some((tag) => tag.length > 40)) { setError('Inserisci al massimo 10 tag di 40 caratteri.'); return }
    setBusy(true); setError('')
    const { error: insertError } = await supabase.from('watch_items').insert({
      session_id: sessionId, calendar_id: calendarId, title: title.trim(), category, tags: parsedTags, created_by: userId,
    })
    if (insertError) setError(`Impossibile aggiungere il titolo: ${insertError.message}`)
    else { setTitle(''); setTags(''); await load() }
    setBusy(false)
  }

  const removeSession = async () => {
    if (!supabase || !sessionId || !window.confirm('Eliminare questa sessione, tutti i titoli e i voti?')) return
    setBusy(true); setError('')
    const { data, error: removeError } = await supabase.from('watch_sessions').delete().eq('id', sessionId).select('id').maybeSingle()
    if (removeError || !data) setError(`Impossibile eliminare la sessione: ${removeError?.message ?? 'accesso negato o sessione non trovata'}`)
    else { setSessionId(''); await load() }
    setBusy(false)
  }

  const removeItem = async (item: WatchItem) => {
    if (!supabase || !window.confirm(`Eliminare ${item.title} e tutti i suoi voti?`)) return
    setBusy(true); setError('')
    const { data, error: removeError } = await supabase.from('watch_items').delete().eq('id', item.id).select('id').maybeSingle()
    if (removeError || !data) setError(`Impossibile eliminare il titolo: ${removeError?.message ?? 'accesso negato o titolo non trovato'}`)
    else await load()
    setBusy(false)
  }

  const vote = async (item: WatchItem, liked: boolean, existing?: Vote) => {
    if (!supabase || !joined || busy) return
    setBusy(true); setError('')
    const values = { liked, rating: liked ? rating : null }
    const result = existing
      ? await supabase.from('watch_votes').update(values).eq('session_id', sessionId).eq('item_id', item.id).eq('user_id', userId).select('item_id').maybeSingle()
      : await supabase.from('watch_votes').insert({ session_id: sessionId, item_id: item.id, user_id: userId, ...values })
    if (result.error) setError(`Impossibile registrare il voto: ${result.error.message}`)
    else if (existing && !result.data) setError('Voto non aggiornato: verifica la tua partecipazione.')
    else await load()
    setBusy(false)
  }

  const swipe = (event: PointerEvent<HTMLDivElement>, item: WatchItem) => {
    if (pointerStart.current === null) return
    const delta = event.clientX - pointerStart.current
    pointerStart.current = null
    if (Math.abs(delta) >= 70) void vote(item, delta > 0)
  }

  return <section className="feature-page">
    <h2>Watch-decider</h2>
    <p>Riunitevi in una sessione, votate i titoli e trovate quelli scelti da tutti i partecipanti.</p>
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    <label className="feature-field">Sessione
      <select value={sessionId} onChange={(event) => { setSessionId(event.target.value); setError('') }}>
        <option value="">Seleziona una sessione</option>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
      </select>
    </label>
    {canEdit && <form className="feature-row" onSubmit={(event) => void createSession(event)}>
      <input value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Nome della nuova sessione" maxLength={80} required />
      <button className="primary-button" disabled={busy}>Crea sessione</button>
    </form>}
    {sessionId && <>
      {canEdit && <button disabled={busy} onClick={() => void removeSession()}>Elimina sessione</button>}
      <div className="feature-card">
        <h3>Partecipanti ({participants.length})</h3>
        <p>{participants.map((person) => members.find((member) => member.user_id === person.user_id)?.display_name || 'Membro').join(', ') || 'Nessuno ancora'}</p>
        <button className="primary-button" disabled={busy} onClick={() => void changeParticipation()}>{joined ? 'Esci dalla sessione' : 'Partecipa'}</button>
        {joined && <p>Uscendo, i tuoi voti nella sessione vengono eliminati.</p>}
      </div>
      {canEdit && <form className="feature-card feature-form" onSubmit={(event) => void addItem(event)}>
        <h3>Aggiungi un titolo</h3>
        <label>Titolo<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
        <label>Tipo<select value={category} onChange={(event) => {
          const value = event.target.value
          if (value === 'film' || value === 'serie' || value === 'gioco' || value === 'altro') setCategory(value)
        }}><option value="film">Film</option><option value="serie">Serie TV</option><option value="gioco">Gioco</option><option value="altro">Altro</option></select></label>
        <label>Tag, separati da virgole<input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={410} /></label>
        <button className="primary-button" disabled={busy}>Aggiungi</button>
      </form>}
      <label className="feature-field">Cerca per titolo, tipo o tag<input value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      {joined && <div className="feature-card">
        <h3>Da scegliere</h3>
        <label className="feature-field">Valutazione se ti piace: <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
        {deck[0] ? <div className="swipe-card" onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest('button')) return
          pointerStart.current = event.clientX
          event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerUp={(event) => swipe(event, deck[0])} onPointerCancel={() => { pointerStart.current = null }}>
          <strong>{deck[0].title}</strong><p>{deck[0].category} {deck[0].tags.map((tag) => `#${tag}`).join(' ')}</p>
          <p>Scorri a sinistra o a destra, oppure usa i pulsanti.</p>
          <div className="feature-row"><button type="button" disabled={busy} onClick={() => void vote(deck[0], false)}>No</button><button type="button" className="primary-button" disabled={busy} onClick={() => void vote(deck[0], true)}>Sì</button></div>
        </div> : <p>Nessun titolo da votare con questo filtro.</p>}
      </div>}
      <div className="feature-card">
        <h3>Scelte in comune</h3>
        {participants.length < 2 ? <p>Servono almeno due partecipanti.</p> : matches.length === 0 ? <p>Nessuna scelta comune per ora.</p> : <ul>{matches.map((item) => {
          const ratings = votes.filter((entry) => entry.item_id === item.id && entry.liked && entry.rating !== null).map((entry) => entry.rating as number)
          return <li key={item.id}><strong>{item.title}</strong> · {item.category} {item.tags.map((tag) => `#${tag}`).join(' ')}{ratings.length > 0 && ` · ${ (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) }/5`}</li>
        })}</ul>}
      </div>
      {joined && myVotes.size > 0 && <div className="feature-card"><h3>I tuoi voti</h3><p>Puoi rivedere una scelta con la valutazione selezionata sopra.</p>{items.filter((item) => myVotes.has(item.id)).map((item) => {
        const previous = myVotes.get(item.id)
        return <div key={item.id} className="feature-row"><span>{item.title}: {previous?.liked ? `sì (${previous.rating}/5)` : 'no'}</span><button disabled={busy} onClick={() => void vote(item, false, previous)}>No</button><button disabled={busy} onClick={() => void vote(item, true, previous)}>Sì</button></div>
      })}</div>}
      {canEdit && items.length > 0 && <div className="feature-card"><h3>Gestisci titoli</h3>{items.map((item) => <div key={item.id} className="feature-row"><span>{item.title}</span><button disabled={busy} onClick={() => void removeItem(item)}>Elimina</button></div>)}</div>}
    </>}
  </section>
}
