import { createHash } from 'node:crypto'
import ICAL from 'ical.js'

const maxFeedBytes = 4 * 1024 * 1024
const maxEvents = 2000
const maxFeedRedirects = 3
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function respond(res, status, data) {
  res.statusCode = status
  res.end(JSON.stringify(data))
}

async function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 16 * 1024) throw new Error('Richiesta troppo grande.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function allowedFeedUrl(value, provider) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
  const host = url.hostname.toLowerCase()
  const allowedHosts = provider === 'polito'
    ? new Set(['my.polito.it', 'www.my.polito.it', 'swas.polito.it', 'www.swas.polito.it'])
    : new Set(['my.unito.it', 'unito.prod.up.cineca.it'])
  return allowedHosts.has(host) ? url : null
}

async function fetchFeed(url, provider, fetcher) {
  let currentUrl = url
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetcher(currentUrl, {
      headers: { Accept: 'text/calendar, text/plain;q=0.9' },
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    })
    if (response.status < 300 || response.status >= 400) return response
    if (redirects >= maxFeedRedirects) throw new Error('Il feed reindirizza troppe volte.')
    const location = response.headers.get('location')
    if (!location) throw new Error('Il feed reindirizza senza indicare una destinazione.')
    const nextUrl = new URL(location, currentUrl)
    if (!allowedFeedUrl(nextUrl.toString(), provider)) {
      throw new Error('Il feed reindirizza a un dominio non ufficiale per questo ateneo.')
    }
    await response.body?.cancel()
    currentUrl = nextUrl
  }
}

async function readLimited(response) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > maxFeedBytes) throw new Error('Il feed supera la dimensione massima consentita.')
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxFeedBytes) throw new Error('Il feed supera la dimensione massima consentita.')
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxFeedBytes) {
      await reader.cancel()
      throw new Error('Il feed supera la dimensione massima consentita.')
    }
    chunks.push(value)
  }
  const data = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(data)
}

function makeEvents(text, from, until) {
  let calendar
  try {
    calendar = new ICAL.Component(ICAL.parse(text))
  } catch {
    throw new Error('Il contenuto ricevuto non è un calendario iCalendar valido.')
  }
  if (calendar.name !== 'vcalendar') throw new Error('Il contenuto ricevuto non è un calendario iCalendar valido.')

  const lower = ICAL.Time.fromJSDate(from, true)
  const upper = ICAL.Time.fromJSDate(until, true)
  const result = []
  const addEvent = (event, start, end, allDay, recurrenceId) => {
    const startsAt = start.toJSDate()
    const endsAt = end.toJSDate()
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())
      || startsAt < from || startsAt >= until || endsAt < startsAt) return
    const item = event.item
    const title = String(item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!title) return
    const description = [
      String(item.description || '').trim(),
      item.location ? `Luogo: ${String(item.location).trim()}` : '',
    ].filter(Boolean).join('\n').slice(0, 1000)
    const startsIso = startsAt.toISOString()
    const uid = createHash('sha256').update(`${item.uid}\0${recurrenceId}`).digest('hex')
    result.push({
      uid,
      title,
      description,
      starts_at: startsIso,
      ends_at: endsAt.toISOString(),
      all_day: allDay,
    })
    if (result.length > maxEvents) throw new Error('Il feed contiene troppi eventi nella finestra di sincronizzazione.')
  }

  for (const component of calendar.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component)
    if (!event.uid || !event.startDate || !event.endDate) continue
    if (String(component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') continue
    if (event.isRecurring()) {
      const iterator = event.iterator(lower)
      let occurrence = iterator.next()
      let iterations = 0
      while (occurrence && iterations < maxEvents * 20) {
        if (occurrence.compare(upper) >= 0) break
        const details = event.getOccurrenceDetails(occurrence)
        if (String(details.item.component.getFirstPropertyValue('status') || '').toUpperCase() !== 'CANCELLED') {
          addEvent(details, details.startDate, details.endDate, details.startDate.isDate, occurrence.toICALString())
        }
        occurrence = iterator.next()
        iterations += 1
      }
      if (iterations >= maxEvents * 20) throw new Error('Il feed contiene una regola di ricorrenza troppo ampia.')
    } else {
      addEvent({ item: event }, event.startDate, event.endDate, event.startDate.isDate, 'single')
    }
  }
  return result
}

export async function scheduleHandler(req, res, config, fetcher = fetch) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return respond(res, 405, { error: 'Metodo non supportato.' })
  if (!config.supabaseUrl || !config.supabaseKey) return respond(res, 503, { error: 'Sincronizzazione non configurata sul server.' })
  const authorization = req.headers?.authorization
  if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization)) {
    return respond(res, 401, { error: 'Accedi per sincronizzare gli orari.' })
  }

  let body
  try {
    body = await requestBody(req)
  } catch {
    return respond(res, 400, { error: 'Richiesta non valida.' })
  }
  const calendarId = body?.calendarId
  const sourceId = body?.sourceId
  if (typeof calendarId !== 'string' || !idPattern.test(calendarId)
    || typeof sourceId !== 'string' || !idPattern.test(sourceId)) {
    return respond(res, 400, { error: 'Calendario o collegamento non valido.' })
  }

  const baseUrl = config.supabaseUrl.replace(/\/$/, '')
  const headers = { Authorization: authorization, apikey: config.supabaseKey }
  try {
    const auth = await fetcher(`${baseUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8000) })
    if (auth.status === 401 || auth.status === 403) return respond(res, 401, { error: 'Sessione non valida o scaduta.' })
    if (!auth.ok) return respond(res, 502, { error: 'Impossibile verificare la sessione.' })
    const user = await auth.json()
    if (typeof user.id !== 'string' || !idPattern.test(user.id)) return respond(res, 401, { error: 'Sessione non valida.' })

    const params = new URLSearchParams({
      select: 'role,can_edit',
      calendar_id: `eq.${calendarId}`,
      user_id: `eq.${user.id}`,
    })
    const membership = await fetcher(`${baseUrl}/rest/v1/calendar_members?${params}`, { headers, signal: AbortSignal.timeout(8000) })
    if (!membership.ok) return respond(res, 502, { error: 'Impossibile verificare i permessi del calendario.' })
    const members = await membership.json()
    if (!Array.isArray(members) || !members.some((entry) => entry.role === 'owner' || entry.can_edit === true)) {
      return respond(res, 403, { error: 'Solo un editor del calendario può sincronizzare gli orari.' })
    }

    const sourceParams = new URLSearchParams({
      select: 'provider,feed_url',
      id: `eq.${sourceId}`,
      calendar_id: `eq.${calendarId}`,
      user_id: `eq.${user.id}`,
      limit: '1',
    })
    const sourceResponse = await fetcher(`${baseUrl}/rest/v1/calendar_schedule_sources?${sourceParams}`, { headers, signal: AbortSignal.timeout(8000) })
    if (!sourceResponse.ok) return respond(res, 502, { error: 'Impossibile leggere il collegamento privato.' })
    const sources = await sourceResponse.json()
    const source = Array.isArray(sources) ? sources[0] : null
    if (!source || !['polito', 'unito'].includes(source.provider) || typeof source.feed_url !== 'string') {
      return respond(res, 404, { error: 'Collegamento non trovato o non accessibile.' })
    }
    const feedUrl = allowedFeedUrl(source.feed_url, source.provider)
    if (!feedUrl) return respond(res, 400, { error: 'Usa un link iCal HTTPS ufficiale di PoliTO o UniTO.' })

    const feedResponse = await fetchFeed(feedUrl, source.provider, fetcher)
    if (!feedResponse.ok) return respond(res, 502, { error: `Il portale universitario ha risposto con HTTP ${feedResponse.status}.` })
    const text = await readLimited(feedResponse)
    if (!text.trimStart().startsWith('BEGIN:VCALENDAR')) return respond(res, 502, { error: 'Il link non ha restituito un feed iCalendar.' })

    const now = config.now ? new Date(config.now) : new Date()
    const from = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    const until = new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000)
    const events = makeEvents(text, from, until)
    return respond(res, 200, { provider: source.provider, from: from.toISOString(), until: until.toISOString(), events })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const knownError = [
      'Il feed supera la dimensione massima consentita.',
      'Il contenuto ricevuto non è un calendario iCalendar valido.',
      'Il feed contiene troppi eventi nella finestra di sincronizzazione.',
      'Il feed contiene una regola di ricorrenza troppo ampia.',
      'Il feed reindirizza troppe volte.',
      'Il feed reindirizza senza indicare una destinazione.',
      'Il feed reindirizza a un dominio non ufficiale per questo ateneo.',
    ].find((candidate) => candidate === message)
    return respond(res, 502, { error: knownError || 'Impossibile scaricare o interpretare il feed universitario.' })
  }
}

export default function handler(req, res) {
  return scheduleHandler(req, res, {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY,
  })
}
