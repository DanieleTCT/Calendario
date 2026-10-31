import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import { supabase } from './lib/supabase'
import type { CalendarMember } from './types'

type Category = 'film' | 'serie' | 'gioco' | 'altro'
type Status = 'draft' | 'voting' | 'finished'
type WatchSession = { id: string; name: string; status: Status }
type Participant = { session_id: string; user_id: string }
type WatchItem = { id: string; title: string; category: Category; tags: string[]; tmdb_id: number | null; poster_path: string | null; release_date: string | null }
type Vote = { item_id: string; user_id: string; liked: boolean; rating: number | null }
type CatalogTypeFilter = 'all' | 'film' | 'serie'
type CatalogItem = { id: number; title: string; category: 'film' | 'serie'; poster_path: string | null; release_date: string | null; genre_ids: number[] }

const CATALOG_GENRES: { id: number; name: string; type: 'film' | 'serie' | 'all' }[] = [
  { id: 12, name: 'Avventura', type: 'film' },
  { id: 14, name: 'Fantasy', type: 'film' },
  { id: 16, name: 'Animazione', type: 'all' },
  { id: 18, name: 'Drammatico', type: 'all' },
  { id: 27, name: 'Horror', type: 'film' },
  { id: 28, name: 'Azione', type: 'film' },
  { id: 35, name: 'Commedia', type: 'all' },
  { id: 36, name: 'Storico', type: 'film' },
  { id: 37, name: 'Western', type: 'all' },
  { id: 53, name: 'Thriller', type: 'film' },
  { id: 80, name: 'Crime', type: 'all' },
  { id: 99, name: 'Documentario', type: 'all' },
  { id: 878, name: 'Fantascienza', type: 'film' },
  { id: 9648, name: 'Mistero', type: 'all' },
  { id: 10402, name: 'Musica', type: 'film' },
  { id: 10749, name: 'Romantico', type: 'film' },
  { id: 10751, name: 'Famiglia', type: 'all' },
  { id: 10752, name: 'Guerra', type: 'film' },
  { id: 10759, name: 'Azione e avventura', type: 'serie' },
  { id: 10762, name: 'Bambini', type: 'serie' },
  { id: 10763, name: 'Notizie', type: 'serie' },
  { id: 10764, name: 'Reality', type: 'serie' },
  { id: 10765, name: 'Fantascienza e fantasy', type: 'serie' },
  { id: 10766, name: 'Soap', type: 'serie' },
  { id: 10767, name: 'Talk show', type: 'serie' },
  { id: 10768, name: 'Guerra e politica', type: 'serie' },
  { id: 10770, name: 'Film TV', type: 'film' },
]

function poster(path: string | null) {
  return path && /^\/[A-Za-z0-9_.-]+$/.test(path) ? `https://image.tmdb.org/t/p/w342${path}` : null
}

function Cover({ path, title }: { path: string | null; title: string }) {
  const src = poster(path)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  return src && failedSrc !== src ? <img className="watch-cover" src={src} alt={`Copertina di ${title}`} loading="lazy" onError={() => setFailedSrc(src)} /> : <div className="watch-cover watch-cover-empty" aria-label="Copertina non disponibile">✦</div>
}

function shuffleKey(value: string) {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

function catalogGenreNames(item: Pick<CatalogItem, 'genre_ids' | 'category'>) {
  return item.genre_ids.flatMap((id) => {
    const genre = CATALOG_GENRES.find((entry) => entry.id === id
      && (entry.type === 'all' || entry.type === item.category))
    return genre ? [genre.name] : []
  })
}

export function WatchDecider({ calendarId, userId, canEdit, members }: {
  calendarId: string; userId: string; canEdit: boolean; members: CalendarMember[]
}) {
  const [sessions, setSessions] = useState<WatchSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [items, setItems] = useState<WatchItem[]>([])
  const [votes, setVotes] = useState<Vote[]>([])
  const [sessionName, setSessionName] = useState('')
  const [query, setQuery] = useState('')
  const [catalogType, setCatalogType] = useState<CatalogTypeFilter>('all')
  const [catalogYear, setCatalogYear] = useState('')
  const [catalogGenre, setCatalogGenre] = useState('')
  const [catalogTagFilter, setCatalogTagFilter] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [results, setResults] = useState<CatalogItem[]>([])
  const [catalogPage, setCatalogPage] = useState(0)
  const [catalogPages, setCatalogPages] = useState(0)
  const [lastQuery, setLastQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>('film')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pointerStart = useRef<number | null>(null)
  const sequence = useRef(0)
  const searchSequence = useRef(0)

  const load = useCallback(async () => {
    if (!supabase) return
    const request = ++sequence.current
    const list = await supabase.from('watch_sessions').select('id, name, status')
      .eq('calendar_id', calendarId).order('created_at', { ascending: false })
    if (request !== sequence.current) return
    if (list.error) { setError(`Impossibile caricare le sessioni: ${list.error.message}`); return }
    let rows: WatchSession[] = list.data ?? []
    const current = rows.find((entry) => entry.id === sessionId)
    if (current?.status === 'voting') {
      const { data: finished, error: finishError } = await supabase.rpc('finish_watch_round_if_complete', { p_session_id: sessionId })
      if (request !== sequence.current) return
      if (finishError) { setError(`Impossibile verificare il report: ${finishError.message}`); return }
      if (finished) rows = rows.map((entry) => entry.id === sessionId ? { ...entry, status: 'finished' } : entry)
    }
    if (!sessionId) { setSessions(rows); setParticipants([]); setItems([]); setVotes([]); return }
    const [people, choices, responses] = await Promise.all([
      supabase.from('watch_participants').select('session_id, user_id').eq('session_id', sessionId),
      supabase.from('watch_items').select('id, title, category, tags, tmdb_id, poster_path, release_date').eq('session_id', sessionId).order('created_at'),
      supabase.from('watch_votes').select('item_id, user_id, liked, rating').eq('session_id', sessionId),
    ])
    if (request !== sequence.current) return
    const failure = people.error ?? choices.error ?? responses.error
    if (failure) { setError(`Impossibile caricare la sessione: ${failure.message}`); return }
    setSessions(rows)
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
    return () => { ++sequence.current; ++searchSequence.current; window.clearInterval(timer); void client.removeChannel(channel) }
  }, [calendarId, sessionId, load])

  const session = sessions.find((entry) => entry.id === sessionId)
  const joined = participants.some((person) => person.user_id === userId)
  const myVotes = useMemo(() => new Map(votes.filter((vote) => vote.user_id === userId).map((vote) => [vote.item_id, vote])), [votes, userId])
  const deck = useMemo(() => items.filter((item) => !myVotes.has(item.id))
    .sort((a, b) => shuffleKey(`${sessionId}:${userId}:${a.id}`) - shuffleKey(`${sessionId}:${userId}:${b.id}`)), [items, myVotes, sessionId, userId])
  const report = useMemo(() => items.map((item) => {
    const itemVotes = votes.filter((vote) => vote.item_id === item.id)
    const likes = itemVotes.filter((vote) => vote.liked).length
    const score = participants.length ? itemVotes.reduce((sum, vote) => sum + (vote.liked ? vote.rating ?? 0 : 0), 0) / participants.length : 0
    return { item, itemVotes, likes, score }
  }).sort((a, b) => b.score - a.score || b.likes - a.likes || a.item.title.localeCompare(b.item.title, 'it')), [items, participants, votes])
  const visibleCatalogResults = useMemo(() => {
    const filterValue = catalogTagFilter.trim().toLocaleLowerCase('it-IT')
    if (!filterValue) return results
    return results.filter((entry) => [
      entry.title,
      entry.category,
      ...catalogGenreNames(entry),
    ].some((value) => value.toLocaleLowerCase('it-IT').includes(filterValue)))
  }, [catalogTagFilter, results])
  const availableGenres = CATALOG_GENRES.filter((genre) => genre.type === 'all'
    || catalogType === 'all' || genre.type === catalogType)
  const resetCatalogSearch = () => {
    ++searchSequence.current
    setResults([])
    setCatalogPage(0)
    setCatalogPages(0)
    setLastQuery('')
    setSearching(false)
  }

  const createSession = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !sessionName.trim()) return
    setBusy(true); setError('')
    const id = crypto.randomUUID()
    const { error: failure } = await supabase.from('watch_sessions').insert({ id, calendar_id: calendarId, name: sessionName.trim(), created_by: userId })
    if (failure) setError(`Impossibile creare la sessione: ${failure.message}`)
    else { setSessionName(''); setSessionId(id) }
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

  const start = async () => {
    if (!supabase) return
    setBusy(true); setError('')
    const { error: failure } = await supabase.rpc('start_watch_round', { p_session_id: sessionId })
    if (failure) setError(`Impossibile avviare: ${failure.message}`)
    else await load()
    setBusy(false)
  }

  const searchCatalog = async (search: string, page = 1) => {
    if (!supabase) return
    const trimmed = search.trim()
    if ((trimmed.length > 0 && trimmed.length < 2) || (trimmed.length === 0
      && catalogType === 'all' && !catalogYear && !catalogGenre)) {
      setError('Inserisci almeno due caratteri oppure scegli tipo, anno o genere.')
      return
    }
    const request = ++searchSequence.current
    setSearching(true); setError('')
    try {
      const { data, error: authError } = await supabase.auth.getSession()
      if (authError) throw new Error(authError.message)
      if (!data.session) throw new Error('Accedi per cercare nel catalogo.')
      const params = new URLSearchParams({ type: catalogType, page: String(page) })
      if (trimmed) params.set('query', trimmed)
      if (catalogYear) params.set('year', catalogYear)
      if (catalogGenre) params.set('genre', catalogGenre)
      const response = await fetch(`/api/catalog?${params}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Ricerca non riuscita.')
      if (!Array.isArray(payload.results)) throw new Error('Risposta del catalogo non valida.')
      if (request !== searchSequence.current) return
      setResults(payload.results)
      setCatalogPage(payload.page)
      setCatalogPages(payload.total_pages)
      setLastQuery(trimmed)
      setCatalogOpen(true)
    } catch (failure) {
      if (request === searchSequence.current) setError(`Ricerca: ${failure instanceof Error ? failure.message : 'errore inatteso.'}`)
    } finally {
      if (request === searchSequence.current) setSearching(false)
    }
  }

  const insertItem = async (values: { title: string; category: Category; tags: string[]; tmdb_id?: number; poster_path?: string | null; release_date?: string | null }) => {
    if (!supabase || !sessionId) return
    setBusy(true); setError('')
    const { error: failure } = await supabase.from('watch_items').insert({ ...values, session_id: sessionId, calendar_id: calendarId, created_by: userId })
    if (failure) setError(`Impossibile aggiungere il titolo: ${failure.message}`)
    else { setTitle(''); setTags(''); await load() }
    setBusy(false)
  }

  const addManual = async (event: FormEvent) => {
    event.preventDefault()
    const parsedTags = [...new Set(tags.split(',').map((tag) => tag.trim()).filter(Boolean))]
    if (parsedTags.length > 10 || parsedTags.some((tag) => tag.length > 40)) { setError('Inserisci al massimo 10 tag di 40 caratteri.'); return }
    if (title.trim()) await insertItem({ title: title.trim(), category, tags: parsedTags })
  }

  const removeSession = async () => {
    if (!supabase || !window.confirm('Eliminare questa sessione, tutti i titoli e i voti?')) return
    setBusy(true); setError('')
    const { data, error: failure } = await supabase.from('watch_sessions').delete().eq('id', sessionId).select('id').maybeSingle()
    if (failure || !data) setError(`Impossibile eliminare la sessione: ${failure?.message ?? 'accesso negato o sessione non trovata'}`)
    else { setSessionId(''); await load() }
    setBusy(false)
  }

  const removeItem = async (item: WatchItem) => {
    if (!supabase || !window.confirm(`Eliminare ${item.title}?`)) return
    setBusy(true); setError('')
    const { data, error: failure } = await supabase.from('watch_items').delete().eq('id', item.id).select('id').maybeSingle()
    if (failure || !data) setError(`Impossibile eliminare il titolo: ${failure?.message ?? 'accesso negato o titolo non trovato'}`)
    else await load()
    setBusy(false)
  }

  const vote = async (item: WatchItem, rating: number | null) => {
    if (!supabase || !joined || busy || session?.status !== 'voting') return
    setBusy(true); setError('')
    const { error: failure } = await supabase.from('watch_votes').insert({
      session_id: sessionId, item_id: item.id, user_id: userId, liked: rating !== null, rating,
    })
    if (failure) setError(`Impossibile registrare il voto: ${failure.message}`)
    else await load()
    setBusy(false)
  }

  const swipe = (event: PointerEvent<HTMLDivElement>, item: WatchItem) => {
    if (pointerStart.current === null) return
    const delta = event.clientX - pointerStart.current
    pointerStart.current = null
    if (Math.abs(delta) >= 70) void vote(item, delta > 0 ? 4 : null)
  }

  return <section className="feature-page watch-page">
    <header className="feature-hero"><span className="feature-kicker">DA SCEGLIERE INSIEME</span><h2>Watch-decider</h2><p>Crea la lista, invita il gruppo e trova la prossima scelta perfetta.</p></header>
    {error && <p className="form-message form-error feature-alert" role="alert">{error}</p>}
    <div className="watch-session-bar">
      <label className="feature-field">Sessione<select disabled={busy} value={sessionId} onChange={(event) => {
        setSessionId(event.target.value); setError(''); setResults([]); setLastQuery(''); setSearching(false)
        setParticipants([]); setItems([]); setVotes([])
      }}>
        <option value="">Seleziona una sessione</option>{sessions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.status === 'draft' ? 'preparazione' : entry.status === 'voting' ? 'in corso' : 'conclusa'}</option>)}
      </select></label>
      {canEdit && <form className="feature-row" onSubmit={(event) => void createSession(event)}>
        <input aria-label="Nome nuova sessione" value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Nome nuova sessione" maxLength={80} required />
        <button className="primary-button" disabled={busy}>Crea sessione</button>
      </form>}
    </div>
    {session && <>
      <details className="feature-card disclosure-card" open>
        <summary>Partecipanti <span className="count-pill">{participants.length}</span></summary>
        <p>{participants.map((person) => members.find((member) => member.user_id === person.user_id)?.display_name || 'Membro').join(', ') || 'Nessuno ancora'}</p>
        {session.status === 'draft' ? <><button className="primary-button" disabled={busy} onClick={() => void changeParticipation()}>{joined ? 'Esci dalla sessione' : 'Partecipa'}</button>{joined && <p>Uscendo, i tuoi voti nella sessione vengono eliminati.</p>}</> : <p>I partecipanti sono bloccati fino alla fine della partita.</p>}
      </details>
      {session.status === 'draft' && canEdit && <>
        <details className="feature-card disclosure-card catalog-disclosure" open={catalogOpen} onToggle={(event) => setCatalogOpen(event.currentTarget.open)}>
          <summary>Catalogo preview <span className="count-pill">{results.length} risultati</span></summary>
          <form className="catalog-filters" onSubmit={(event) => { event.preventDefault(); void searchCatalog(query) }}>
            <label className="feature-field catalog-title-filter">Titolo<input aria-label="Cerca film o serie" value={query} onChange={(event) => { setQuery(event.target.value); resetCatalogSearch() }} placeholder="Nome del film o della serie..." maxLength={100} /></label>
            <label className="feature-field">Categoria<select value={catalogType} onChange={(event) => {
              const next = event.target.value
              if (next !== 'all' && next !== 'film' && next !== 'serie') return
              setCatalogType(next)
              if (catalogGenre && next !== 'all' && !CATALOG_GENRES.some((genre) => String(genre.id) === catalogGenre
                && (genre.type === 'all' || genre.type === next))) setCatalogGenre('')
              resetCatalogSearch()
            }}><option value="all">Film e serie</option><option value="film">Film</option><option value="serie">Serie TV</option></select></label>
            <label className="feature-field">Anno<input type="number" min="1870" max="2100" step="1" value={catalogYear} onChange={(event) => { setCatalogYear(event.target.value); resetCatalogSearch() }} placeholder="Es. 2024" /></label>
            <label className="feature-field">Genere<select value={catalogGenre} onChange={(event) => { setCatalogGenre(event.target.value); resetCatalogSearch() }}><option value="">Tutti i generi</option>{availableGenres.map((genre) => <option key={genre.id} value={genre.id}>{genre.name}</option>)}</select></label>
            <label className="feature-field">Tag o genere<input type="search" value={catalogTagFilter} onChange={(event) => setCatalogTagFilter(event.target.value)} placeholder="Filtra i risultati mostrati..." /></label>
            <button className="primary-button catalog-submit" disabled={searching}>{searching ? 'Ricerca…' : 'Cerca nel catalogo'}</button>
          </form>
          {catalogPage > 0 && <p className="catalog-summary">{[
            lastQuery ? `Titolo: “${lastQuery}”` : 'Catalogo per filtri',
            catalogType === 'all' ? '' : catalogType === 'film' ? 'Film' : 'Serie TV',
            catalogYear ? `Anno: ${catalogYear}` : '',
            catalogGenre ? `Genere: ${CATALOG_GENRES.find((genre) => String(genre.id) === catalogGenre)?.name ?? ''}` : '',
          ].filter(Boolean).join(' · ')}</p>}
          {results.length > 0 && visibleCatalogResults.length === 0 && <p>Nessun risultato contiene questo tag o genere. Prova a modificare il filtro.</p>}
          {catalogPage > 0 && results.length === 0 && <p>Nessun risultato per i criteri selezionati.</p>}
          <div className="catalog-grid" aria-label="Anteprima dei risultati del catalogo">{visibleCatalogResults.map((entry) => {
            const added = items.some((item) => item.tmdb_id === entry.id && item.category === entry.category)
            const genres = catalogGenreNames(entry)
            return <article className="catalog-card" key={`${entry.category}-${entry.id}`}><Cover path={entry.poster_path} title={entry.title} /><div className="catalog-card-copy"><strong>{entry.title}</strong><p>{entry.category === 'film' ? 'Film' : 'Serie TV'}{entry.release_date ? ` · ${entry.release_date.slice(0, 4)}` : ''}</p>{genres.length > 0 && <p className="catalog-card-genres">{genres.join(' · ')}</p>}<button disabled={busy || added} onClick={() => void insertItem({ title: entry.title, category: entry.category, tags: [], tmdb_id: entry.id, poster_path: entry.poster_path, release_date: entry.release_date })}>{added ? 'Aggiunto' : 'Aggiungi'}</button></div></article>
          })}</div>
          {catalogPages > 1 && <div className="feature-row catalog-pagination"><button disabled={searching || catalogPage <= 1} onClick={() => void searchCatalog(lastQuery, catalogPage - 1)}>Precedente</button><span>Pagina {catalogPage} di {catalogPages}</span><button disabled={searching || catalogPage >= catalogPages} onClick={() => void searchCatalog(lastQuery, catalogPage + 1)}>Successiva</button></div>}
        </details>
        <details className="feature-card disclosure-card">
          <summary>Aggiungi manualmente</summary>
          <form className="feature-form" onSubmit={(event) => void addManual(event)}>
            <label>Titolo<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
            <label>Tipo<select value={category} onChange={(event) => { const value = event.target.value; if (value === 'film' || value === 'serie' || value === 'gioco' || value === 'altro') setCategory(value) }}><option value="film">Film</option><option value="serie">Serie TV</option><option value="gioco">Gioco</option><option value="altro">Altro</option></select></label>
            <label>Tag, separati da virgole<input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={410} /></label>
            <button className="primary-button" disabled={busy}>Aggiungi</button>
          </form>
        </details>
      </>}
      {session.status === 'draft' && <details className="feature-card disclosure-card" open><summary>Lista della serata <span className="count-pill">{items.length}</span></summary>
        {items.length === 0 ? <p>La lista è ancora vuota.</p> : <div className="watch-list">{items.map((item) => <div className="watch-list-item" key={item.id}><Cover path={item.poster_path} title={item.title} /><div><strong>{item.title}</strong><p>{item.category} {item.tags.map((tag) => `#${tag}`).join(' ')}</p></div>{canEdit && <button disabled={busy} onClick={() => void removeItem(item)}>Rimuovi</button>}</div>)}</div>}
        {canEdit && <><button className="primary-button start-round" disabled={busy || participants.length < 2 || !items.length} onClick={() => void start()}>Avvia la scelta per tutti</button><p>Servono almeno due partecipanti e un titolo. Dopo l'avvio la lista e i partecipanti non possono essere modificati.</p></>}
      </details>}
      {session.status === 'voting' && <div className="feature-card round-card"><h3>La scelta è iniziata</h3>
        {!joined ? <p>Questa partita è già iniziata senza di te.</p> : deck[0] ? <>
          <p>Hai votato {myVotes.size} di {items.length} titoli. Scorri a sinistra per passare, a destra per dare 4 stelle, oppure scegli un voto.</p>
          <div className="swipe-card" onPointerDown={(event) => {
            if (event.target instanceof Element && event.target.closest('button')) return
            pointerStart.current = event.clientX
            event.currentTarget.setPointerCapture(event.pointerId)
          }} onPointerUp={(event) => swipe(event, deck[0])} onPointerCancel={() => { pointerStart.current = null }}>
            <Cover path={deck[0].poster_path} title={deck[0].title} /><div><strong>{deck[0].title}</strong><p>{deck[0].category}{deck[0].release_date ? ` · ${deck[0].release_date.slice(0, 4)}` : ''} {deck[0].tags.map((tag) => `#${tag}`).join(' ')}</p></div>
          </div>
          <div className="vote-actions"><button disabled={busy} onClick={() => void vote(deck[0], null)}>✕ Passo</button><div className="rating-buttons" role="group" aria-label="Valuta da 1 a 5 stelle">{[1, 2, 3, 4, 5].map((rating) => <button key={rating} disabled={busy} aria-label={`${rating} ${rating === 1 ? 'stella' : 'stelle'}`} onClick={() => void vote(deck[0], rating)}>{rating} ★</button>)}</div></div>
        </> : <p>Hai terminato! Il report apparirà quando anche gli altri avranno votato tutti i titoli.</p>}
      </div>}
      {session.status === 'finished' && <details className="feature-card disclosure-card" open><summary>Report della serata</summary>
        <p>Classifica per media su tutti i partecipanti: “passo” vale 0, i voti da 1 a 5 mantengono il valore scelto.</p>
        <div className="report-list">{report.map(({ item, itemVotes, likes, score }, index) => <article className="report-item" key={item.id}>
          <span className="report-rank">{index + 1}</span><Cover path={item.poster_path} title={item.title} /><div><strong>{item.title}</strong><p>{score.toFixed(1)} / 5 · piace a {likes} su {participants.length}</p><ul>{participants.map((person) => {
            const voteValue = itemVotes.find((entry) => entry.user_id === person.user_id)
            return <li key={person.user_id}>{members.find((member) => member.user_id === person.user_id)?.display_name || 'Membro'}: {!voteValue ? 'non disponibile' : voteValue.liked ? `${voteValue.rating ?? '–'} / 5` : 'passo'}</li>
          })}</ul></div>
        </article>)}</div>
      </details>}
      {canEdit && <details className="feature-card disclosure-card"><summary>Gestione sessione</summary><button disabled={busy} onClick={() => void removeSession()}>Elimina sessione e voti</button></details>}
    </>}
    <aside className="tmdb-credit"><a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"><img src="https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg" alt="TMDB" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></aside>
  </section>
}
