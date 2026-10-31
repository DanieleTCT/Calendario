export async function catalogHandler(req, res, config, fetcher = fetch) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  const respond = (status, data) => {
    res.statusCode = status
    res.end(JSON.stringify(data))
  }
  if (req.method !== 'GET') return respond(405, { error: 'Metodo non supportato.' })
  if (!config.token || !config.supabaseUrl || !config.supabaseKey) return respond(503, { error: 'Catalogo non configurato sul server.' })
  const authorization = req.headers?.authorization
  if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization)) {
    return respond(401, { error: 'Accedi per cercare nel catalogo.' })
  }
  const url = new URL(req.url || '', 'http://localhost')
  const query = url.searchParams.get('query')?.trim() || ''
  const page = Number(url.searchParams.get('page') || 1)
  if (query.length < 2 || query.length > 100 || !Number.isInteger(page) || page < 1 || page > 500) {
    return respond(400, { error: 'Ricerca o pagina non valida.' })
  }
  const upstream = new URL('https://api.themoviedb.org/3/search/multi')
  upstream.search = new URLSearchParams({ query, page: String(page), language: 'it-IT', include_adult: 'false' }).toString()
  try {
    const auth = await fetcher(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: config.supabaseKey },
      signal: AbortSignal.timeout(8000),
    })
    if (auth.status === 401 || auth.status === 403) return respond(401, { error: 'Sessione non valida o scaduta.' })
    if (!auth.ok) return respond(502, { error: 'Impossibile verificare la sessione.' })
    const response = await fetcher(upstream, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return respond(502, { error: `TMDb non disponibile (HTTP ${response.status}).` })
    const payload = await response.json()
    if (!Array.isArray(payload.results)) return respond(502, { error: 'Risposta TMDb non valida.' })
    const results = payload.results
      .filter((entry) => (entry.media_type === 'movie' || entry.media_type === 'tv') && Number.isSafeInteger(entry.id) && entry.id > 0)
      .map((entry) => ({
        id: entry.id,
        category: entry.media_type === 'movie' ? 'film' : 'serie',
        title: String(entry.title || entry.name || '').trim().slice(0, 120),
        poster_path: typeof entry.poster_path === 'string' && /^\/[A-Za-z0-9_.-]+$/.test(entry.poster_path) ? entry.poster_path : null,
        release_date: typeof (entry.release_date || entry.first_air_date) === 'string'
          ? (entry.release_date || entry.first_air_date).slice(0, 10) : null,
      }))
      .filter((entry) => entry.title)
    return respond(200, { results, page, total_pages: Math.min(Number(payload.total_pages) || 0, 500) })
  } catch (error) {
    console.error('Errore nella ricerca TMDb:', error instanceof Error ? error.message : 'errore sconosciuto')
    return respond(502, { error: 'Impossibile contattare TMDb. Riprova.' })
  }
}

export default function handler(req, res) {
  return catalogHandler(req, res, {
    token: process.env.TMDB_READ_ACCESS_TOKEN,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY,
  })
}
