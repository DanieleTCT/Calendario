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
  const mediaType = url.searchParams.get('type') || 'all'
  const yearValue = url.searchParams.get('year') || ''
  const genreValue = url.searchParams.get('genre') || ''
  const year = yearValue ? Number(yearValue) : null
  const genre = genreValue ? Number(genreValue) : null
  const validGenres = {
    movie: new Set([12, 14, 16, 18, 27, 28, 35, 36, 37, 53, 80, 99, 878, 9648, 10402, 10749, 10751, 10752, 10770]),
    tv: new Set([16, 18, 35, 37, 80, 99, 9648, 10751, 10759, 10762, 10763, 10764, 10765, 10766, 10767, 10768]),
  }
  const genreValid = genre === null || (Number.isSafeInteger(genre)
    && (mediaType === 'all' ? [...validGenres.movie, ...validGenres.tv].includes(genre)
      : validGenres[mediaType === 'film' ? 'movie' : 'tv'].has(genre)))
  if ((query.length > 0 && query.length < 2) || query.length > 100
    || !['all', 'film', 'serie'].includes(mediaType)
    || (yearValue && (!Number.isInteger(year) || year < 1870 || year > 2100))
    || !genreValid || !Number.isInteger(page) || page < 1 || page > 500
    || (!query && mediaType === 'all' && year === null && genre === null)) {
    return respond(400, { error: 'Ricerca, filtri o pagina non validi.' })
  }
  try {
    const auth = await fetcher(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: config.supabaseKey },
      signal: AbortSignal.timeout(8000),
    })
    if (auth.status === 401 || auth.status === 403) return respond(401, { error: 'Sessione non valida o scaduta.' })
    if (!auth.ok) return respond(502, { error: 'Impossibile verificare la sessione.' })
    const requestEndpoint = async (endpoint, extra = {}) => {
      const params = new URLSearchParams({ page: String(page), language: 'it-IT', include_adult: 'false', ...extra })
      if (genre !== null && endpoint.startsWith('/discover/')) params.set('with_genres', String(genre))
      const upstream = new URL(`https://api.themoviedb.org/3${endpoint}?${params}`)
      const response = await fetcher(upstream, {
        headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`TMDb non disponibile (HTTP ${response.status}).`)
      const payload = await response.json()
      if (!Array.isArray(payload.results)) throw new Error('Risposta TMDb non valida.')
      return payload
    }

    const media = mediaType === 'film' ? ['movie'] : mediaType === 'serie' ? ['tv'] : ['movie', 'tv']
    let payloads
    if (!query) {
      payloads = await Promise.all(media.map((kind) =>
        requestEndpoint(`/discover/${kind}`, {
          sort_by: 'popularity.desc',
          ...(year === null ? {} : kind === 'movie'
            ? { primary_release_year: String(year) }
            : { first_air_date_year: String(year) }),
        }),
      ))
    } else if (mediaType === 'all' && year === null) {
      payloads = [await requestEndpoint('/search/multi', { query })]
    } else {
      payloads = await Promise.all(media.map((kind) => requestEndpoint(`/search/${kind}`, {
        query,
        ...(year === null ? {} : kind === 'movie'
          ? { year: String(year) }
          : { first_air_date_year: String(year) }),
      })))
    }

    const results = payloads.flatMap((payload, index) => payload.results
      .filter((entry) => Number.isSafeInteger(entry.id) && entry.id > 0)
      .map((entry) => {
        const kind = mediaType === 'all' && query && year === null
          ? entry.media_type
          : media[index]
        if (kind !== 'movie' && kind !== 'tv') return null
        const genreIds = Array.isArray(entry.genre_ids)
          ? entry.genre_ids.filter((id) => Number.isSafeInteger(id) && id > 0)
          : []
        if (genre !== null && !genreIds.includes(genre)) return null
        return {
          id: entry.id,
          category: kind === 'movie' ? 'film' : 'serie',
          title: String(entry.title || entry.name || '').trim().slice(0, 120),
          poster_path: typeof entry.poster_path === 'string' && /^\/[A-Za-z0-9_.-]+$/.test(entry.poster_path) ? entry.poster_path : null,
          release_date: typeof (entry.release_date || entry.first_air_date) === 'string'
            ? (entry.release_date || entry.first_air_date).slice(0, 10) : null,
          genre_ids: genreIds,
        }
      })
      .filter((entry) => entry && entry.title))
    return respond(200, { results, page, total_pages: Math.min(Math.max(...payloads.map((payload) => Number(payload.total_pages) || 0)), 500) })
  } catch (error) {
    console.error('Errore nella ricerca TMDb:', error instanceof Error ? error.message : 'errore sconosciuto')
    return respond(502, { error: error instanceof Error ? error.message : 'Impossibile contattare TMDb. Riprova.' })
  }
}

export default function handler(req, res) {
  return catalogHandler(req, res, {
    token: process.env.TMDB_READ_ACCESS_TOKEN,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY,
  })
}
