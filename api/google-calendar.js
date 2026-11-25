import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const googleScope = 'https://www.googleapis.com/auth/calendar.readonly'
const maxCalendars = 30
const maxEventsPerSync = 10000

function respond(res, status, data) {
  res.statusCode = status
  res.end(JSON.stringify(data))
}

function redirect(res, location) {
  res.statusCode = 303
  res.setHeader('Location', location)
  res.end()
}

async function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk)
    if (length > 32 * 1024) throw new Error('Richiesta troppo grande.')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function bearerToken(req) {
  const authorization = req.headers?.authorization
  return typeof authorization === 'string' && /^Bearer \S+$/.test(authorization)
    ? authorization.slice('Bearer '.length)
    : null
}

function encryptToken(token, encodedKey) {
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('Chiave di cifratura OAuth non valida.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`
}

function decryptToken(value, encodedKey) {
  const [version, ivText, tagText, encryptedText] = value.split(':')
  const key = Buffer.from(encodedKey, 'base64')
  if (version !== 'v1' || key.length !== 32 || !ivText || !tagText || !encryptedText) {
    throw new Error('Credenziali Google non leggibili: scollega e ricollega Google Calendar.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new Error('Credenziali Google non leggibili: scollega e ricollega Google Calendar.')
  }
}

function signState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function readState(value, secret) {
  const [encoded, signature, extra] = String(value || '').split('.')
  if (!encoded || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(encoded).digest()
  let actual
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!uuidPattern.test(payload.userId) || !uuidPattern.test(payload.calendarId)
      || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

function decodeDateTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Google Calendar ha restituito un orario non valido.')
  return date.toISOString()
}

function normalizeGoogleEvent(event, source, userId) {
  if (!event || typeof event.id !== 'string' || !/^[A-Za-z0-9_@.-]{1,512}$/.test(event.id)) {
    throw new Error('Google Calendar ha restituito un evento senza identificatore valido.')
  }
  if (event.status === 'cancelled') return { deleted: true, eventId: event.id }

  const startValue = event.start?.dateTime || event.start?.date
  const endValue = event.end?.dateTime || event.end?.date
  if (typeof startValue !== 'string' || typeof endValue !== 'string') {
    throw new Error('Google Calendar ha restituito un evento senza data valida.')
  }
  const allDay = !event.start?.dateTime
  const startDate = allDay ? startValue.slice(0, 10) : null
  const endDate = allDay ? endValue.slice(0, 10) : null
  if (allDay && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
    throw new Error('Google Calendar ha restituito una data di giornata intera non valida.')
  }
  if (allDay && [startDate, endDate].some((value) => decodeDateTime(`${value}T00:00:00Z`).slice(0, 10) !== value)) {
    throw new Error('Google Calendar ha restituito una data di giornata intera non valida.')
  }
  const startsAt = allDay ? decodeDateTime(`${startDate}T00:00:00Z`) : decodeDateTime(startValue)
  const endsAt = allDay ? decodeDateTime(`${endDate}T00:00:00Z`) : decodeDateTime(endValue)
  if (Date.parse(endsAt) < Date.parse(startsAt)) throw new Error('Google Calendar ha restituito una durata non valida.')

  const typeNames = {
    birthday: 'Compleanno',
    focusTime: 'Tempo di concentrazione',
    outOfOffice: 'Fuori sede',
    workingLocation: 'Luogo di lavoro',
    fromGmail: 'Da Gmail',
    default: '',
  }
  const tags = [...new Set([
    'Google Calendar',
    source.summary,
    typeNames[event.eventType] || '',
    event.colorId ? `Colore Google ${event.colorId}` : '',
  ].filter(Boolean))].slice(0, 12).map((tag) => tag.slice(0, 32))
  const description = [
    typeof event.description === 'string' ? event.description.trim() : '',
    typeof event.location === 'string' && event.location.trim() ? `Luogo: ${event.location.trim()}` : '',
  ].filter(Boolean).join('\n').slice(0, 4000)
  const sourceUrl = typeof event.htmlLink === 'string' && event.htmlLink.startsWith('https://www.google.com/calendar/')
    ? event.htmlLink.slice(0, 2048)
    : null

  return {
    user_id: userId,
    calendar_id: source.calendar_id,
    google_calendar_id: source.google_calendar_id,
    event_id: event.id,
    title: (typeof event.summary === 'string' ? event.summary.trim() : '').slice(0, 200) || 'Senza titolo',
    description,
    starts_at: startsAt,
    ends_at: endsAt,
    start_date: startDate,
    end_date: endDate,
    all_day: allDay,
    tags,
    source_url: sourceUrl,
    updated_at: new Date().toISOString(),
  }
}

function configurationError(config) {
  const required = [
    ['supabaseUrl', 'VITE_SUPABASE_URL'],
    ['supabaseKey', 'VITE_SUPABASE_ANON_KEY'],
    ['serviceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY'],
    ['googleClientId', 'GOOGLE_OAUTH_CLIENT_ID'],
    ['googleClientSecret', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    ['googleRedirectUri', 'GOOGLE_OAUTH_REDIRECT_URI'],
    ['oauthStateSecret', 'GOOGLE_OAUTH_STATE_SECRET'],
    ['tokenEncryptionKey', 'GOOGLE_TOKEN_ENCRYPTION_KEY'],
    ['appUrl', 'APP_URL'],
  ]
  const missing = required.filter(([key]) => !config[key]).map(([, name]) => name)
  if (missing.length) {
    return `Configurazione Google Calendar incompleta sul server. Variabili mancanti: ${missing.join(', ')}.`
  }
  if (Buffer.from(config.tokenEncryptionKey, 'base64').length !== 32) {
    return 'La chiave di cifratura Google Calendar non è valida.'
  }
  if (Buffer.byteLength(config.oauthStateSecret, 'utf8') < 32) {
    return 'La chiave di sicurezza OAuth Google deve contenere almeno 32 byte.'
  }
  return null
}

async function fetchJson(fetcher, url, options = {}) {
  const response = await fetcher(url, { ...options, signal: options.signal ?? AbortSignal.timeout(10000) })
  const body = await response.json().catch(() => null)
  return { response, body }
}

async function verifyUser(fetcher, config, token) {
  if (!token) return { error: { status: 401, message: 'Accedi per collegare Google Calendar.' } }
  const { response, body } = await fetchJson(fetcher, `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: config.supabaseKey },
  })
  if (response.status === 401 || response.status === 403) {
    return { error: { status: 401, message: 'Sessione non valida o scaduta.' } }
  }
  if (!response.ok || typeof body?.id !== 'string' || !uuidPattern.test(body.id)) {
    return { error: { status: 502, message: 'Impossibile verificare la sessione Supabase.' } }
  }
  return { userId: body.id }
}

async function verifyMembership(fetcher, config, token, userId, calendarId) {
  if (typeof calendarId !== 'string' || !uuidPattern.test(calendarId)) {
    return { status: 400, message: 'Calendario non valido.' }
  }
  const params = new URLSearchParams({
    select: 'calendar_id',
    calendar_id: `eq.${calendarId}`,
    user_id: `eq.${userId}`,
    limit: '1',
  })
  const { response, body } = await fetchJson(fetcher, `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/calendar_members?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: config.supabaseKey },
  })
  if (!response.ok) return { status: 502, message: 'Impossibile verificare l’accesso al calendario.' }
  if (!Array.isArray(body) || body.length === 0) return { status: 403, message: 'Questo calendario non è accessibile.' }
  return null
}

async function serviceRequest(fetcher, config, path, method = 'GET', body, prefer) {
  const headers = {
    Authorization: `Bearer ${config.serviceRoleKey}`,
    apikey: config.serviceRoleKey,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(prefer ? { Prefer: prefer } : {}),
  }
  const result = await fetchJson(fetcher, `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!result.response.ok) throw new Error('Errore durante l’accesso ai dati privati Google Calendar.')
  return result.body
}

function rowFilter(userId, calendarId) {
  return `user_id=eq.${encodeURIComponent(userId)}&calendar_id=eq.${encodeURIComponent(calendarId)}`
}

async function getConnection(fetcher, config, userId, calendarId) {
  const rows = await serviceRequest(
    fetcher, config,
    `google_calendar_connections?select=refresh_token_encrypted,access_token_encrypted,access_token_expires_at&${rowFilter(userId, calendarId)}&limit=1`,
  )
  return Array.isArray(rows) ? rows[0] ?? null : null
}

async function getAccessToken(fetcher, config, userId, calendarId) {
  const connection = await getConnection(fetcher, config, userId, calendarId)
  if (!connection?.refresh_token_encrypted) return null
  if (connection.access_token_encrypted
    && Date.parse(connection.access_token_expires_at) > Date.now() + 60_000) {
    return decryptToken(connection.access_token_encrypted, config.tokenEncryptionKey)
  }
  const refreshToken = decryptToken(connection.refresh_token_encrypted, config.tokenEncryptionKey)
  const { response, body } = await fetchJson(fetcher, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok || typeof body?.access_token !== 'string') {
    if (body?.error === 'invalid_grant') {
      await serviceRequest(
        fetcher, config,
        `google_calendar_connections?${rowFilter(userId, calendarId)}`,
        'DELETE',
      )
      throw new Error('Autorizzazione Google revocata o scaduta. Ricollega il calendario.')
    }
    throw new Error('Impossibile aggiornare l’autorizzazione Google. Riprova a collegare il calendario.')
  }
  const updatedAt = new Date()
  await serviceRequest(
    fetcher, config,
    `google_calendar_connections?${rowFilter(userId, calendarId)}`,
    'PATCH',
    {
      access_token_encrypted: encryptToken(body.access_token, config.tokenEncryptionKey),
      access_token_expires_at: new Date(updatedAt.getTime() + Math.max(60, Number(body.expires_in) || 3600) * 1000).toISOString(),
      ...(typeof body.refresh_token === 'string'
        ? { refresh_token_encrypted: encryptToken(body.refresh_token, config.tokenEncryptionKey) }
        : {}),
      updated_at: updatedAt.toISOString(),
    },
    'return=minimal',
  )
  return body.access_token
}

async function listGoogleCalendars(fetcher, accessToken) {
  const calendars = []
  let pageToken
  do {
    const params = new URLSearchParams({ maxResults: '250' })
    if (pageToken) params.set('pageToken', pageToken)
    const { response, body } = await fetchJson(fetcher, `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok || !Array.isArray(body?.items)) throw new Error('Impossibile leggere i calendari Google.')
    for (const entry of body.items) {
      if (typeof entry.id !== 'string' || entry.id.length > 512) continue
      calendars.push({
        id: entry.id,
        summary: (typeof entry.summary === 'string' ? entry.summary.trim() : '') || 'Calendario senza nome',
        timeZone: typeof entry.timeZone === 'string' ? entry.timeZone : 'UTC',
        primary: entry.primary === true,
      })
      if (calendars.length > 500) throw new Error('L’account contiene troppi calendari da mostrare.')
    }
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : null
  } while (pageToken)
  return calendars
}

async function handleAuthorize(req, res, fetcher, config) {
  const token = bearerToken(req)
  const body = await requestBody(req).catch(() => null)
  if (!body) return respond(res, 400, { error: 'Richiesta non valida.' })
  const verified = await verifyUser(fetcher, config, token)
  if (verified.error) return respond(res, verified.error.status, { error: verified.error.message })
  const membershipError = await verifyMembership(fetcher, config, token, verified.userId, body.calendarId)
  if (membershipError) return respond(res, membershipError.status, { error: membershipError.message })

  const state = signState({
    userId: verified.userId,
    calendarId: body.calendarId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(16).toString('base64url'),
  }, config.oauthStateSecret)
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: googleScope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return respond(res, 200, { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
}

async function handleCallback(req, res, fetcher, config, requestUrl) {
  const error = requestUrl.searchParams.get('error')
  const state = readState(requestUrl.searchParams.get('state'), config.oauthStateSecret)
  if (error || !state) {
    const params = new URLSearchParams({ google_calendar: error ? 'denied' : 'invalid_state' })
    if (state) params.set('calendar_id', state.calendarId)
    return redirect(res, `${config.appUrl.replace(/\/$/, '')}/?${params}`)
  }
  const code = requestUrl.searchParams.get('code')
  if (!code || code.length > 4096) {
    return redirect(res, `${config.appUrl.replace(/\/$/, '')}/?google_calendar=authorization_failed`)
  }
  try {
    const { response, body } = await fetchJson(fetcher, 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: config.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!response.ok || typeof body?.access_token !== 'string') throw new Error('Scambio del codice Google non riuscito.')
    let refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
    if (!refreshToken) {
      const previous = await getConnection(fetcher, config, state.userId, state.calendarId)
      if (previous?.refresh_token_encrypted) {
        refreshToken = decryptToken(previous.refresh_token_encrypted, config.tokenEncryptionKey)
      } else {
        throw new Error('Google non ha fornito un’autorizzazione offline. Revoca l’accesso e riprova.')
      }
    }
    await serviceRequest(
      fetcher, config,
      'google_calendar_connections?on_conflict=user_id,calendar_id',
      'POST',
      {
        user_id: state.userId,
        calendar_id: state.calendarId,
        refresh_token_encrypted: encryptToken(refreshToken, config.tokenEncryptionKey),
        access_token_encrypted: encryptToken(body.access_token, config.tokenEncryptionKey),
        access_token_expires_at: new Date(Date.now() + Math.max(60, Number(body.expires_in) || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      'resolution=merge-duplicates,return=minimal',
    )
    const params = new URLSearchParams({ google_calendar: 'connected', calendar_id: state.calendarId })
    return redirect(res, `${config.appUrl.replace(/\/$/, '')}/?${params}`)
  } catch {
    return redirect(res, `${config.appUrl.replace(/\/$/, '')}/?google_calendar=authorization_failed`)
  }
}

async function handleList(req, res, fetcher, config, requestUrl) {
  const token = bearerToken(req)
  const verified = await verifyUser(fetcher, config, token)
  if (verified.error) return respond(res, verified.error.status, { error: verified.error.message })
  const calendarId = requestUrl.searchParams.get('calendarId')
  const membershipError = await verifyMembership(fetcher, config, token, verified.userId, calendarId)
  if (membershipError) return respond(res, membershipError.status, { error: membershipError.message })
  const connection = await getConnection(fetcher, config, verified.userId, calendarId)
  if (!connection) return respond(res, 200, { connected: false, calendars: [] })
  const accessToken = await getAccessToken(fetcher, config, verified.userId, calendarId)
  const googleCalendars = await listGoogleCalendars(fetcher, accessToken)
  const sourceRows = await serviceRequest(
    fetcher, config,
    `google_calendar_sources?select=google_calendar_id,summary,enabled,last_synced_at&${rowFilter(verified.userId, calendarId)}`,
  )
  const sources = new Map((Array.isArray(sourceRows) ? sourceRows : []).map((source) => [source.google_calendar_id, source]))
  return respond(res, 200, {
    connected: true,
    calendars: googleCalendars.map((entry) => ({
      ...entry,
      selected: sources.get(entry.id)?.enabled === true,
      lastSyncedAt: sources.get(entry.id)?.last_synced_at ?? null,
    })),
  })
}

async function handleSelect(req, res, fetcher, config) {
  const token = bearerToken(req)
  const body = await requestBody(req).catch(() => null)
  if (!body || !Array.isArray(body.googleCalendarIds) || body.googleCalendarIds.length > maxCalendars
    || body.googleCalendarIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 512)
    || new Set(body.googleCalendarIds).size !== body.googleCalendarIds.length) {
    return respond(res, 400, { error: 'Selezione dei calendari non valida.' })
  }
  const verified = await verifyUser(fetcher, config, token)
  if (verified.error) return respond(res, verified.error.status, { error: verified.error.message })
  const membershipError = await verifyMembership(fetcher, config, token, verified.userId, body.calendarId)
  if (membershipError) return respond(res, membershipError.status, { error: membershipError.message })
  const accessToken = await getAccessToken(fetcher, config, verified.userId, body.calendarId)
  if (!accessToken) return respond(res, 409, { error: 'Collega prima un account Google.' })
  const googleCalendars = await listGoogleCalendars(fetcher, accessToken)
  const chosen = googleCalendars.filter((entry) => body.googleCalendarIds.includes(entry.id))
  if (chosen.length !== body.googleCalendarIds.length) return respond(res, 400, { error: 'Uno o più calendari non sono accessibili con questo account.' })

  const filter = rowFilter(verified.userId, body.calendarId)
  const existing = await serviceRequest(fetcher, config, `google_calendar_sources?select=google_calendar_id,enabled&${filter}`)
  const previous = Array.isArray(existing) ? existing : []
  for (const source of previous) {
    if (!body.googleCalendarIds.includes(source.google_calendar_id)) {
      await serviceRequest(
        fetcher, config,
        `google_calendar_sources?${filter}&google_calendar_id=eq.${encodeURIComponent(source.google_calendar_id)}`,
        'PATCH',
        { enabled: false, sync_token: null, last_synced_at: null },
        'return=minimal',
      )
      await serviceRequest(
        fetcher, config,
        `google_calendar_events?${filter}&google_calendar_id=eq.${encodeURIComponent(source.google_calendar_id)}`,
        'DELETE',
      )
    }
  }
  for (const source of chosen) {
    const wasEnabled = previous.some((entry) => entry.google_calendar_id === source.id && entry.enabled)
    await serviceRequest(
      fetcher, config,
      'google_calendar_sources?on_conflict=user_id,calendar_id,google_calendar_id',
      'POST',
      {
        user_id: verified.userId,
        calendar_id: body.calendarId,
        google_calendar_id: source.id,
        summary: source.summary.slice(0, 200) || 'Calendario senza nome',
        time_zone: source.timeZone.slice(0, 128),
        enabled: true,
        ...(wasEnabled ? {} : { sync_token: null, last_synced_at: null }),
      },
      'resolution=merge-duplicates,return=minimal',
    )
  }
  return respond(res, 200, { selected: chosen.length })
}

async function saveGoogleEvents(fetcher, config, rows, userId, calendarId, googleCalendarId) {
  const liveEvents = rows.filter((event) => !event.deleted)
  const deletedIds = rows.filter((event) => event.deleted).map((event) => event.eventId)
  for (let offset = 0; offset < liveEvents.length; offset += 500) {
    const batch = liveEvents.slice(offset, offset + 500)
    if (batch.length) {
      await serviceRequest(
        fetcher, config,
        'google_calendar_events?on_conflict=user_id,calendar_id,google_calendar_id,event_id',
        'POST',
        batch,
        'resolution=merge-duplicates,return=minimal',
      )
    }
  }
  for (let offset = 0; offset < deletedIds.length; offset += 500) {
    const ids = deletedIds.slice(offset, offset + 500)
    const filter = `${rowFilter(userId, calendarId)}&google_calendar_id=eq.${encodeURIComponent(googleCalendarId)}&event_id=in.(${ids.map((id) => `"${id}"`).join(',')})`
    await serviceRequest(fetcher, config, `google_calendar_events?${filter}`, 'DELETE')
  }
}

async function syncOneCalendar(fetcher, config, accessToken, source, userId, retriedFullSync = false) {
  const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(source.google_calendar_id)}/events`
  const initialSyncToken = source.sync_token
  let pageToken = null
  let nextSyncToken = null
  let changed = 0

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '2500',
      timeZone: 'UTC',
    })
    if (initialSyncToken) params.set('syncToken', initialSyncToken)
    if (pageToken) params.set('pageToken', pageToken)
    const { response, body } = await fetchJson(fetcher, `${baseUrl}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (response.status === 410 && initialSyncToken && !retriedFullSync) {
      await serviceRequest(
        fetcher, config,
        `google_calendar_events?${rowFilter(userId, source.calendar_id)}&google_calendar_id=eq.${encodeURIComponent(source.google_calendar_id)}`,
        'DELETE',
      )
      return syncOneCalendar(fetcher, config, accessToken, { ...source, sync_token: null }, userId, true)
    }
    if (!response.ok || !Array.isArray(body?.items)) throw new Error('Google Calendar non ha completato la sincronizzazione.')
    const normalized = body.items.map((event) => normalizeGoogleEvent(event, source, userId))
    changed += normalized.length
    if (changed > maxEventsPerSync) throw new Error('Il calendario Google contiene troppi eventi da sincronizzare in una volta.')
    await saveGoogleEvents(fetcher, config, normalized, userId, source.calendar_id, source.google_calendar_id)
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : null
    if (!pageToken && typeof body.nextSyncToken === 'string') nextSyncToken = body.nextSyncToken
  } while (pageToken)

  if (!nextSyncToken) throw new Error('Google Calendar non ha restituito un token di sincronizzazione.')
  const filter = `${rowFilter(userId, source.calendar_id)}&google_calendar_id=eq.${encodeURIComponent(source.google_calendar_id)}`
  await serviceRequest(fetcher, config, `google_calendar_sources?${filter}`, 'PATCH', {
    sync_token: nextSyncToken,
    last_synced_at: new Date().toISOString(),
  }, 'return=minimal')
  return changed
}

async function handleSync(req, res, fetcher, config) {
  const token = bearerToken(req)
  const body = await requestBody(req).catch(() => null)
  if (!body) return respond(res, 400, { error: 'Richiesta non valida.' })
  const verified = await verifyUser(fetcher, config, token)
  if (verified.error) return respond(res, verified.error.status, { error: verified.error.message })
  const membershipError = await verifyMembership(fetcher, config, token, verified.userId, body.calendarId)
  if (membershipError) return respond(res, membershipError.status, { error: membershipError.message })
  const connection = await getConnection(fetcher, config, verified.userId, body.calendarId)
  if (!connection) return respond(res, 200, { connected: false, updated: 0 })
  const accessToken = await getAccessToken(fetcher, config, verified.userId, body.calendarId)
  if (!accessToken) return respond(res, 200, { connected: false, updated: 0 })
  const sourceRows = await serviceRequest(
    fetcher, config,
    `google_calendar_sources?select=calendar_id,google_calendar_id,summary,time_zone,sync_token&${rowFilter(verified.userId, body.calendarId)}&enabled=eq.true`,
  )
  const sources = Array.isArray(sourceRows) ? sourceRows : []
  let updated = 0
  for (const source of sources) {
    updated += await syncOneCalendar(fetcher, config, accessToken, source, verified.userId)
  }
  return respond(res, 200, { connected: true, updated, calendars: sources.length })
}

async function handleDisconnect(req, res, fetcher, config) {
  const token = bearerToken(req)
  const body = await requestBody(req).catch(() => null)
  if (!body) return respond(res, 400, { error: 'Richiesta non valida.' })
  const verified = await verifyUser(fetcher, config, token)
  if (verified.error) return respond(res, verified.error.status, { error: verified.error.message })
  const membershipError = await verifyMembership(fetcher, config, token, verified.userId, body.calendarId)
  if (membershipError) return respond(res, membershipError.status, { error: membershipError.message })
  const filter = rowFilter(verified.userId, body.calendarId)
  const connection = await getConnection(fetcher, config, verified.userId, body.calendarId)
  let revoked = !connection
  if (connection?.refresh_token_encrypted) {
    try {
      const refreshToken = decryptToken(connection.refresh_token_encrypted, config.tokenEncryptionKey)
      const result = await fetcher('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
        signal: AbortSignal.timeout(8000),
      })
      revoked = result.ok || result.status === 400
    } catch {
      revoked = false
    }
  }
  await serviceRequest(fetcher, config, `google_calendar_connections?${filter}`, 'DELETE')
  await serviceRequest(fetcher, config, `google_calendar_events?${filter}`, 'DELETE')
  await serviceRequest(fetcher, config, `google_calendar_sources?${filter}`, 'DELETE')
  return respond(res, 200, { disconnected: true, revoked })
}

export async function googleCalendarHandler(req, res, config, fetcher = fetch) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  const requestUrl = new URL(req.url || '', 'http://localhost')
  if (requestUrl.searchParams.get('action') === 'callback' && req.method === 'GET') {
    const missingConfig = configurationError(config)
    if (missingConfig) return redirect(res, `${(config.appUrl || 'http://localhost').replace(/\/$/, '')}/?google_calendar=not_configured`)
    return handleCallback(req, res, fetcher, config, requestUrl)
  }
  if (!['GET', 'POST'].includes(req.method)) return respond(res, 405, { error: 'Metodo non supportato.' })
  const missingConfig = configurationError(config)
  if (missingConfig) return respond(res, 503, { code: 'GOOGLE_CALENDAR_NOT_CONFIGURED', error: missingConfig })
  const action = requestUrl.searchParams.get('action')
  try {
    if (action === 'authorize' && req.method === 'POST') return await handleAuthorize(req, res, fetcher, config)
    if (action === 'calendars' && req.method === 'GET') return await handleList(req, res, fetcher, config, requestUrl)
    if (action === 'select' && req.method === 'POST') return await handleSelect(req, res, fetcher, config)
    if (action === 'sync' && req.method === 'POST') return await handleSync(req, res, fetcher, config)
    if (action === 'disconnect' && req.method === 'POST') return await handleDisconnect(req, res, fetcher, config)
    return respond(res, 404, { error: 'Operazione Google Calendar non trovata.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore imprevisto Google Calendar.'
    return respond(res, 502, { error: message })
  }
}

export { normalizeGoogleEvent }

export default function handler(req, res) {
  return googleCalendarHandler(req, res, {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    oauthStateSecret: process.env.GOOGLE_OAUTH_STATE_SECRET,
    tokenEncryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    appUrl: process.env.APP_URL,
  })
}
